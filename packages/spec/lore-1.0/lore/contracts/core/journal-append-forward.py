#!/usr/bin/env python3
"""journal-append-forward.py: the check script of the contract journal-append-forward.

The card is lore/contracts/core/journal-append-forward.md. It states the rule,
the command line and the choices made.

Command line (every path is absolute):

  python3 journal-append-forward.py --space <Space folder> --path <file to be written>
                                    [--when before]

                                    [--session <session id>]

  With --session, an entry that exists may be written when the name of its file
  ends with -<session id>.md. Without it, no entry that exists may be written.
  --desk <desk folder> is accepted and not read.

Exit code 0: the write is allowed. One sentence is printed on standard output.
Exit code 2: the write is refused. One sentence is printed on standard error.
There is no other exit code: a wrong command line and an error inside this
script refuse.

Python 3.8 or later, standard library only. The script reads the names of
files. It writes no file, starts no other program and uses no network.
"""
import argparse
import os
import re
import sys
import unicodedata

NAME = 'journal-append-forward'
EXIT_ALLOW = 0
EXIT_REFUSE = 2
# A session id that can end the name of a file.
SESSION_ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]*\Z')


class Refusal(Exception):
    """The write is refused. The message is the reason, written as a clause."""


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise Refusal('the command line of the check is wrong (%s)' % message)


def parse_arguments(argv):
    parser = _Parser(prog=NAME, add_help=False, allow_abbrev=False)
    parser.add_argument('--space', required=True)
    parser.add_argument('--path', required=True)
    parser.add_argument('--when', choices=['before', 'after'], default='before')
    parser.add_argument('--desk')
    parser.add_argument('--session')
    return parser.parse_args(argv)


def shown(text):
    """`text` in double quotes on one line: a control character is written as \\xNN."""
    out = []
    for char in text:
        if unicodedata.category(char) in ('Cc', 'Cf', 'Cs', 'Zl', 'Zp'):
            out.append(''.join('\\x%02X' % byte for byte in char.encode('utf-8', 'surrogatepass')))
        else:
            out.append(char)
    return '"%s"' % ''.join(out)


def folded(path):
    """`path` for a comparison without regard to upper and lower case and to the Unicode form."""
    return unicodedata.normalize('NFC', path).casefold()


def is_below(root, path):
    # Some file systems take "Journal" and "journal" for one name, so the
    # comparison that finds the journal does not look at case.
    root, path = folded(root), folded(path)
    prefix = root if root.endswith(os.sep) else root + os.sep
    return path.startswith(prefix) and path != prefix


def is_own_entry(path, session):
    """True when `path` is a file, not a link, whose name ends with -<session id>.md."""
    if session is None or not SESSION_ID.match(session):
        return False
    if os.path.islink(path) or not os.path.isfile(path):
        return False
    return os.path.basename(path).endswith('-' + session + '.md')


def decide(space_argument, path_argument, session):
    """Returns the reason the write is allowed, or raises Refusal."""
    for label, value in (('--space', space_argument), ('--path', path_argument)):
        if not os.path.isabs(value):
            raise Refusal('the argument %s is not an absolute path' % label)
    if not os.path.isdir(space_argument):
        raise Refusal('the Space folder "%s" does not exist' % space_argument)

    # The path is looked at twice: as it is written, with its ".." segments
    # removed, and with every symbolic link resolved. A link in the journal's
    # folder is an entry of the journal, and so is a journal entry that is
    # reached through a link from another folder.
    written = (
        os.path.join(os.path.normpath(space_argument), 'workbench', 'journal'),
        os.path.normpath(path_argument),
    )
    resolved = (
        os.path.join(os.path.realpath(space_argument), 'workbench', 'journal'),
        os.path.realpath(path_argument),
    )
    in_journal = False
    own = False
    for journal, path in (written, resolved):
        if not is_below(journal, path):
            continue
        in_journal = True
        if not os.path.lexists(path):
            continue
        if not is_own_entry(path, session):
            raise Refusal(
                'the journal entry exists and its name does not end with the id of the current session, and the journal entry of another session is not changed: a correction is written in the entry of the current session'
            )
        own = True
    if not in_journal:
        return 'the path is not in the journal'
    if own:
        return 'the path is the journal entry of the current session, whose id ends the name of the file'
    return 'the path is in the journal and no file exists there, so the write adds a new entry'


def main(argv):
    path_shown = 'an unknown path'
    try:
        arguments = parse_arguments(argv)
        path_shown = shown(arguments.path)
        reason = decide(arguments.space, arguments.path, arguments.session)
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
