---
type: verb
name: complete-focus
title: complete-focus — the Human Lead's Done call
family: status-tree
context: ./status-tree.md
track: full
invoker: human-lead
writes:
  - status.stack.md (row status → done)
  - focus body (status, gate boxes, journal-trail close)
contracts:
  - golden-rule
updated: 2026-07-02
---

# complete-focus

Close a focus. **Human-Lead-only** — this is where human accountability lives at the
focus level. The session delivers, may judge the work complete, may prompt for the
call; only the Human Lead makes it.

## When to invoke

- A `build` focus: the Human Lead checks the gate and calls it.
- A `goal` focus: the session has delivered the work *and its opinionated critique*;
  the Human Lead judges by the vision.
- Overdue calls: a focus whose work shipped long ago and sits `in progress` (or was
  dishonestly parked `paused`) — the call was always the missing piece; make it.

## What the Done call is

By `focus_type`:

- **build** — walk the gate together, condition by condition, evidence in hand. The
  session presents each condition's state honestly (met / unmet / met-with-deviation,
  deviations named). The Human Lead flips the call — including consciously accepting
  deviations; accepted ones are recorded on the gate, not silently absorbed.
- **goal** — the session delivers its critique alongside the work: what the vision
  asked, where the work meets and misses it, what it would do differently. The Human
  Lead judges. The critique is mandatory — a goal closed without one is a rubber
  stamp.

The write: stack row → `done`; focus frontmatter `status: done`; remaining honest
gate boxes; a closing journal-trail line naming the call and its date. `done` focuses
stay in the stack and in place — relocation is
[`archive-focus`](./archive-focus.verb.md), which this verb offers as its last step.

Open children gate the call: stages/phases not `done` are walked — closed via their
complete verbs where true, or explicitly waived by the Human Lead on the record.

## The operation

1. **Verify the invoker** — the Human Lead is making this call; a session reaching
   this step alone stops and prompts instead.
2. **Confirm the verb** (golden rule) and ensure a mounted full track whose claim
   covers the focus.
3. **Walk children**: any open stage/phase → close truthfully or record the waiver.
4. **Run the type's ritual**: gate walk (build) or critique + judgement (goal).
5. **Write the close**: row, frontmatter, gate, journal trail, `updated:`.
6. **Offer `archive-focus`** — now or later; note the choice.

## Refusals

- The invoker is the session's own judgement, not the Human Lead → refuse; prompt.
- Gate conditions unmet and not consciously waived → the call cannot land clean;
  report which.

## Related

[`complete-stage`](./complete-stage.verb.md) / [`complete-phase`](./complete-phase.verb.md)
the session-level closes · [`archive-focus`](./archive-focus.verb.md) relocates ·
[`review-focus-tree`](./review-focus-tree.verb.md) hunts overdue calls ·
[`save-point`](../acknowledgement/save-point.verb.md) when the close is milestone-worthy.
