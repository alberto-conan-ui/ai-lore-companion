---
type: verb
name: complete-phase
title: complete-phase — close a buildable step
family: status-tree
context: ./status-tree.md
track: full
writes:
  - phase body (status, gate checkboxes, journal trail)
  - parent stage body (Stack / Active child pointer)
contracts:
  - golden-rule
updated: 2026-07-02
---

# complete-phase

Mark a phase's gate met. The smallest close in the tree — the day-to-day "this step
is done, next" of a working build.

## When to invoke

- The phase's gate conditions are verifiably met **and the work is in a runnable
  state** — a phase's defining promise.
- NOT for stages or focuses — those are
  [`complete-stage`](./complete-stage.verb.md) and the Human-Lead-only
  [`complete-focus`](./complete-focus.verb.md).

## What completing a phase means

Same discipline as every close, at the finest grain: gate conditions flip on
evidence; the runnable-state promise is itself a condition (a phase that closes with
the Payload broken was cut or closed wrong). The phase body takes `status: done`,
checked boxes, `updated:`, and a one-line journal-trail entry; the parent stage's
Stack/Active child pointer advance to the next phase, or the stage is flagged
gate-ready when this was the last.

A session may complete phases freely — they are its working checkpoints. Frequent
small closes beat one heroic one; pair with
[`ack-and-continue`](../acknowledgement/ack-and-continue.verb.md) when a closed phase is a clean
commit chunk.

## The operation

1. **Confirm the verb** (golden rule): name `complete-phase` and the phase; the Human
   Lead confirms. Ensure a mounted full track whose claim covers the focus.
2. **Walk the gate** on evidence; verify the work runs / reads / holds together.
3. **Write the close**: boxes, `status: done`, `updated:`, journal-trail line.
4. **Advance the parent stage's** Active child pointer / flag gate-ready.
5. **State the close and what is next.**

## Refusals

- Unmet gate or non-runnable state → refuse; report which condition.
- Asked to complete a stage or focus → route up.

## Related

[`add-phase`](./add-phase.verb.md) creates ·
[`complete-stage`](./complete-stage.verb.md) the level above ·
[`ack-and-continue`](../acknowledgement/ack-and-continue.verb.md) commits the chunk.
