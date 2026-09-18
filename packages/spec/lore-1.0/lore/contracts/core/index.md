---
type: index
---

# Contracts: core

The contracts that AI-Lore itself fixes, each with its check script where a check is possible. These files are core: they are not edited in place, an upgrade of AI-Lore replaces them as a whole, and no other file in the Space may take the name of one of them.

Three of the five contracts have a check script, and the script has a line of its own below. The other two have only a rule, and their cards say so. A check script is run as `python3` followed by the script's absolute path, and each card gives its script's arguments and exit codes.

- [write-guard.md](./write-guard.md): a session writes only what it has claimed, and the Workbench is always writable; guards Working, with a check before every write.
- [write-guard.py](./write-guard.py): the check script of write-guard, which reads the session's mode and claims from the desk's records and allows or refuses a write by its path.
- [lore-integrity.md](./lore-integrity.md): core and default files are not edited in place, no file takes the name of a core file, frontmatter can be read, references resolve, and every index lists exactly its folder's children; guards Shaping, with a check before and a check after a write to the Lore.
- [lore-integrity.py](./lore-integrity.py): the check script of lore-integrity, which refuses a write under a `core/` or `default/` folder and a write that takes the name of a core file, and checks the whole Lore after a write.
- [journal-append-forward.md](./journal-append-forward.md): a journal entry of a previous session is never changed; guards Working, with a check before a write to the journal.
- [journal-append-forward.py](./journal-append-forward.py): the check script of journal-append-forward, which refuses a write to a journal entry that exists and whose file name does not end with the id of the current session.
- [spec-before-breakdown.md](./spec-before-breakdown.md): a unit of work that has a spec has no breakdown until the spec is agreed; guards Specifying, and has only a rule.
- [stage-gate.md](./stage-gate.md): moving a unit of work from one stage to the next is the Human Lead's explicit yes; guards Planning, and has only a rule.
