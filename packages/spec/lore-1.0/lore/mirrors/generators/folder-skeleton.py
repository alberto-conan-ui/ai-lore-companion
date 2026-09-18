#!/usr/bin/env python3
"""Print the skeleton of a folder: the listing of what the folder contains.

Command line:

    python3 lore/mirrors/generators/folder-skeleton.py <folder> [--depth N]

This is the skeleton generator for a payload that is a folder, which is what a
publish area is. It reads the folder as it is on disk. It prints to standard
output and writes no file: the caller places the lines in the mirror, under
the key `skeleton`, one list item per line.

One line is printed per file and per folder below <folder>:

- The line is the path relative to <folder>, with forward slashes, written in
  double quotes. The path of a folder ends with a slash.
- Inside the quotes a double quote is written \\" and a backslash is written
  \\\\, as the corpus entry "frontmatter" requires. A character that cannot be
  written inside the quotes (a control character, a line or paragraph
  separator, a byte that is not UTF-8) is written as a percent sign and two
  upper-case hexadecimal digits for each of its UTF-8 bytes, and a percent
  sign itself is written %25.
- A folder is followed by what it contains. Inside one folder the names are in
  the order of their Unicode code points, files and folders together.
- An entry named `.git` is left out, at every level. A symbolic link is
  printed as a file and is not followed.
- With `--depth N`, only entries at most N levels below <folder> are printed.
  A folder at level N is printed without what it contains. Without the
  option, there is no limit.

An empty folder prints nothing, and its stored skeleton is the empty list.
The output has no date and no absolute path, so two runs on the same content
print the same lines.

Exit status: 0 when the skeleton was printed; 2 when the arguments are wrong
or the folder cannot be read, with the reason on standard error.

Python 3.8 or later, standard library only. No network.
"""

import argparse
import os
import sys

IGNORED_NAMES = (".git",)


def cannot_be_quoted(code_point):
    """True for a character that the quoted text of the frontmatter subset cannot hold."""
    if code_point < 0x20 or 0x7F <= code_point <= 0x9F:
        return True
    if code_point in (0x2028, 0x2029):
        return True
    if 0xD800 <= code_point <= 0xDFFF:
        return True
    if 0xFDD0 <= code_point <= 0xFDEF or (code_point & 0xFFFE) == 0xFFFE:
        return True
    return False


def quoted(path):
    """The path as one double-quoted scalar of the frontmatter subset."""
    out = []
    for char in path:
        code_point = ord(char)
        if 0xDC80 <= code_point <= 0xDCFF:
            # A byte of the file name that is not UTF-8 (Python's surrogateescape).
            out.append("%{:02X}".format(code_point - 0xDC00))
        elif char == "%" or cannot_be_quoted(code_point):
            for byte in char.encode("utf-8", "surrogatepass"):
                out.append("%{:02X}".format(byte))
        elif char == '"':
            out.append('\\"')
        elif char == "\\":
            out.append("\\\\")
        else:
            out.append(char)
    return '"' + "".join(out) + '"'


def depth_argument(text):
    """The value of --depth: a whole number, 1 or more."""
    try:
        value = int(text, 10)
    except ValueError:
        raise argparse.ArgumentTypeError("the depth must be a whole number, 1 or more")
    if value < 1:
        raise argparse.ArgumentTypeError("the depth must be a whole number, 1 or more")
    return value


def list_folder(top, depth, entries):
    """Add to `entries` one (parts, is_folder) pair per entry below `top`.

    The walk keeps its own list of what is still to be read and does not call
    itself, so a tree of any depth is read.
    """
    found = []
    pending = [(top, ())]
    while pending:
        folder, parts = pending.pop()
        with os.scandir(folder) as scan:
            children = list(scan)
        for child in children:
            if child.name in IGNORED_NAMES:
                continue
            child_parts = parts + (child.name,)
            is_folder = child.is_dir(follow_symlinks=False)
            found.append((child_parts, is_folder))
            if is_folder and (depth is None or len(child_parts) < depth):
                pending.append((child.path, child_parts))
    # Sorting the tuples of names puts a folder before what it contains, and the
    # names of one folder in the order of their code points.
    entries.extend(sorted(found))


def main(argv):
    parser = argparse.ArgumentParser(
        prog="folder-skeleton.py",
        description="Print the skeleton of a folder, one quoted line per file and folder.",
    )
    parser.add_argument("folder", help="the folder to list")
    parser.add_argument(
        "--depth",
        type=depth_argument,
        default=None,
        metavar="N",
        help="print only entries at most N levels below the folder (default: no limit)",
    )
    args = parser.parse_args(argv)

    if not os.path.isdir(args.folder):
        sys.stderr.write("folder-skeleton: not a folder: {}\n".format(args.folder))
        return 2

    entries = []
    try:
        list_folder(args.folder, args.depth, entries)
    except OSError as error:
        sys.stderr.write("folder-skeleton: cannot read the folder: {}\n".format(error))
        return 2

    lines = []
    for parts, is_folder in entries:
        lines.append(quoted("/".join(parts) + ("/" if is_folder else "")))
    sys.stdout.buffer.write("".join(line + "\n" for line in lines).encode("utf-8"))
    sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
