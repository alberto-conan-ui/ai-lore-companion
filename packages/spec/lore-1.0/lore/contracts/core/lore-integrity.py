#!/usr/bin/env python3
"""lore-integrity.py: the check script of the contract lore-integrity.

The card is lore/contracts/core/lore-integrity.md. It states the rule, the
command line, what each of the two checks reads, and the choices made.

Command line (every path is absolute):

  python3 lore-integrity.py --space <Space folder> --when before --path <file to be written>
  python3 lore-integrity.py --space <Space folder> --when after

  --desk <desk folder> and --session <session id> are accepted and not read.
  With --when after, --path is accepted and not read: the whole Lore is checked.

Exit code 0: the write is allowed (before), or the Lore passes (after). One
sentence is printed on standard output.
Exit code 2: the write is refused (before), or the Lore fails (after). Standard
error has one sentence for the refusal, or one line per finding followed by a
line with the number of findings.
There is no other exit code: a wrong command line and an error inside this
script give exit code 2.

Python 3.8 or later, standard library only. The script reads files. It writes
no file, starts no other program and uses no network.
"""
import argparse
import os
import re
import sys
import unicodedata
from urllib.parse import unquote

NAME = 'lore-integrity'
EXIT_PASS = 0
EXIT_FAIL = 2
TYPES = ('corpus', 'verb', 'process', 'contract', 'mirror', 'index', 'space')
PROTECTED_FOLDERS = ('core', 'default')
# Folders that the Space repository git-ignores. They differ from one desk to
# another, so a frontmatter path into one of them is not required to exist.
DESK_ONLY_FOLDERS = ('repos', 'workbench')


class Refusal(Exception):
    """The check cannot run or refuses. The message is the reason, written as a clause."""


class SubsetError(Exception):
    """Frontmatter is outside the subset of lore/corpus/core/frontmatter.md."""


# --------------------------------------------------------------- the command line
class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise Refusal('the command line of the check is wrong (%s)' % message)


def parse_arguments(argv):
    parser = _Parser(prog=NAME, add_help=False, allow_abbrev=False)
    parser.add_argument('--space', required=True)
    parser.add_argument('--when', required=True, choices=['before', 'after'])
    parser.add_argument('--path')
    parser.add_argument('--desk')
    parser.add_argument('--session')
    return parser.parse_args(argv)


# ------------------------------------------------------------------ frontmatter
# The reader below reads the subset that lore/corpus/core/frontmatter.md defines.
# Each check script carries its own copy, so that a script can be copied out of
# the Lore and run alone.
KEY = r'[a-z][a-z0-9_]*'
RESERVED_WORDS = ('true', 'false', 'null', 'yes', 'no', 'on', 'off', 'y', 'n')


def parse_scalar(text):
    if re.match(r'^(0|[1-9][0-9]*)\Z', text):
        return int(text)
    if text == 'true':
        return True
    if text == 'false':
        return False
    if text == 'null':
        return None
    if text.startswith('"'):
        quoted = re.match(r'^"((?:[^"\\]|\\["\\])*)"\Z', text)
        if not quoted:
            raise SubsetError('double-quoted text is not closed or has an unknown escape: ' + text)
        return re.sub(r'\\(["\\])', r'\1', quoted.group(1))
    if not text[:1].isalpha():
        raise SubsetError('plain text must begin with a letter: ' + text)
    if re.search(r'[:#"]', text):
        raise SubsetError('plain text has a colon, a # or a double quote: ' + text)
    if text != text.rstrip():
        raise SubsetError('plain text ends with a space: ' + text)
    if text.lower() in RESERVED_WORDS:
        raise SubsetError('this word must be written in double quotes: ' + text)
    return text


def parse_key_and_scalar(text):
    match = re.match(r'^(' + KEY + r'): (.+)\Z', text)
    if not match:
        raise SubsetError('expected "key: value": ' + text)
    return match.group(1), parse_scalar(match.group(2))


def set_once(mapping, key, value):
    if key in mapping:
        raise SubsetError('the key %s is written twice' % key)
    mapping[key] = value


