#!/usr/bin/env python3
"""Print the skeleton of a git repository: the listing of its default branch.

Command line:

    python3 lore/mirrors/generators/repository-skeleton.py <repository> [--depth N]

This is the skeleton generator for a payload that is a repository. <repository>
is the top folder of the repository's checkout, for example `repos/<name>`.
The script reads the tree of the default branch through git. It does not read
the working tree, so a file that is not committed, and a file that is
committed only on another branch, is not in the skeleton. It prints to
standard output and writes no file: the caller places the lines in the
mirror, under the key `skeleton`, one list item per line.

Which branch is read:

- When the repository has the reference `refs/remotes/origin/HEAD`, which a
  clone has, the default branch is the branch that this reference names, and
  the script reads it as the desk last fetched it (`origin/<branch>`). The
  script does not fetch.
- A repository that has no remote named `origin` has no such reference, and
  the script reads the branch that `HEAD` names.
- A repository that has a remote named `origin` and no such reference is an
  error, because the branch that is checked out may be an item branch. The
  command `git remote set-head origin --auto` writes the reference.

One line is printed per file and per folder of that tree:

- The line is the path relative to the top of the repository, with forward
  slashes, written in double quotes. The path of a folder ends with a slash.
- Inside the quotes a double quote is written \\" and a backslash is written
  \\\\, as the corpus entry "frontmatter" requires. A character that cannot be
  written inside the quotes (a control character, a line or paragraph
  separator, a byte that is not UTF-8) is written as a percent sign and two
  upper-case hexadecimal digits for each of its UTF-8 bytes, and a percent
  sign itself is written %25.
- A folder is followed by what it contains. Inside one folder the names are in
  the order of their Unicode code points, files and folders together.
- A symbolic link is printed as a file. A submodule is printed as a folder,
  without what it contains. An entry named `.git` is left out.
- With `--depth N`, only entries at most N levels below the top are printed.
  A folder at level N is printed without what it contains. Without the
  option, there is no limit.

When the repository has no commits, the script prints nothing on standard
output, as the generator for folders does for an empty folder, and the stored
skeleton is the empty list. It says so in one sentence on standard error and
exits with status 0.

The output has no date, no commit id and no absolute path, so two runs on the
same default branch print the same lines.

Exit status: 0 when the skeleton was printed; 2 when the arguments are wrong,
<repository> is not the top folder of a git repository, the branch cannot be
found, or git fails, with the reason on standard error.

Python 3.8 or later, standard library only. git is called with an argument
list and without a shell. No network.
"""

import argparse
import os
import subprocess
import sys

IGNORED_NAMES = (".git",)
NO_COMMITS = "the repository has no commits, so its skeleton is empty"


class SkeletonError(Exception):
    """A reason the skeleton cannot be printed; its text goes to standard error."""


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


def run_git(repository, arguments):
    """Run git in the repository. Returns (exit status, standard output as bytes)."""
    # No variable of git is passed on: GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE,
    # GIT_OBJECT_DIRECTORY, GIT_CONFIG_COUNT and the others would make git read
    # another repository or another configuration.
    environment = {
        name: value for name, value in os.environ.items() if not name.upper().startswith("GIT_")
    }
    environment["GIT_OPTIONAL_LOCKS"] = "0"
    environment["LC_ALL"] = "C"
    try:
        done = subprocess.run(
            ["git", "-C", repository] + list(arguments),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=environment,
            check=False,
        )
    except OSError as error:
        raise SkeletonError("git could not be started: {}".format(error))
    return done.returncode, done.stdout


def text_of(output):
    return output.decode("utf-8", "surrogateescape").strip()


def default_branch_reference(repository):
    """The full name of the reference whose tree is the skeleton's source."""
    status, output = run_git(repository, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"])
    if status == 0 and text_of(output).startswith("refs/remotes/origin/"):
        return text_of(output)
    status, output = run_git(repository, ["config", "--get", "remote.origin.url"])
    if status == 0 and text_of(output):
        raise SkeletonError(
            "the default branch is not known: the repository has a remote named origin and no "
            "refs/remotes/origin/HEAD; the command `git remote set-head origin --auto`, run in "
            "the repository, writes that reference"
        )
    status, output = run_git(repository, ["symbolic-ref", "--quiet", "HEAD"])
    if status == 0 and text_of(output).startswith("refs/heads/"):
        return text_of(output)
    raise SkeletonError(
        "the default branch is not known: the repository has no remote named origin "
        "and HEAD names no branch"
    )


def tree_entries(repository, reference, depth):
    """One (parts, is_folder) pair per file and folder of the reference's tree."""
    status, output = run_git(repository, ["ls-tree", "-r", "-z", "--full-tree", reference])
    if status != 0:
        raise SkeletonError("git ls-tree failed on {}".format(reference))
    found = {}
    for record in output.split(b"\0"):
        if not record:
            continue
        head, _, raw_path = record.partition(b"\t")
        fields = head.split(b" ")
        kind = fields[1] if len(fields) > 1 else b""
        parts = tuple(raw_path.decode("utf-8", "surrogateescape").split("/"))
        if any(part in IGNORED_NAMES for part in parts):
            continue
        for length in range(1, len(parts)):
            if depth is None or length <= depth:
                found[parts[:length]] = True
        if depth is None or len(parts) <= depth:
            # A submodule is recorded as a commit; it is a folder of the checkout.
            found.setdefault(parts, kind == b"commit")
    return sorted(found.items())


def skeleton_lines(repository, depth):
    status, output = run_git(repository, ["rev-parse", "--show-prefix"])
    if status != 0:
        raise SkeletonError("not a git repository: {}".format(repository))
    if text_of(output):
        raise SkeletonError("not the top folder of a git repository: {}".format(repository))

    status, output = run_git(repository, ["rev-list", "--all", "--max-count=1"])
    if status == 0 and not text_of(output):
        return None  # no branch and no remote branch has a commit

    reference = default_branch_reference(repository)
    status, _ = run_git(repository, ["rev-parse", "--verify", "--quiet", reference + "^{commit}"])
    if status != 0:
        raise SkeletonError("the branch {} has no commit".format(reference))

    lines = []
    for parts, is_folder in tree_entries(repository, reference, depth):
        lines.append(quoted("/".join(parts) + ("/" if is_folder else "")))
    return lines


def main(argv):
    parser = argparse.ArgumentParser(
        prog="repository-skeleton.py",
        description="Print the skeleton of a git repository from its default branch, "
        "one quoted line per file and folder.",
    )
    parser.add_argument("repository", help="the top folder of the repository's checkout")
    parser.add_argument(
        "--depth",
        type=depth_argument,
        default=None,
        metavar="N",
        help="print only entries at most N levels below the top (default: no limit)",
    )
    args = parser.parse_args(argv)

    if not os.path.isdir(args.repository):
        sys.stderr.write("repository-skeleton: not a folder: {}\n".format(args.repository))
        return 2
    try:
        lines = skeleton_lines(args.repository, args.depth)
    except SkeletonError as error:
        sys.stderr.write("repository-skeleton: {}\n".format(error))
        return 2
    if lines is None:
        sys.stderr.write("repository-skeleton: {}.\n".format(NO_COMMITS))
        return 0

    sys.stdout.buffer.write("".join(line + "\n" for line in lines).encode("utf-8"))
    sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
