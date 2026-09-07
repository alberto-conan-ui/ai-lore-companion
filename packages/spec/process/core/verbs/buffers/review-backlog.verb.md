---
type: verb
name: review-backlog
title: review-backlog — polish the work inbox
family: buffers
context: ./buffers.md
track: full
home_only: true
writes:
  - status/backlog/ (items merged, sharpened, killed; indexes rewired)
  - graduations through add-new-focus
contracts:
  - golden-rule
updated: 2026-07-02
---

# review-backlog

Curate the backlog with the Human Lead: dedupe, merge, sharpen, graduate what the
project now commits to, kill what it never will. The backlog's grooming verb —
home-only.

## When to invoke

- Periodically — before planning a release, after one ships, when the backlog's
  size exceeds anyone's memory of it.
- After [`integrate-notepad`](./integrate-notepad.verb.md) — intake feeds the
  backlog; polish follows naturally (the `groom` process chains them).
- NOT for capture (that is [`add-backlog-item`](./add-backlog-item.verb.md)) and NOT
  for working an item (graduate it first; the backlog is not a workboard).

## What the review does

Walk every item and folder, oldest first, with the tree's current state as context
(an item may have been done by other work, superseded by a focus, or split by
events). Per item, the dispositions:

- **Graduate** — the project commits now: route to
  [`add-new-focus`](../status-tree/add-new-focus.verb.md), which absorbs the item's content and
  removes it. Graduation may batch: several items become one focus's context.
- **Merge** — duplicates and near-duplicates collapse into the sharpest one;
  `[[slug]]` links repaired.
- **Sharpen** — an item gone vague gets rewritten against today's reality (what
  would a stranger need to act on this?).
- **Kill** — overtaken, obsolete, or never-really-meant: deleted with the Human
  Lead's nod. A reasoned kill is recorded in the review's close, not mourned.
- **Keep** — still right, still waiting; touch nothing.

Folder hygiene rides along: empty groups dissolve, overgrown roots get grouped,
every index stays pure wiring. The review never *creates* work items — findings
about the project itself route through their own capture verbs.

## The operation

1. **Confirm the verb** (golden rule); home-mounted.
2. **Walk the backlog** — every folder, every item, against the tree's state.
3. **Interview** item by item: evidence, reading, proposed disposition,
   Human Lead's call.
4. **Execute** — merges and sharpenings in place; graduations through
   `add-new-focus` (each under its own confirmation); kills deleted; indexes
   rewired.
5. **Close with the delta**: graduated / merged / sharpened / killed / kept.

## Refusals

- Not home / not mounted → refuse.
- Asked to bulk-kill or auto-graduate without the interview → refuse; disposition is
  per-item and the Human Lead's.

## Related

[`add-backlog-item`](./add-backlog-item.verb.md) fills ·
[`add-new-focus`](../status-tree/add-new-focus.verb.md) the graduation target ·
[`integrate-notepad`](./integrate-notepad.verb.md) the upstream inbox ·
[`review-focus-tree`](../status-tree/review-focus-tree.verb.md) may send stale drafts back here.
Composed by the `groom` process.
