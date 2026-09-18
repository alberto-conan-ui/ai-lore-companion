---
type: contract
name: write-guard
pillar: working
target: everything
check: lore/contracts/core/write-guard.py
when: before
---

# write-guard

This contract guards the pillar Working. Its target is everything: every file that a session writes, in the Space's folder or outside it. It has a rule and a check. The check script is `write-guard.py`, in this folder, and it runs before a write.

## The rule

A session writes only what it has claimed.

A session is in one of two modes, Read only and Writing. In Read only it changes no payload and nothing in the Lore. It enters Writing by naming its write targets and claiming them, and the Human Lead confirms the claim in the companion app's dialog. A write target is the Lore, a publish area, or a repository on one named branch. In Writing the session writes inside its write targets, and for a repository only while the claimed branch is the branch that is checked out. The Workbench is not a write target, and a session may write to it in both modes.

## The check

Before a write, the check reads the session's mode and its claims from the desk's records and takes the first decision below that applies.

1. The desk folder is inside the Space's folder, or the Space's folder is inside the desk folder: the write is refused, whatever its path.
2. A desk record that the check needs is there and cannot be read: the write is refused, whatever its path. The refusal names the file.
3. The path is outside the Space's folder: refused.
4. A folder of the path is named `.git`, or the file itself is, in any mix of upper-case and lower-case letters: refused, in both modes.
5. The path is in `workbench/`: allowed, in both modes.
6. The path is in `lore/`, in `repos/<name>/` or in the folder of a publish area, and the session is in Read only: refused. The refusal names the mode. A session of which the desk has no record is in Read only, and the refusal says that the desk has no record of it.
7. The path is in one of those three places, the session is in Writing, and the session has no claim on that target: refused.
8. The path is in a repository that the session has claimed, and the branch that is checked out in `repos/<name>/` is not the claimed branch: refused. The refusal names both branches. The write is also refused when the repository has no branch checked out, when `repos/<name>/` is not the top folder of a git repository, and when the path is in another git repository inside `repos/<name>/`, which is the case of a submodule, of a worktree and of a repository that was cloned there.
9. The path is in a target that the session has claimed, and for a repository the claimed branch is checked out: allowed.
10. Any other path inside the Space's folder, for example `ai_readme.md` or a file directly in `repos/`: refused, in both modes.

Before the check allows a write under decision 5 or 9, it looks at what is at the path. When nothing is there, the write is allowed. When a folder is there, or anything else that is not a file, the write is refused. When a file is there and it has more than one hard link, the write is refused, because the same file is then at another path as well, and the check cannot see that path.

The check decides for the session whose id it is given. It does not decide whether a claim was rightly granted, and it does not look at the claims of other sessions. The companion app grants a claim and writes it to the desk's records, after the Human Lead has confirmed it.

## What enforces the check

What enforces the check depends on the kind of write.

- A file edit by the AI engine's file-writing tools. The path is known before the write, the engine runs the check, and the check decides.
- A shell command. The engine sees only the command's text and cannot always tell which files the command will write. The check does not run for shell commands. There the limit is set by the AI engine's own permission rules, where the engine has them, and by the rule above, where it has none.

On an AI engine that cannot run a check before a write, this contract holds as its rule only.

## How the check is run

```
python3 <absolute path>/write-guard.py --space <Space folder> --desk <desk folder>
        --session <session id> --path <file to be written>
```

- `--space` is the Space's folder. `--desk` is the folder in which the companion app keeps the desk's records. `--path` is the file that is about to be written. All three are absolute paths. `--session` is the id that the companion app gave the session.
- `--when before` is accepted and changes nothing, so that all three check scripts of this folder can be called with the same arguments.
- Exit code `0` means that the write is allowed. The script prints one sentence on standard output.
- Exit code `2` means that the write is refused. The script prints one sentence on standard error. The sentence begins with `write-guard refuses the write to`, names the path, and gives the reason.
- The script has no other exit code. A wrong command line and an error inside the script also end with exit code `2`, and the sentence then says that the command line is wrong or that the check failed. The section "Choices recorded here" gives the reason.
- In the sentence, a control character of a path or of a name is written as `\x` and two hexadecimal digits for each of its bytes, so the sentence stays on one line.

The script needs Python 3.8 or later and uses only Python's standard library. It reads files, and it starts `git` with a list of arguments and no shell to read the branch that is checked out in a repository. It writes no file and uses no network. It does not depend on the folder from which it is started. It imports no other file of this folder, so it can be copied out of the Lore and run alone.

## The desk records that the check reads

The check reads two files in the desk folder. Each is JSON of the form `{ "version": 1, "records": [...] }`. The companion app writes them, and a session does not.

- `sessions.json`. From the record whose `id` is the session's id, the check reads `mode`, which is `read-only` or `writing`.
- `claims.json`. From each record whose `sessionId` is the session's id, the check reads `target`. `target.kind` is `lore`, `publish-area` or `repository`. `target.name` is the name of the publish area or of the repository, as `lore/space.md` writes it. `target.branch` is the claimed branch of a repository.

The check reads no other field, and it accepts fields that it does not know. It does not read the claims of other sessions.

