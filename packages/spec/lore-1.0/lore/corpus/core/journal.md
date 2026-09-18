---
type: corpus
term: journal
points_at:
  - lore/contracts/core/journal-append-forward.md
  - lore/verbs/default/session-close.md
---

# Journal

## What it means

The journal is the record of the sessions of one desk. It has one entry per session: what the session did, what it learned, and what it hands over. Each session adds one entry when it closes and never edits an earlier one. The entry is written once, complete, and notes that a session keeps before it closes go in `workbench/scratch/`. The entry ends with a [handover](./handover.md).

The journal is how a piece of work takes more than one session. The Human Lead stops one session and starts another on the same desk, hours or days later, and does not have to explain the work again, because the next session reads the last handover.

## Where it is kept

The journal is the folder `workbench/journal/` in the [Workbench](./workbench.md). It stays on the desk that wrote it and is not shared with other desks.

## What acts on it

With the default set, the verb session-close writes the session's journal entry, and the verb session-orient reads the last handover when the next session starts. The core contract journal-append-forward has a check that refuses a write to a journal entry of a previous session. Its rule is that a correction to a past entry is recorded in the current session's entry.

## Choices recorded here

- The product document of AI-Lore 1.0 says that a session adds one entry when it closes. In its description of the process work it also says that a session journals in the Workbench while it works. The session that reviewed this entry on 2026-09-18 read the two together as one entry, written once at close, with notes kept in `workbench/scratch/` until then. The product document names working notes among the things that `scratch/` holds.
