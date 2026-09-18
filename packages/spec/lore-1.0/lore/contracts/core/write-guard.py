#!/usr/bin/env python3
"""write-guard.py: the check script of the contract write-guard.

The card is lore/contracts/core/write-guard.md. It states the rule, the command
line, the desk records that this script reads, and the choices made.

Command line (every path is absolute):

  python3 write-guard.py --space <Space folder> --desk <desk folder>
                         --session <session id> --path <file to be written>
                         [--when before]

Exit code 0: the write is allowed. One sentence is printed on standard output.
Exit code 2: the write is refused. One sentence is printed on standard error.
There is no other exit code: a wrong command line, a desk record that is there
and cannot be read, and an error inside this script all refuse. A desk record
that is missing is read as a record with no sessions or no claims, so the
session is in Read only and holds no target.

Python 3.8 or later, standard library only. The script reads files and starts
`git` to read a repository's checked-out branch. It writes no file and uses no
network.
"""
import argparse
import json
import os
import re
import stat
import subprocess
import sys
import unicodedata

NAME = 'write-guard'
EXIT_ALLOW = 0
EXIT_REFUSE = 2
RECORD_VERSION = 1
RECORD_SIZE_LIMIT = 8 * 1024 * 1024
GIT_TIMEOUT_SECONDS = 10


class Refusal(Exception):
    """The write is refused. The message is the reason, written as a clause."""


class SubsetError(Exception):
    """Frontmatter is outside the subset of lore/corpus/core/frontmatter.md."""


# --------------------------------------------------------------- the command line
class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise Refusal('the command line of the check is wrong (%s)' % message)


def parse_arguments(argv):
    parser = _Parser(prog=NAME, add_help=False, allow_abbrev=False)
    parser.add_argument('--space', required=True)
    parser.add_argument('--desk', required=True)
    parser.add_argument('--session', required=True)
    parser.add_argument('--path', required=True)
    parser.add_argument('--when', choices=['before', 'after'], default='before')
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


def read_frontmatter(path):
    with open(path, encoding='utf-8') as handle:
        lines = handle.read().split('\n')
    if lines[0] != '---' or '---' not in lines[1:]:
        raise SubsetError('the file does not begin with frontmatter between two --- lines')
    end = lines.index('---', 1)
    return parse_subset('\n'.join(lines[1:end]))


# ------------------------------------------------------------------- shown text
def shown(text):
    """`text` in double quotes on one line: a control character is written as \\xNN."""
    out = []
    for char in text:
        if unicodedata.category(char) in ('Cc', 'Cf', 'Cs', 'Zl', 'Zp'):
            out.append(''.join('\\x%02X' % byte for byte in char.encode('utf-8', 'surrogatepass')))
        else:
            out.append(char)
    return '"%s"' % ''.join(out)


# ------------------------------------------------------------- the desk's records
class RepeatedKey(Exception):
    """A JSON object of a desk record has one key twice."""


def object_without_repeated_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise RepeatedKey(key)
        result[key] = value
    return result


