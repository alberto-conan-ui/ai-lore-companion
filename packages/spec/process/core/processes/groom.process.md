---
type: process
name: groom
title: groom — the tidy-the-project sweep
invoker: human-lead
composes:
  - review-focus-tree
  - integrate-notepad
  - review-backlog
  - review-mirror
  - review-references
updated: 2026-07-02
---

# groom

The standing sweep against rot: every grooming verb, in the order the buffers feed
each other. Human-Lead-started; each step is an interview, each accepted outcome
executes through its own verb under its own confirmation.

## When to run

- Periodically — before a save-point, after a release, when orient's readout has
  grown rows nobody recognizes.
- Any single surface can be groomed alone by invoking its verb directly; the
  process is for the full pass.

## The steps

1. **`review-focus-tree`** — challenge what lingers in the tree: overdue Done calls,
   abandoned pauses, stale drafts, unarchived closures.
2. **`integrate-notepad`** — drain the knowledge inbox; notes route to contracts /
   mirror / tooling / backlog or die. (Runs second so freshly-routed backlog items
   are present for step 3.)
3. **`review-backlog`** — dedupe, sharpen, graduate, kill.
4. **`review-mirror`** — diff the Payload's description against its reality.
5. **`review-references`** — audit the outward links and the parents list.

## Done looks like

Every buffer drained or consciously smaller; every finding disposed on the record;
the close states the full delta. If the sweep produced substantial writes, an
[`ack`](../verbs/acknowledgement/ack.verb.md) is the natural coda — and if the journal's live window
has grown stale, offer [`archive-journal`](../verbs/lifecycle/archive-journal.verb.md) as an
encore.
