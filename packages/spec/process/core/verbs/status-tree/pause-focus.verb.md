---
type: verb
name: pause-focus
title: pause-focus — set a focus aside, resumable
family: status-tree
context: ./status-tree.md
track: full
writes:
  - status.stack.md (row status → paused)
  - focus body (journal-trail pause note)
contracts:
  - golden-rule
updated: 2026-07-02
---

# pause-focus

Set an in-progress focus aside deliberately: row → `paused`, with a pause note that
makes resumption cheap.

## When to invoke

- Priorities shift and another focus takes the track.
- The focus blocks on something external with no near-term unblock.
- NOT as a parking lot for finished-but-uncalled work — a focus whose work shipped
  and only awaits the Done call stays `in progress` (review lives inside
  `in progress`); prompt the Human Lead for
  [`complete-focus`](./complete-focus.verb.md) instead. Parking shipped work in
  `paused` is the dishonesty that rots registries.

## What pausing means

`paused` is the side-state of the lifecycle (`draft` / `paused` / `in progress` /
`done`) — started, then set aside, resumable. The stack row is the single stored
status; the focus body's frontmatter mirrors it. The **pause note** is the real
work: one journal-trail line stating where the work stands, why it pauses, and the
first step on resume. A pause without a note is a future session's archaeology.

Pausing does not unmount, uncommit, or archive anything — the subtree stays in
place; drift on the track is still the ack family's business.

## The operation

1. **Confirm the verb** (golden rule): name `pause-focus` and the reason; the Human
   Lead confirms. Ensure a mounted full track whose claim covers the focus.
2. **Write the pause note** — standing state, reason, first-step-on-resume — as a
   journal-trail line on the focus body.
3. **Move the status**: stack row and focus frontmatter → `paused`; `updated:`.
4. **State the pause** and what the track does next.

## Refusals

- Focus is `draft` or `done` → nothing to pause.
- The real situation is "shipped, awaiting Done call" → refuse the park; prompt
  `complete-focus`.

## Related

[`resume-focus`](./resume-focus.verb.md) the way back ·
[`complete-focus`](./complete-focus.verb.md) the honest close for shipped work ·
[`review-focus-tree`](./review-focus-tree.verb.md) challenges pauses that quietly
became abandonment.