def read_records(desk, file_name):
    """The list `records` of one desk file, which is {"version": 1, "records": [...]}."""
    path = os.path.join(desk, file_name)
    try:
        status = os.stat(path)
    except FileNotFoundError:
        # The companion app treats a desk file that is not there as an empty one.
        return [], path
    except OSError:
        raise Refusal('the desk record %s cannot be read' % shown(path))
    if not stat.S_ISREG(status.st_mode):
        raise Refusal('the desk record %s is not a file' % shown(path))
    if status.st_size > RECORD_SIZE_LIMIT:
        raise Refusal(
            'the desk record %s is larger than %d bytes' % (shown(path), RECORD_SIZE_LIMIT)
        )
    try:
        with open(path, 'rb') as handle:
            text = handle.read(RECORD_SIZE_LIMIT + 1).decode('utf-8')
    except (OSError, UnicodeDecodeError):
        raise Refusal('the desk record %s cannot be read' % shown(path))
    if len(text.encode('utf-8')) > RECORD_SIZE_LIMIT:
        raise Refusal(
            'the desk record %s is larger than %d bytes' % (shown(path), RECORD_SIZE_LIMIT)
        )
    try:
        data = json.loads(text, object_pairs_hook=object_without_repeated_keys)
    except RepeatedKey as repeated:
        raise Refusal(
            'the desk record %s has the key %s twice in one object'
            % (shown(path), shown(str(repeated)))
        )
    except (ValueError, RecursionError):
        raise Refusal('the desk record %s is not JSON' % shown(path))
    if (
        not isinstance(data, dict)
        or type(data.get('version')) is not int
        or data.get('version') != RECORD_VERSION
        or not isinstance(data.get('records'), list)
        or not all(isinstance(record, dict) for record in data['records'])
    ):
        raise Refusal(
            'the desk record "%s" does not have the format {"version": 1, "records": [...]}' % path
        )
    return data['records'], path


def read_mode(desk, session):
    records, path = read_records(desk, 'sessions.json')
    found = [record for record in records if record.get('id') == session]
    if not found:
        # The desk has no record of the session. The companion app reads this as
        # Read only, and so does the check.
        return None
    if len(found) > 1:
        raise Refusal('the desk record "%s" has the session "%s" more than once' % (path, session))
    mode = found[0].get('mode')
    if mode not in ('read-only', 'writing'):
        raise Refusal(
            'the desk record "%s" gives the session "%s" a mode that is neither read-only nor writing'
            % (path, session)
        )
    return mode


def read_claims(desk, session):
    """The write targets that the session holds, as (kind, name, branch) tuples."""
    records, path = read_records(desk, 'claims.json')
    claims = []
    for record in records:
        if record.get('sessionId') != session:
            continue
        target = record.get('target')
        kind = target.get('kind') if isinstance(target, dict) else None
        name = target.get('name') if isinstance(target, dict) else None
        branch = target.get('branch') if isinstance(target, dict) else None
        well_formed = (
            kind == 'lore'
            or (kind == 'publish-area' and isinstance(name, str) and name != '')
            or (
                kind == 'repository'
                and isinstance(name, str)
                and name != ''
                and isinstance(branch, str)
                and branch != ''
            )
        )
        if not well_formed:
            raise Refusal(
                'the desk record "%s" has a claim of the session "%s" whose target cannot be read'
                % (path, session)
            )
        claims.append((kind, name, branch))
    return claims


# ------------------------------------------------------------------------ paths
def segments_below(root, path):
    """The segments of `path` below the folder `root`, or None when it is not below it."""
    prefix = root if root.endswith(os.sep) else root + os.sep
    if not path.startswith(prefix):
        return None
    rest = [segment for segment in path[len(prefix):].split(os.sep) if segment != '']
    return rest if rest else None


def publish_area_of(space, resolved):
    """The name of the publish area that holds `resolved`, or None. Reads lore/space.md."""
    manifest_path = os.path.join(space, 'lore', 'space.md')
    try:
        manifest = read_frontmatter(manifest_path)
    except FileNotFoundError:
        raise Refusal('the manifest "%s" is missing' % manifest_path)
    except (OSError, UnicodeDecodeError, SubsetError):
        raise Refusal('the manifest "%s" cannot be read' % manifest_path)
    areas = manifest.get('publish_areas')
    if not isinstance(areas, list) or not all(isinstance(area, dict) for area in areas):
        raise Refusal('the manifest "%s" has no list publish_areas' % manifest_path)
    for area in areas:
        name = area.get('name')
        if not isinstance(name, str) or name == '':
            raise Refusal('the manifest "%s" has a publish area without a name' % manifest_path)
        if 'path' not in area:
            continue  # outside the Space's folder; see the card, "What the check does not cover"
        path = area.get('path')
        parts = path.split('/') if isinstance(path, str) else ['']
        if any(part in ('', '.', '..') or '\\' in part for part in parts):
            raise Refusal(
                'the manifest "%s" gives the publish area "%s" a path that is not a folder inside the Space'
                % (manifest_path, name)
            )
        if segments_below(os.path.join(space, *parts), resolved) is not None:
            return name
    return None


