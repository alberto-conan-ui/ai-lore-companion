---
type: corpus
term: write target
points_at:
  - lore/contracts/core/write-guard.md
  - lore/space.md
---

# Write target

## What it means

A write target is what a session names and claims before it writes. There are two kinds of write target: the Lore, or a [payload](./payload.md). A session can have one target or several.

- The Lore is one target, and one session holds it at a time.
- A [repository](./repository.md) is one target whatever the branch. The target names the branch that the session will write on, and the claim covers the whole repository, so one session writes to a repository at a time.
- A [publish area](./publish-area.md) is one target.

The Workbench is never a write target. A session can always write to it.

A claim is the record that a session has named a write target and that the Human Lead has confirmed it. The session is then said to hold the target. A session never writes a target that it has not claimed.

## Where it is kept

The claim is recorded on the desk, in the desk's records that the companion keeps. On one desk that record decides, so two sessions on the same desk cannot both hold the same target. The claim is also copied to the session's issue on the [Agents board](./agents-board.md), where other desks see it.

Across desks there is no such guarantee. GitHub has no atomic claim, so two sessions on two desks that read the board at the same moment can both see a target as free. After it claims, a session reads the Writing column again, and if an earlier issue already claims the same target it returns to Read only and says so. This catches most such cases and not all. When one is missed, each desk writes on its own checkout, and the conflict appears when the branches are merged, or for the Lore when the second desk pushes. The Human Lead resolves it there.

When GitHub cannot be reached, the session says so and proceeds on the claim recorded on the desk. Other desks cannot be checked in that case.

## What acts on it

The Human Lead confirms the targets in the dialog in which the session enters [Writing](./writing.md). The contract write-guard reads the session's write targets before each write and refuses a write outside them. A session releases its targets by asking the companion to leave Writing, and with the default set the verb session-close does that when the session closes. The targets of a session that has gone stale are never released automatically: taking them over is the Human Lead's decision, recorded on the session's issue.
