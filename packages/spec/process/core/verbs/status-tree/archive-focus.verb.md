---
type: verb
name: archive-focus
title: archive-focus — relocate a finished focus's subtree
family: status-tree
context: ./status-tree.md
track: full
invoker: human-lead
writes:
  - status tree structure (subtree → status/archive/)
  - status.stack.md (row removed)
  - status.index.md + archive index (wiring)
contracts:
  - golden-rule
updated: 2026-07-02
---

# archive-focus

Relocate a `done` focus's whole subtree to `status/archive/`, keeping the working
tree lean while losing nothing. **Human-Lead-invoked** — archiving is a curation act.

## When to invoke

- After [`complete-focus`](./complete-focus.verb.md) — immediately (its standing
  offer) or later in a batch.
- During grooming, when [`review-focus-tree`](./review-focus-tree.verb.md) surfaces
  `done` focuses still cluttering the live tree.

## What archiving means

**Relocation, not deletion** — the subtree moves intact (folders, indexes, bodies,
its whole history) from `status/<focus>/` to `status/archive/<focus>/`. Nothing is
rewritten inside; an archived focus reads exactly as it closed. This is why the
discard guard has no business here: the diff is a move.

The registry updates to match: the focus's row **leaves `status.stack.md`** (the
stack registers the working set; the archive index is the ledger of the finished),
the root `status.index.md` drops the child entry, and `archive/archive.index.md`
gains one — link plus its one-line epitaph. Only `done` focuses archive: an unfinished
subtree in the archive is a lie; get the Done call first (or, for work being
discarded rather than finished, say so — that is a different, guard-tripping
conversation via [`update-focus`](./update-focus.verb.md)).

Archived focuses stay referenceable — links into the archive are stable and legal
(predecessor pointers on newer focuses, save-point entries, journal lines).

## The operation

1. **Verify the invoker** is the Human Lead; sessions prompt, never self-archive.
2. **Confirm the verb** (golden rule) and ensure a mounted full track whose claim
   covers `memory/status/`.
3. **Verify the focus is `done`** — otherwise route to `complete-focus` first.
4. **Move the subtree** to `status/archive/<focus>/`, contents untouched.
5. **Rewire**: stack row out, root index entry out, archive index entry in (with the
   epitaph line). Fix any inbound links the move broke — a stale link above the
   target means the write has not finished.
6. **State the move** and the tree's now-lighter working set.

## Refusals

- Focus not `done` → refuse; the Done call comes first.
- A same-named folder already in the archive → surface it; names are forever, so
  this signals an upstream naming defect to resolve with the Human Lead.

## Related

[`complete-focus`](./complete-focus.verb.md) the gate into here ·
[`review-focus-tree`](./review-focus-tree.verb.md) proposes batches ·
[`add-new-focus`](./add-new-focus.verb.md) may cite archived predecessors.