def run_git(folder, arguments):
    environment = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    environment['GIT_OPTIONAL_LOCKS'] = '0'
    environment['LC_ALL'] = 'C'
    try:
        done = subprocess.run(
            ['git', '-C', folder] + arguments,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=environment,
            timeout=GIT_TIMEOUT_SECONDS,
            shell=False,
        )
    except FileNotFoundError:
        raise Refusal('git was not found, so the checked-out branch cannot be read')
    except (OSError, subprocess.TimeoutExpired):
        raise Refusal('git could not be run, so the checked-out branch cannot be read')
    if done.returncode != 0:
        return None
    return done.stdout.decode('utf-8', 'replace').strip()


def nearest_existing_folder(path):
    folder = os.path.dirname(path)
    while not os.path.isdir(folder):
        parent = os.path.dirname(folder)
        if parent == folder:
            break
        folder = parent
    return folder


def checked_out_branch(space, name, resolved):
    folder = os.path.join(space, 'repos', name)
    if not os.path.isdir(folder):
        raise Refusal('the folder %s of the repository %s does not exist' % (shown(folder), shown(name)))
    top = run_git(folder, ['rev-parse', '--show-toplevel'])
    if top is None or os.path.realpath(top) != folder:
        raise Refusal('the folder %s is not the top folder of a git repository' % shown(folder))
    # A submodule, a worktree or another repository inside the claimed repository
    # has a branch of its own, which the claim does not name.
    inner = run_git(nearest_existing_folder(resolved), ['rev-parse', '--show-toplevel'])
    if inner is None or os.path.realpath(inner) != folder:
        raise Refusal(
            'the path is in another git repository inside the repository %s, or in no working tree of it'
            % shown(name)
        )
    reference = run_git(folder, ['symbolic-ref', '-q', 'HEAD'])
    if not reference or not reference.startswith('refs/heads/'):
        raise Refusal('the repository %s has no branch checked out' % shown(name))
    return reference[len('refs/heads/'):]


# --------------------------------------------------------------------- the decision
def refuse_what_is_not_a_plain_file(resolved):
    """Called before a write is allowed. A path at which nothing exists passes."""
    try:
        status = os.lstat(resolved)
    except FileNotFoundError:
        return
    except OSError:
        raise Refusal('the path cannot be looked at, for example because it is too long')
    if not stat.S_ISREG(status.st_mode):
        raise Refusal('the path exists and is not a file')
    if status.st_nlink > 1:
        raise Refusal(
            'the file has more than one hard link, so a write to it would also change a file at another path'
        )


