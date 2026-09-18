---
type: corpus
term: Workbench
points_at:
  - ai_readme.md
---

# Workbench

## What it means

The Workbench is the place on a desk for work that is not finished. It holds the [drafts](./draft.md) of documents that are not yet agreed, the [journal](./journal.md) of the desk's sessions, and anything else a piece of work needs while it is unfinished.

The Workbench is private to the desk. Nothing that another desk needs may be kept only in the Workbench: what is shared goes to the Lore, to a payload or to the Space's GitHub Project.

## Where it is kept

The Workbench is the folder `workbench/` in the Space's folder. The Space repository git-ignores it, and the companion creates it on each desk. It has three folders:

- `drafts/` holds documents that are being written, before they are agreed and published.
- `journal/` holds one entry per session.
- `scratch/` holds anything else that is in progress and not yet part of a payload, markdown or not: renders, exports, data files, working notes.

## What acts on it

A session can always write to the Workbench, in Read only and in Writing. The Workbench is never a [write target](./write-target.md) and is never claimed. With the default set, the verb spec-draft writes a draft, the verb spec-agree removes the draft when the spec is published, and the verb session-close writes the journal entry. The contract journal-append-forward refuses a write to a journal entry of a previous session.
