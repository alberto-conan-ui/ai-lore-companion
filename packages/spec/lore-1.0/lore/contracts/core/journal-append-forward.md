---
type: contract
name: journal-append-forward
pillar: working
target: journal
check: lore/contracts/core/journal-append-forward.py
when: before
---

# journal-append-forward

This contract guards the pillar Working. Its target is the journal, the folder `workbench/journal/` of the Workbench. It has a rule and a check. The check script is `journal-append-forward.py`, in this folder, and it runs before a write.

## The rule

A journal entry of a previous session is never changed. A correction to a past entry is written in the entry of the current session.

The journal has one entry per session, and each session adds its entry when it closes. The next session reads the last handover and continues from it, so an entry that was changed later would no longer say what its session handed over.

## The check

Before a write, the check looks at the path to be written.

1. The path is not in `workbench/journal/`: allowed, because the journal is this contract's only target.
2. The path is in `workbench/journal/` and no file exists there: allowed. The write adds a new entry.
3. The path is in `workbench/journal/`, a file exists there, and the name of the file ends with a hyphen, the id of the current session and `.md`: allowed. The file is the entry of the current session, and the session writes it again, for example to correct it before the session ends.
4. The path is in `workbench/journal/` and any other file exists there: refused.

The check knows the entry of the current session by the name of its file and by nothing else. The name of an entry's file therefore ends with the id of the session that writes it, as in `2026-09-18-1430-verb-cards-<session id>.md`: the date, the time, a few words and the session id, with hyphens between them. The default verb session-close writes this name. An entry whose name does not end with the id of the session that wrote it can be written once, and after that no session can change it, the session that wrote it included. The section "Choices recorded here" gives the reason.

The Workbench is always writable under the contract write-guard. This contract is the one limit on a write inside the Workbench.

## How the check is run

```
python3 <absolute path>/journal-append-forward.py --space <Space folder> --path <file to be written>
        --session <session id>
```

- `--space` is the Space's folder and `--path` is the file that is about to be written. Both are absolute paths.
- `--session` is the id that the companion app gave the session. The check uses it for decision 3 only. It applies decision 3 when the id begins with a letter or a digit and has only letters, digits, dots, underscores and hyphens. Without `--session`, or with another id, every entry that exists is refused.
- `--desk` and `--when before` are accepted and not read, so that all three check scripts of this folder can be called with the same arguments.
- Exit code `0` means that the write is allowed. The script prints one sentence on standard output.
- Exit code `2` means that the write is refused. The script prints one sentence on standard error. The sentence begins with `journal-append-forward refuses the write to`, names the path, and gives the reason.
- The script has no other exit code. A wrong command line and an error inside the script also end with exit code `2`.

The check looks at the path twice: as it is written, with every `..` segment removed, and with every symbolic link resolved. An entry that exists is found in both ways. A symbolic link in `workbench/journal/` counts as an entry of another session, whatever its name is, and an entry of another session that is reached through a link from another folder is refused as well. The check finds the folder `workbench/journal/` without regard to upper-case and lower-case letters, because some file systems take `Journal` and `journal` for one name.

The script needs Python 3.8 or later and uses only Python's standard library. It reads the names of files. It writes no file, starts no other program and uses no network. It does not depend on the folder from which it is started, and it reads no desk record.

## What the check does not cover

- A shell command that changes or removes an entry. The check runs for the file edits of the AI engine's file-writing tools, as the check of write-guard does.
- The removal of an entry. The check sees writes and not deletions.
- What an entry says. That an entry ends with a handover is asked for by the verb that writes it and not by this contract.

## Why it is core

The journal is the record of what each session did and handed over. The next session and the Human Lead can rely on an entry only when no later session can have changed it.

## Choices recorded here

The product document of AI-Lore 1.0 fixes the rule, and it says that the check refuses a write to a journal entry of a previous session. The command line and the exit codes are proposals of the architecture document of the first build, which the Human Lead has not yet accepted. The session that wrote this card on 2026-09-18 made the following further choices. Each is open to the Human Lead's review.

- The check knows the entry of the current session by the end of the file's name. The product document says that the check refuses a write to an entry of a previous session, that a session journals while it works, and that a correction is recorded in the current session's entry, so the current session's entry is written more than once. The product document does not say how a journal entry's file is named, and the desk's records do not say which session wrote a file. The session id at the end of the name is this card's way to tell the two apart.
- An entry whose name does not end with the id of the session that wrote it is refused to that session as well. The check then has nothing to read that tells it from an entry of an earlier session, and it refuses.
- The default verb session-close names the entry's file with the date, the time, a few words and the session id at the end, as in the example above, and writes the entry once and complete when the session closes. A session is told its id in the claims that the companion returns when it enters Writing. A session that does not know its id leaves it out of the name, and its entry can then be written once, which is all that session-close needs. Whether the companion tells every session its id when it starts it is a question for the Human Lead, and the card of session-close records it.
- Every file in `workbench/journal/` and in its subfolders is an entry. The product document names no other file there.
- The check looks at the written path and at the resolved path, so that a symbolic link cannot hide an entry that exists.