def parse_block(lines):
    if not lines[0].startswith('  - '):
        mapping = {}
        for line in lines:
            if not line.startswith('  ') or line.startswith('   '):
                raise SubsetError('indentation: ' + line)
            key, value = parse_key_and_scalar(line[2:])
            set_once(mapping, key, value)
        return mapping
    scalars = []
    maps = []
    for line in lines:
        if line.startswith('  - '):
            rest = line[4:]
            if rest.startswith('"') or ':' not in rest:
                scalars.append(parse_scalar(rest))
            else:
                key, value = parse_key_and_scalar(rest)
                maps.append({key: value})
        elif line.startswith('    ') and not line.startswith('     '):
            if not maps or scalars:
                raise SubsetError('a key line under a scalar item: ' + line)
            key, value = parse_key_and_scalar(line[4:])
            set_once(maps[-1], key, value)
        else:
            raise SubsetError('indentation: ' + line)
    if scalars and maps:
        raise SubsetError('a list mixes scalars and maps')
    return maps if maps else scalars


def parse_subset(yaml_text):
    result = {}
    lines = [
        line
        for line in yaml_text.split('\n')
        if line.strip() != '' and not line.lstrip().startswith('#')
    ]
    i = 0
    while i < len(lines):
        line = lines[i]
        if '\t' in line:
            raise SubsetError('a tab in: ' + repr(line))
        match = re.match(r'^(' + KEY + r'):(?: (.+))?\Z', line)
        if not match:
            raise SubsetError('expected a key at the top level: ' + line)
        key, inline = match.group(1), match.group(2)
        i += 1
        if inline is not None:
            set_once(result, key, [] if inline == '[]' else parse_scalar(inline))
            continue
        block = []
        while i < len(lines) and lines[i].startswith(' '):
            if '\t' in lines[i]:
                raise SubsetError('a tab in: ' + repr(lines[i]))
            block.append(lines[i])
            i += 1
        if not block:
            raise SubsetError('the key %s has no value' % key)
        set_once(result, key, parse_block(block))
    return result


def split_frontmatter(text):
    """(frontmatter text, body) of a markdown file, or None when it has no frontmatter."""
    lines = text.split('\n')
    if lines[0] != '---' or '---' not in lines[1:]:
        return None
    end = lines.index('---', 1)
    return '\n'.join(lines[1:end]), '\n'.join(lines[end + 1:])


# ------------------------------------------------------------------------ paths
def folded(path):
    """`path` for a comparison without regard to upper and lower case and to the Unicode form."""
    return unicodedata.normalize('NFC', path).casefold()


def segments_below(root, path):
    """The segments of `path` below the folder `root`, or None when it is not below it."""
    prefix = root if root.endswith(os.sep) else root + os.sep
    if not path.startswith(prefix):
        return None
    rest = [segment for segment in path[len(prefix):].split(os.sep) if segment != '']
    return rest if rest else None


def resolve_space(space_argument):
    if not os.path.isabs(space_argument):
        raise Refusal('the argument --space is not an absolute path')
    space = os.path.realpath(space_argument)
    if not os.path.isdir(space):
        raise Refusal('the Space folder "%s" does not exist' % space_argument)
    return space


# ------------------------------------------------------- the check before a write
def check_before(space, path_argument):
    """Returns the reason the write is allowed, or raises Refusal."""
    if path_argument is None:
        raise Refusal('the command line of the check is wrong (--when before needs --path)')
    if not os.path.isabs(path_argument):
        raise Refusal('the argument --path is not an absolute path')
    # realpath resolves every symbolic link and removes every ".." segment; for a
    # file that does not exist yet it resolves the folders that do exist.
    resolved = os.path.realpath(path_argument)
    # Some file systems take "Core" and "core" for one name, so the comparisons
    # that refuse do not look at case or at the Unicode form.
    below = segments_below(folded(os.path.join(space, 'lore')), folded(resolved))
    if below is None:
        return 'the path is not in the Lore'
    for folder in below[:-1]:
        if folder in PROTECTED_FOLDERS:
            raise Refusal(
                'the file is under a folder named "%s", and the files of the core and default layers are not edited in place'
                % folder
            )
    # lore/<part>/<name> and lore/<part>/default/<name> may not take the name of
    # a file in lore/<part>/core/.
    if len(below) == 2 and below[1] != 'index.md':
        core = os.path.join(space, 'lore', below[0], 'core')
        if os.path.isdir(core) and below[1] in [folded(name) for name in os.listdir(core)]:
            raise Refusal(
                'the file takes the name of a file in "lore/%s/core/", and no file of the Space may take the name of a core file'
                % below[0]
            )
    return 'the path is in the Lore, is not under a folder named "core" or "default", and does not take the name of a core file'


