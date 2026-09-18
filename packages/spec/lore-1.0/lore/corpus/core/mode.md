---
type: corpus
term: mode
points_at:
  - lore/contracts/core/write-guard.md
---

# Mode

## What it means

A session is in one of two modes and can move between them.

- [Read only](./read-only.md) is the mode a session starts in. The session reads everything and changes no payload and nothing in the Lore.
- [Writing](./writing.md) is the mode in which a session writes to the [write targets](./write-target.md) that it has claimed.

[Blocked](./blocked.md) is not a third mode. It is the state of an unattended session in Writing that is waiting at a gate.

The same session can go from Read only to Writing and back more than once.

## Where it is kept

A session's mode is in the desk's records, which the companion keeps. For a session that has an issue, the column of that issue on the [Agents board](./agents-board.md) shows the mode to every desk. The card of a verb names the mode that the verb needs, in the key `mode` of its frontmatter.

## What acts on it

A session enters Writing through one dialog in the companion, in which the write targets are named and the Human Lead confirms. The contract write-guard reads the session's mode from the desk's records before each write.