def decide(space_argument, desk, session, path_argument):
    """Returns the reason the write is allowed, or raises Refusal."""
    for label, value in (('--space', space_argument), ('--desk', desk), ('--path', path_argument)):
        if not os.path.isabs(value):
            raise Refusal('the argument %s is not an absolute path' % label)
    if session == '' or shown(session) != '"%s"' % session:
        raise Refusal('the argument --session is empty or has a control character')

    space = os.path.realpath(space_argument)
    if not os.path.isdir(space):
        raise Refusal('the Space folder %s does not exist' % shown(space_argument))
    # The desk's records are kept outside the Space, where a session's
    # file-writing tools cannot write them. A desk folder inside the Space, or
    # around it, is refused.
    desk_resolved = os.path.realpath(desk)
    if (
        desk_resolved == space
        or segments_below(space, desk_resolved) is not None
        or segments_below(desk_resolved, space) is not None
    ):
        raise Refusal('the desk folder %s is not apart from the Space\'s folder' % shown(desk))

    recorded_mode = read_mode(desk, session)
    mode = recorded_mode if recorded_mode is not None else 'read-only'
    claims = read_claims(desk, session)

    # realpath resolves every symbolic link of the path. For a file that does not
    # exist yet it resolves the links of the folders that do exist, and it removes
    # every ".." segment. The decision is taken on the resolved path only.
    resolved = os.path.realpath(path_argument)

    below = segments_below(space, resolved)
    if below is None:
        raise Refusal('the path is outside the Space\'s folder')
    # A name that refuses is compared without regard to upper and lower case and
    # to the Unicode form, because some file systems take "A" and "a" for one
    # name. A name that allows is compared exactly.
    if any(unicodedata.normalize('NFC', segment).casefold() == '.git' for segment in below):
        raise Refusal('the path is in a folder named ".git", or is a file of that name')

    if below[0] == 'workbench' and len(below) > 1:
        refuse_what_is_not_a_plain_file(resolved)
        return 'the path is in the Workbench, which a session may write in both modes'

    if below[0] == 'lore' and len(below) > 1:
        target = ('lore', None)
        shown_target = 'the Lore'
    elif below[0] == 'repos' and len(below) > 2:
        target = ('repository', below[1])
        shown_target = 'the repository %s' % shown(below[1])
    else:
        area = None if below[0] == 'repos' else publish_area_of(space, resolved)
        if area is None:
            raise Refusal('the path is inside the Space and is not in the Lore, a payload or the Workbench')
        target = ('publish-area', area)
        shown_target = 'the publish area %s' % shown(area)

    if mode == 'read-only':
        if recorded_mode is None:
            raise Refusal(
                'the path is in %s, and the desk has no record of the session "%s", which is therefore in Read only, in which a session writes only to the Workbench'
                % (shown_target, session)
            )
        raise Refusal(
            'the path is in %s, and the session "%s" is in Read only, in which a session writes only to the Workbench'
            % (shown_target, session)
        )

    held = [claim for claim in claims if (claim[0], claim[1]) == target]
    if not held:
        raise Refusal(
            'the path is in %s, which the session "%s" is in Writing without having claimed'
            % (shown_target, session)
        )
    refuse_what_is_not_a_plain_file(resolved)
    if target[0] == 'repository':
        branch = checked_out_branch(space, target[1], resolved)
        if all(claim[2] != branch for claim in held):
            raise Refusal(
                'the session "%s" claimed %s on the branch %s, and the branch checked out is %s'
                % (session, shown_target, shown(held[0][2]), shown(branch))
            )
        return 'the session "%s" is in Writing and has claimed %s on the branch %s' % (
            session,
            shown_target,
            shown(branch),
        )
    return 'the session "%s" is in Writing and has claimed %s' % (session, shown_target)


def describe(path_argument):
    resolved = os.path.realpath(path_argument) if os.path.isabs(path_argument) else path_argument
    if resolved == path_argument:
        return shown(path_argument)
    return '%s (which resolves to %s)' % (shown(path_argument), shown(resolved))


def main(argv):
    path_shown = 'an unknown path'
    try:
        arguments = parse_arguments(argv)
        path_shown = describe(arguments.path)
        reason = decide(arguments.space, arguments.desk, arguments.session, arguments.path)
    except Refusal as refusal:
        sys.stderr.write('%s refuses the write to %s: %s.\n' % (NAME, path_shown, refusal))
        return EXIT_REFUSE
    except Exception as error:  # an error of this script refuses too
        sys.stderr.write(
            '%s refuses the write to %s: the check failed with %s.\n'
            % (NAME, path_shown, type(error).__name__)
        )
        return EXIT_REFUSE
    sys.stdout.write('%s allows the write to %s: %s.\n' % (NAME, path_shown, reason))
    return EXIT_ALLOW


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