A file that is not there is read as a file with no records. A session that has no record in `sessions.json` is in Read only, and a session that has no record in `claims.json` holds no target. Such a session writes to the Workbench and to nothing else.

A file that is there and cannot be read refuses every write, a write to the Workbench included. This is the case when one of the two files is not a file, is larger than 8388608 bytes, is not JSON, has one key twice in one object, has a `version` other than `1`, or has no list `records` of objects; when `sessions.json` has more than one record for the session; when the session's `mode` is neither of the two values; and when a claim of the session has a target that cannot be read.

A change to the names or the meaning of these fields needs a change to the script in the same piece of work.

The check also reads the frontmatter of `lore/space.md`, for the `name` and the `path` of each publish area. It reads this file only for a path that is not in `lore/`, in `repos/` or in `workbench/`, so a manifest that cannot be read stops writes to a publish area and does not stop the repair of the manifest.

## How the check reads a path

Before it decides, the check resolves every symbolic link in the Space's folder and in the path to be written, and removes every `..` segment. For a file that does not exist yet, it resolves the folders of the path that do exist. It decides on the resolved path only. A link in the Workbench that points into `lore/` or into `repos/` is therefore judged as a write to the Lore or to the repository, and a link that points outside the Space's folder is judged as a write outside the Space.

The check then compares the resolved path with the folders `lore`, `repos/<name>`, `workbench` and the `path` of each publish area, below the resolved Space folder. The folder of a repository is always `repos/<name>`, so the check needs no list of repositories.

The names `lore`, `repos`, `workbench`, the name of a repository and the path of a publish area are compared exactly, letter by letter. Some file systems take `Lore` and `lore` for one name. On such a file system a path that is written `LORE/corpus/term.md` reaches the Lore, and the check refuses it under decision 10, because `LORE` is none of the names above. A repository that is claimed as `app` is not claimed as `APP`. The name `.git` is the one name that the check compares without regard to upper-case and lower-case letters, because it only refuses.

When the check starts `git`, it passes on no environment variable whose name begins with `GIT_`, so a variable such as `GIT_DIR` cannot make `git` answer for another repository. It reads the branch as the full reference that `HEAD` names, so a tag with the name of the branch does not change what it reads.

## What the check does not cover

- Shell commands, as said above.
- A session that the companion app did not start. Such a session has no record on the desk, and no engine setting calls the check for it.
- A publish area outside the Space's folder. `lore/space.md` holds no path for it, and the check has no other place to read one from, so a write to it is refused as a path outside the Space.
- A repository, a publish area, the Lore or the Workbench whose folder is itself a symbolic link to another place. The check decides on the resolved path, so a write through such a folder is refused.

## Why it is core

Without this contract a session's mode and its claims are statements that nothing checks. With it, a file edit outside the claim is refused before it happens.

## Choices recorded here

The product document of AI-Lore 1.0 fixes the rule and what the check refuses. The command line, the exit codes, the path rule, the refusal of a path that is neither Lore, payload nor Workbench, and the refusal when a desk record cannot be read are proposals of the architecture document of the first build, which the Human Lead has not yet accepted. The format of the desk's records is a proposal of the same document. The session that wrote this card on 2026-09-18 made the following further choices. Each is open to the Human Lead's review.

- A desk file that is not there, and a session that has no record, mean Read only with no target. The architecture document says that the companion app treats a desk file that it cannot read as empty, and that an empty `sessions.json` means that every session is in Read only. The check follows it, so the Workbench stays writable, as the product document says it always is.
- A desk file that is there and cannot be read refuses a write to the Workbench too. The architecture document proposes that the check refuses when it cannot read the desk's record. A file that is there and is not in the format points to an installation that is not working, which is reported sooner when every write is refused.
- A usage error and an error inside the script end with exit code `2`, the same code as a refusal, and not with a code of their own. The architecture document gives two codes, `0` and `2`. Claude Code stops a write only when a hook ends with exit code `2`, and continues after any other code, so a third code would let a write through wherever the script is called without an adapter between it and the engine. The sentence on standard error says which of the three cases it is.
- A path with a folder named `.git` is refused, in a claimed repository too. A file in `.git/` can change the branch that is checked out, or hold a script that `git` runs, and the file-writing tools have no need to write there.
- A file with more than one hard link is refused, and a path in another git repository inside a claimed repository is refused. The sources cover neither case.
- A desk folder inside the Space's folder is refused. The architecture document keeps the desk's records outside the Space so that a session cannot write them.
- A desk file larger than 8388608 bytes, and a JSON object with one key twice, are refused. JSON readers do not agree on which of two values counts.
- The check does not read `closedAt` or any other field of a session's record. The companion app releases the claims and sets the mode when a session leaves Writing or closes.
- The check decides on the fully resolved path and compares it with folder names below the resolved Space folder. The architecture document proposed to resolve the folder of each target as well. This card's rule is stricter: a target whose folder is a symbolic link is not writable through the check.
- The check reads the checked-out branch with `git symbolic-ref`, and first confirms with `git rev-parse --show-toplevel` that `repos/<name>/` is the top folder of a repository. Without the second command, `git` would answer for the Space repository when `repos/<name>/` is a plain folder.
- `--when` is accepted so that the three scripts share one command line.
- The script carries its own reader for the frontmatter subset, and shares no file with the other two scripts.
