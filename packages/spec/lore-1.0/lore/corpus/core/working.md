---
type: corpus
term: Working
points_at:
  - lore/processes/default/work.md
  - lore/contracts/core/write-guard.md
  - lore/contracts/core/journal-append-forward.md
---

# Working

## What it means

Working is the [pillar](./pillar.md) of a session doing the work. A session works by reading the Lore and writing the payloads. It reads indexes first and opens a file only when it needs the content.

Three things about Working are fixed:

1. A session is in [Read only](./read-only.md) until it names what it will write and claims it, on the desk and on the Agents board.
2. Once the session is in [Writing](./writing.md), the AI engine checks the contracts before each write, where the engine can run checks.
3. When the session closes, it writes a [journal](./journal.md) entry in the Workbench, and the entry ends with a [handover](./handover.md), which the next session reads when it starts.

Everything else about Working is a process that the Human Lead can change: which steps a session takes, in what order, where it stops to ask, and whether it may run unattended.

## Where it is kept

Work that one session leaves unfinished is recorded in the [Workbench](./workbench.md), where the next session on the same desk reads it. What is shared goes to the Lore, to a payload or to the Space's GitHub Project.

## What acts on it

With the default set, the process work takes one piece of work from its criteria to a pull request. The verbs session-orient and session-close open and close a session, and the verb work-report reports a piece of work against its criteria. The core contracts write-guard and journal-append-forward guard this pillar.
