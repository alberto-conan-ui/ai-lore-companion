---
type: corpus
term: handover
points_at:
  - lore/verbs/default/session-close.md
  - lore/verbs/default/session-orient.md
---

# Handover

## What it means

A handover is the last part of a session's [journal](./journal.md) entry. It says three things: what was done, what is in progress, and what the next session should do.

The next session reads the last handover for its [unit of work](./unit-of-work.md) when it starts, and continues from it. When the session was pointed at no unit of work, it reads the last handover of the desk.

## Where it is kept

The handover is in the journal entry of the session, in `workbench/journal/`. When the session has an issue on the [Agents board](./agents-board.md), the handover is also written as the last comment on that issue, so that a colleague on another desk sees it. The journal itself stays on the desk that wrote it.

## What acts on it

With the default set, the verb session-close writes the handover, and the verb session-orient reads it. When the Human Lead answers the gate of a [Blocked](./blocked.md) session, the companion resumes the session or starts a new one from its handover.
