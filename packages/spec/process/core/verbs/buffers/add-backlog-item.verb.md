---
type: verb
name: add-backlog-item
title: add-backlog-item — capture future work, pre-focus
family: buffers
context: ./buffers.md
track: light
writes:
  - status/backlog/ (one new item file + index wiring)
contracts:
  - golden-rule
updated: 2026-07-02
---

# add-backlog-item

Capture a piece of **future work** into the backlog — a to-do the project has not
committed to. Cheap on purpose: a backlog item costs nothing until it graduates.

## When to invoke

- A defect, follow-up, or idea surfaces that deserves doing but not now.
- A finding is filed during a release or review (the classic `F<N>` items).
- From a **light track** — one of its three legal surfaces.
- NOT for knowledge (that is [`add-note`](./add-note.verb.md)) and NOT for work being
  committed to right now (that is [`add-new-focus`](../status-tree/add-new-focus.verb.md) — skip
  the buffer when commitment is already here).

## Where it lands

The backlog's shape, item schema, and the graduation/death exits:
[`buffers.md`](./buffers.md). This card's discipline: the item is self-contained
(a stranger could act on it years later), placed in a fitting group, and costs
nothing until the project commits.

## The operation

1. **Confirm the verb** (golden rule); light or full track both serve.
2. **Place it**: an existing backlog folder that fits, or the backlog root; create a
   grouping folder (with its index) only when siblings already exist to group.
3. **Write the item**: slug, frontmatter, self-contained body.
4. **Wire the index** of the folder it landed in.
5. **Return to the interrupted work.**

On a light track the write lands as drift on trunk for a home session to
acknowledge — by design.

## Refusals

- Trackless → operate as a light track.
- Commitment is actually present ("let's do this next") → skip the buffer, route to
  `add-new-focus`.
- It's knowledge, not work → `add-note`.

## Related

[`review-backlog`](./review-backlog.verb.md) polishes and graduates ·
[`add-new-focus`](../status-tree/add-new-focus.verb.md) the graduation target ·
[`add-note`](./add-note.verb.md) the knowledge sibling ·
[`integrate-notepad`](./integrate-notepad.verb.md) routes notes here when they were
work all along.
