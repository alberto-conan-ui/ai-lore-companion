---
type: corpus
term: Writing
points_at:
  - lore/contracts/core/write-guard.md
---

# Writing

## What it means

Writing is the [mode](./mode.md) in which a session writes to a payload or to the Lore. It begins when the AI Agent is about to write. Before it writes, the session names its [write targets](./write-target.md), one or several, and claims them.

Entering Writing is always confirmed by the Human Lead, in one dialog in which the targets are named. Inside Writing, the [gates](./gate.md) that the process declares are the only other confirmations. Everything else is written without asking, within the claimed targets. Work that runs no process has no confirmation after the dialog.

A session can change its write targets while it is in Writing, as long as no other session holds the target that it adds.

Writing is also the name of a column of the [Agents board](./agents-board.md). The issue of a session in Writing is in that column and names the session's write targets.

## Where it is kept

A session's mode and its claims are in the desk's records, which the companion keeps. The claim is copied to the Agents board, where other desks see it.

## What acts on it

A session asks the companion for the dialog, and the companion records the claim when the Human Lead confirms. The session's issue is created when the session first enters Writing, in the same step as its claim. The contract write-guard refuses any write outside the claimed targets, and for a repository it refuses a write on any branch other than the claimed one. The contract lore-integrity requires that a failure of its check is fixed before the session leaves Writing. When a session leaves Writing it returns to [Read only](./read-only.md).