# -------------------------------------------------------- the check after a write
def without_fences(text):
    kept = []
    in_fence = False
    for line in text.split('\n'):
        if line.startswith('```'):
            in_fence = not in_fence
            continue
        if not in_fence:
            kept.append(line)
    return kept


INDEX_LINE = re.compile(r'^- \[([^\]]+)\]\(\./([^)]+)\): \S.*\Z')
LINK = re.compile(r'\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)')
INLINE_CODE = re.compile(r'`[^`]*`')


def check_index(folder, shown_folder, findings):
    index_path = os.path.join(folder, 'index.md')
    shown_index = shown_folder + '/index.md'
    names = sorted(name for name in os.listdir(folder) if not name.startswith('.') and name != 'index.md')
    folders = [n for n in names if os.path.isdir(os.path.join(folder, n)) and not os.path.islink(os.path.join(folder, n))]
    files = [n for n in names if n not in folders]
    if not os.path.isfile(index_path):
        findings.append((shown_folder, 'the folder has no index.md'))
        return folders
    try:
        with open(index_path, encoding='utf-8') as handle:
            text = handle.read()
    except (OSError, UnicodeDecodeError):
        return folders  # reported by check_markdown_file
    listed_files = []
    listed_folders = []
    for line in without_fences(text):
        if not line.startswith('- '):
            continue
        match = INDEX_LINE.match(line)
        if not match:
            findings.append((shown_index, 'this line does not have the form of an index line: ' + line))
            continue
        label, target = match.group(1), match.group(2)
        if label.endswith('/'):
            if target != label + 'index.md':
                findings.append((shown_index, 'the line for the folder %s does not link to its index.md' % label))
            listed_folders.append(label[:-1])
        else:
            if target != label:
                findings.append((shown_index, 'the line for the file %s links to %s' % (label, target)))
            listed_files.append(label)
    for kind, listed, actual in (('file', listed_files, files), ('folder', listed_folders, folders)):
        for name in sorted(set(actual) - set(listed)):
            findings.append((shown_index, 'the index has no line for the %s %s' % (kind, name)))
        for name in sorted(set(listed) - set(actual)):
            findings.append((shown_index, 'the index lists the %s %s, which is not in the folder' % (kind, name)))
        for name in sorted(set(n for n in listed if listed.count(n) > 1)):
            findings.append((shown_index, 'the index lists the %s %s more than once' % (kind, name)))
    return folders


def frontmatter_references(data):
    """The paths that a card's frontmatter names, as (key, path) pairs."""
    found = []
    points_at = data.get('points_at')
    if isinstance(points_at, list):
        for item in points_at:
            if isinstance(item, str) and not item.startswith('https://'):
                found.append(('points_at', item.split('#', 1)[0]))
    for key in ('check', 'generator'):
        if isinstance(data.get(key), str):
            found.append((key, data[key]))
    return found


def check_frontmatter_reference(space, key, path, shown, findings):
    parts = path.split('/')
    if path.endswith('/'):
        parts = parts[:-1]
    if os.path.isabs(path) or '\\' in path or any(part in ('', '.', '..') for part in parts):
        findings.append((shown, 'the key %s has "%s", which is not a path relative to the Space\'s folder' % (key, path)))
        return
    if parts[0] in DESK_ONLY_FOLDERS:
        return
    if not os.path.exists(os.path.join(space, *parts)):
        findings.append((shown, 'the key %s names "%s", which does not exist' % (key, path)))


def check_links(space, file_path, shown, body, is_index, findings):
    for line in without_fences(body):
        if is_index and line.startswith('- '):
            continue  # an index line is checked against the folder's children
        for match in LINK.finditer(INLINE_CODE.sub('', line)):
            target = match.group(1)
            if re.match(r'^[A-Za-z][A-Za-z0-9+.-]*:', target) or target.startswith('#'):
                continue  # a web address or another scheme, or a section of the same file
            relative = unquote(target.split('#', 1)[0])
            if relative == '':
                continue
            if relative.startswith('/'):
                findings.append((shown, 'the link "%s" is not relative to the file' % target))
                continue
            resolved = os.path.realpath(os.path.join(os.path.dirname(file_path), relative))
            if resolved != space and segments_below(space, resolved) is None:
                findings.append((shown, 'the link "%s" points outside the Space\'s folder' % target))
            elif not os.path.exists(resolved):
                findings.append((shown, 'the link "%s" does not resolve to an existing file' % target))


