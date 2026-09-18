---
type: contract
name: lore-integrity
pillar: shaping
target: lore
check: lore/contracts/core/lore-integrity.py
when: both
---

# lore-integrity

This contract guards the pillar Shaping. Its target is the Lore, the folder `lore/`. It has two checks and no rule beyond them. The check script is `lore-integrity.py`, in this folder. One of its checks runs before a write to the Lore and the other runs after it.

## The rule

There is no rule beyond the two checks. What the checks require is this: the files of the core and default layers are not edited in place, no file of the Space takes the name of a core file, every markdown file of the Lore has frontmatter that can be read, every reference resolves, and every folder's index lists exactly the folder's children.

## The check before a write

The check refuses a write to a file that is under a folder named `core` or `default`, anywhere in `lore/`. These are the files of the core and default layers. Setup places them and an upgrade of AI-Lore replaces them as a whole. To change a default, the Human Lead writes a file with the same name beside the `default/` folder.

The check also refuses a write to a file directly in the folder of a part, `lore/<part>/<name>`, when `lore/<part>/core/` holds a file with the same name. Nothing in a Space may take the name of a core file. `index.md` is the exception, because every folder has one.

Both comparisons are made without regard to upper-case and lower-case letters, because some file systems take `Core` and `core` for one name.

A write to a path that is not in `lore/` is allowed by this check, because the Lore is its only target. Whether the session may write to the Lore at all is decided by the contract write-guard.

## The check after a write

The check reads the whole Lore and not only the file that was written, because a new file makes its folder's index wrong, and a removed file can break a reference in another file. It looks for four things.

1. **Frontmatter.** Every file in `lore/` whose name ends in `.md` begins with frontmatter between two `---` lines. The frontmatter stays inside the subset that the corpus entry `lore/corpus/core/frontmatter.md` defines. It has the key `type`, with one of the values `corpus`, `verb`, `process`, `contract`, `mirror`, `index` and `space`. The value `index` is used by every `index.md` and by no other file.
2. **References.** Every reference resolves to a file or a folder that exists. A reference is one of two things. The first is a path in the frontmatter keys `points_at`, `check` and `generator`; such a path is relative to the Space's folder. The second is a markdown link in the prose whose target is relative to the file. A reference that points outside the Space's folder is a finding. Web addresses are not checked, and in a reference with a `#` only the part before the `#` is checked.
3. **Indexes.** Every folder in `lore/` has an `index.md`. The index has one line for each file and each subfolder of its folder, in the form that `ai_readme.md` gives, and no line for anything that is not in the folder. `index.md` itself and names that begin with a dot are not children. A check script is a child, and it has a line.
4. **Core names.** No file directly in `lore/<part>/`, and no file in `lore/<part>/default/`, has the name of a file in `lore/<part>/core/`. `index.md` is not compared. Such a file is a finding. The architecture document of the first build says that the companion app reports such a file and does not use it.

Each thing that is wrong is a finding. A failure is reported to the session, and the session fixes every finding before it leaves Writing.

The check does not look at text inside a fenced code block or inside inline code, so an example of an index line or of a link in a card is not read as a real one.

## How the check is run

```
python3 <absolute path>/lore-integrity.py --space <Space folder> --when before --path <file to be written>
python3 <absolute path>/lore-integrity.py --space <Space folder> --when after
```

- `--space` is the Space's folder and `--path` is the file that is about to be written. Both are absolute paths. `--when` is required.
- `--desk` and `--session` are accepted and not read, so that all three check scripts of this folder can be called with the same arguments. With `--when after`, `--path` is accepted and not read.
- Exit code `0` means that the write is allowed, or that the Lore passes. The script prints one sentence on standard output.
- Exit code `2` means that the write is refused, or that the Lore fails. For a refused write the script prints one sentence on standard error, which begins with `lore-integrity refuses the write to`, names the path, and gives the reason. For a Lore that fails it prints one line per finding, sorted, each with the path of the file relative to the Space's folder, and a last line with the number of findings.
- The script has no other exit code. A wrong command line and an error inside the script also end with exit code `2`.

Before it decides on a write, the check resolves every symbolic link in the path and removes every `..` segment, as the check of write-guard does. A link from the Workbench into a `core/` folder is judged as a write to that folder.

The script needs Python 3.8 or later and uses only Python's standard library. It reads files. It writes no file, starts no other program and uses no network. It does not depend on the folder from which it is started, and it reads no desk record. A person can run the second command from a command line at any time to check a Lore.

## What the check does not cover

- It does not check that a card has the keys of its kind, as the corpus entry `lore/corpus/core/card.md` lists them. It checks that the frontmatter can be read and has a known `type`.
- It compares names with the `core/` folder of a part only for the files directly in the part's folder and in its `default/` folder, and not for files in other subfolders.
- It does not check that the section named after a `#` exists.
- It does not check a path in `points_at` that begins with `repos/` or `workbench/`. The Space repository git-ignores both folders, so what they hold differs from one desk to another.

## Why it is core

A session reads the indexes to know what the Lore holds, and it follows references from one file to another. An index or a reference that is wrong stops the next session from following the Lore.

## Choices recorded here

The product document of AI-Lore 1.0 fixes what the two checks look for. The command line and the exit codes are proposals of the architecture document of the first build, which the Human Lead has not yet accepted. The session that wrote this card on 2026-09-18 made the following further choices. Each is open to the Human Lead's review.

- The script is told which of its two checks to run by the argument `--when`.
- "Under a `core/` or `default/` folder" is read as: any folder of the path below `lore/` is named `core` or `default`. A folder of the Space's own with one of these two names is therefore protected too.
- "Every reference" is read as the paths in the three frontmatter keys above and the relative markdown links of the prose. The product document does not say which.
- A reference may resolve to a folder, and not only to a file, because an index line for a subfolder and a `points_at` item can name a folder.
- A `points_at` path into `repos/` or `workbench/` is not checked, for the reason given above.
- The check of core names, before a write and after it. The product document says that nothing in a Space can take the name of a core file, and it does not list this among the things that the check looks for. The tester session of 2026-09-18 added it, so that such a file is refused when it is written and is a finding when it is there.
- The first and the third limit listed under "What the check does not cover" keep the check to what the product document names.
- The sentence that the session fixes every finding before it leaves Writing is the product document's. In the first build no script stops a session from leaving Writing while the Lore fails this check; the architecture document gives that as its default and leaves the question to the Human Lead.
- The script carries its own reader for the frontmatter subset, and shares no file with the other two scripts.
