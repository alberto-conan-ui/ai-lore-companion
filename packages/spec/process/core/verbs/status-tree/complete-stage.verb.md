---
type: verb
name: complete-stage
title: complete-stage — close a batch of work
family: status-tree
context: ./status-tree.md
track: full
writes:
  - stage body (status, gate checkboxes, journal trail)
  - parent focus body (Stack / Active child pointer)
contracts:
  - golden-rule
updated: 2026-07-02
---

# complete-stage

Mark a stage's gate met and move the build forward: the stage goes `done`, the parent
focus's active child pointer advances to the next batch.

## When to invoke

- Every condition on the stage's gate is verifiably met.
- NOT for the focus itself — a focus's Done call is the Human-Lead-only
  [`complete-focus`](./complete-focus.verb.md). A session **may** complete stages and
  phases: they are build checkpoints, not the accountability boundary.

## What completing a stage means

The gate is the test. Walk it condition by condition — each checkbox flips only on
evidence (a file that exists, a check that ran, an approval that was given), never on
optimism. A condition that cannot be verified yet keeps the stage open; a condition
that turned out wrong is amended first via [`update-focus`](./update-focus.verb.md)
(with the discard guard and the Human Lead's eyes), then judged.

Completion rolls **up**, never sideways: the stage body's `status:` → `done`, its
gate boxes checked, a journal-trail line recording the close; then the parent focus
body's Stack/Active child pointer advance to the next stage (or note the focus is
gate-ready if this was the last). Open phases under the stage block completion —
close or recut them first.

## The operation

1. **Confirm the verb** (golden rule): name `complete-stage` and the stage; the Human
   Lead confirms. Ensure a mounted full track whose claim covers the focus.
2. **Check children**: every phase under the stage is `done` — or recut with the
   Human Lead.
3. **Walk the gate** condition by condition, evidence in hand. Any condition unmet →
   stop and say exactly which and why.
4. **Write the close**: gate boxes, `status: done`, `updated:`, journal-trail line.
5. **Advance the parent**: focus body's Active child pointer to the next stage in the
   Stack; journal-trail line on the focus where the milestone warrants it.
6. **State the close and what is now active.**

## Refusals

- Unmet or unverifiable gate conditions → refuse; report which.
- Open phases below → refuse; close or recut first.
- Asked to complete a focus → route to `complete-focus` (Human-Lead-only).

## Related

[`complete-phase`](./complete-phase.verb.md) the level below ·
[`add-stage`](./add-stage.verb.md) creates ·
[`complete-focus`](./complete-focus.verb.md) the focus-level Done call ·
[`review-focus-tree`](./review-focus-tree.verb.md) catches stages that sit half-done.
