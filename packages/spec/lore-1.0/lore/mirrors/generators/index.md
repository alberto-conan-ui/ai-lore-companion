---
type: index
---

# Mirrors: skeleton generators

A skeleton generator is a script that reads a payload and prints its skeleton. A mirror's frontmatter names the generator that is used for it. The skeleton of a repository is generated from the repository's default branch, and the skeleton of a publish area is generated from its folder.

Both generators are Python 3 scripts that use only Python's standard library. They need Python 3.8 or later. They are run from the Space's folder with the command line given in their lines below. A generator prints to standard output and writes no file. It does not use the network, and the generator for repositories does not fetch. The generator for repositories starts `git` with a list of arguments and no shell, and it passes on no environment variable whose name begins with `GIT_`, so a variable such as `GIT_DIR` cannot make it read another repository. A folder whose name begins with a hyphen is given after `--`.

## What a generator prints

A generator prints one line per file and one line per folder of the payload. A line is the path of the file or folder, written in double quotes. The path is relative to the top of the payload and uses forward slashes, and the path of a folder ends with a slash. A folder is followed by what it contains, and inside one folder the names are in the order of their Unicode code points. An entry named `.git` is left out. The output has no date and no absolute path, so two runs on the same content print the same lines.

Each line is a scalar in double quotes as the corpus entry [frontmatter](../../corpus/core/frontmatter.md) defines it: inside the quotes, a double quote is written `\"` and a backslash is written `\\`. A character that cannot be written inside the quotes, which is a control character, a line or paragraph separator, or a byte that is not UTF-8, is written as a percent sign and two upper-case hexadecimal digits for each of its UTF-8 bytes. A percent sign in a name is written `%25`.

The stored skeleton of a mirror is these lines, each written as one item of the list `skeleton`: two spaces, a hyphen, a space, and the line as it was printed. When a generator prints nothing, the stored skeleton is `[]`. A mirror is current when its list has the same items, in the same order, as the lines that its generator prints now.

Both generators take the option `--depth N`, where N is a whole number, 1 or more. With it, only the entries at most N levels below the top of the payload are printed, and a folder at level N is printed without what it contains. Without it, everything is printed. A mirror's frontmatter names its generator and has no key for this option, so a stored skeleton that was generated with `--depth` is compared only with a skeleton generated with the same value.

## The scripts

- [folder-skeleton.py](./folder-skeleton.py): prints the skeleton of a folder, which is what a publish area is, from the folder as it is on disk; it is run as `python3 lore/mirrors/generators/folder-skeleton.py <folder> [--depth N]`.
- [repository-skeleton.py](./repository-skeleton.py): prints the skeleton of a repository from the tree of its default branch, read through git and not from the working tree, and prints nothing for a repository with no commits; it is run as `python3 lore/mirrors/generators/repository-skeleton.py <repository> [--depth N]`.

## Choices recorded here

The product document of AI-Lore 1.0 says that a skeleton is the part of a mirror that a script can regenerate from the payload, that the skeleton of the default publish area is the listing of its folder, and that the skeleton of a repository is generated from its default branch. It does not say what a line of a skeleton looks like. The session that wrote these scripts on 2026-09-18 made the following choices. Each is open to the Human Lead's review. The list is numbered because, in an index, a line that begins with a hyphen is the line of a child.

1. The two file names, `folder-skeleton.py` and `repository-skeleton.py`.
2. A line is a path in double quotes, a folder's path ends with a slash, and folders are listed as well as files.
3. The percent sign form for the characters that the quoted text of the frontmatter subset cannot hold.
4. Without `--depth`, the whole payload is listed. The mirror card has no key that holds the value of `--depth`. The product document gives a mirror three things in its frontmatter, which are its payload, its generator and its stored skeleton, and this folder adds no fourth. A mirror whose skeleton was stored with `--depth` says so in its prose, with the command line, as the mirror `publish.md` does for its own command line.
5. The generator for repositories takes the default branch from the reference `refs/remotes/origin/HEAD`, which a clone has, and reads that branch as the desk last fetched it. In a repository that has no remote named `origin`, it reads the branch that `HEAD` names. In a repository that has a remote named `origin` and no such reference, it ends with exit status 2 and names the command `git remote set-head origin --auto`, which writes the reference. It does not read the branch that is checked out there, because that branch may be an item branch.
6. A repository with no commits has an empty skeleton, as an empty folder has. The generator prints nothing on standard output, says on standard error that the repository has no commits, and ends with exit status 0.
7. The generator for repositories prints a symbolic link as a file and a submodule as a folder without what it contains. The generator for folders prints a symbolic link as a file and does not follow it.
8. The generator for folders leaves out only entries named `.git`. It lists every other file that is in the folder, including files that the desk's operating system adds.