def check_markdown_file(space, file_path, shown, findings):
    try:
        with open(file_path, encoding='utf-8') as handle:
            text = handle.read()
    except (OSError, UnicodeDecodeError):
        findings.append((shown, 'the file cannot be read as UTF-8 text'))
        return
    split = split_frontmatter(text)
    if split is None:
        findings.append((shown, 'the file does not begin with frontmatter between two --- lines'))
        return
    is_index = os.path.basename(file_path) == 'index.md'
    try:
        data = parse_subset(split[0])
    except SubsetError as error:
        findings.append((shown, 'the frontmatter is outside the subset: %s' % error))
        data = None
    if data is not None:
        kind = data.get('type')
        if kind not in TYPES:
            findings.append((shown, 'the frontmatter has no key type with one of the values %s' % ', '.join(TYPES)))
        elif (kind == 'index') != is_index:
            findings.append((shown, 'the type index is for a file named index.md, and only for it'))
        for key, path in frontmatter_references(data):
            check_frontmatter_reference(space, key, path, shown, findings)
    check_links(space, file_path, shown, split[1], is_index, findings)


def check_core_names(lore, findings):
    """A finding for each file of a part that takes the name of a file in the part's core/ folder."""
    for part in sorted(os.listdir(lore)):
        core = os.path.join(lore, part, 'core')
        if part.startswith('.') or not os.path.isdir(core):
            continue
        core_names = set(
            folded(name) for name in os.listdir(core) if name != 'index.md' and not name.startswith('.')
        )
        for folder, shown_folder in (
            (os.path.join(lore, part), 'lore/' + part),
            (os.path.join(lore, part, 'default'), 'lore/' + part + '/default'),
        ):
            if not os.path.isdir(folder):
                continue
            for name in sorted(os.listdir(folder)):
                if folded(name) in core_names and os.path.isfile(os.path.join(folder, name)):
                    findings.append(
                        (
                            shown_folder + '/' + name,
                            'the file takes the name of a file in lore/%s/core/, and no file of the Space may take the name of a core file'
                            % part,
                        )
                    )


def check_after(space):
    """Returns (findings, number of files read, number of folders read)."""
    lore = os.path.join(space, 'lore')
    if not os.path.isdir(lore) or os.path.islink(lore):
        raise Refusal('the folder "%s" does not exist' % lore)
    findings = []
    check_core_names(lore, findings)
    files_read = 0
    folders_read = 0
    pending = [(lore, 'lore')]
    while pending:
        folder, shown_folder = pending.pop()
        folders_read += 1
        for name in check_index(folder, shown_folder, findings):
            pending.append((os.path.join(folder, name), shown_folder + '/' + name))
        for name in sorted(os.listdir(folder)):
            path = os.path.join(folder, name)
            if name.startswith('.') or not name.endswith('.md') or not os.path.isfile(path):
                continue
            files_read += 1
            check_markdown_file(space, path, shown_folder + '/' + name, findings)
    return sorted(set(findings)), files_read, folders_read


def main(argv):
    subject = 'to run'
    try:
        arguments = parse_arguments(argv)
        if arguments.when == 'before':
            if arguments.path is not None:
                subject = 'the write to "%s"' % arguments.path
        else:
            subject = 'to pass the Lore in "%s"' % arguments.space
        space = resolve_space(arguments.space)
        if arguments.when == 'before':
            reason = check_before(space, arguments.path)
            sys.stdout.write('%s allows %s: %s.\n' % (NAME, subject, reason))
            return EXIT_PASS
        findings, files_read, folders_read = check_after(space)
    except Refusal as refusal:
        sys.stderr.write('%s refuses %s: %s.\n' % (NAME, subject, refusal))
        return EXIT_FAIL
    except Exception as error:  # an error of this script fails the check too
        sys.stderr.write('%s refuses: the check failed with %s.\n' % (NAME, type(error).__name__))
        return EXIT_FAIL
    if findings:
        for shown, sentence in findings:
            sys.stderr.write('%s: %s: %s.\n' % (NAME, shown, sentence))
        sys.stderr.write(
            '%s: the Lore in "%s" fails the check with %d findings.\n' % (NAME, arguments.space, len(findings))
        )
        return EXIT_FAIL
    sys.stdout.write(
        '%s: the Lore in "%s" passes the check: %d markdown files in %d folders.\n'
        % (NAME, arguments.space, files_read, folders_read)
    )
    return EXIT_PASS


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
