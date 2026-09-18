---
type: corpus
term: Read only
points_at:
  - lore/contracts/core/write-guard.md
---

# Read only

## What it means

Read only is the [mode](./mode.md) that a session starts in. In Read only the session reads everything and changes no payload and nothing in the Lore.

The name covers those two only. A session in Read only writes to the Workbench, and it may update the Space's GitHub Project: comment on an issue, move a status, add a dependency. It says that it is making such an edit and makes it, unless a process of the Space says otherwise.

A session stays in Read only until it names what it will write and claims it, and the Human Lead confirms the claim. A verb that writes only to the Workbench or to the GitHub Project needs Read only and not Writing.

Read only is also the name of a column of the [Agents board](./agents-board.md). The issue of a session that has written and gone back to reading is in that column.

## Where it is kept

A session's mode is in the desk's records, which the companion keeps.

## What acts on it

The contract write-guard refuses any write to a payload or to the Lore while the session is in Read only. A session leaves Read only by entering [Writing](./writing.md), and it returns to Read only when it leaves Writing.
