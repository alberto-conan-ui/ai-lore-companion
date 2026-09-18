---
type: corpus
term: draft
points_at:
  - lore/verbs/default/spec-draft.md
---

# Draft

## What it means

A draft is a document that is being written and is not yet agreed. A [spec](./spec.md) that is not yet agreed is a draft. A draft belongs to a [unit of work](./unit-of-work.md). Writing it may take one session or several, and the draft stays in the Workbench between them.

Agreeing a draft publishes it to a payload and removes it from the Workbench. An agreed document is never kept only in a Workbench.

## Where it is kept

Drafts are kept in `workbench/drafts/`, in the [Workbench](./workbench.md) of the desk where they are written. The Workbench is private to the desk, so another desk does not have the draft.

## What acts on it

With the default set, the verb spec-draft starts or continues a draft. It writes only the draft, so it runs in Read only. The verb spec-agree publishes the agreed document to a publish area and removes the draft from the Workbench. With the default set, the verb session-orient reads the drafts in the Workbench when a session starts.
