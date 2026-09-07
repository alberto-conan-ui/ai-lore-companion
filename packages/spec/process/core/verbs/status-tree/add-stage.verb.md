---
type: verb
name: add-stage
title: add-stage — decompose a focus into a batch of work
family: status-tree
context: ./status-tree.md
track: full
writes:
  - status tree structure (new stage folder + index under a focus)
  - stage body scaffold
  - parent focus index + body (Stack / Active child pointer)
contracts:
  - golden-rule
updated: 2026-07-02
---

# add-stage

Attach a **stage** — a coherent batch of work toward a focus — under an existing
focus. The build inner loop's structural add: when a focus's work reveals its
batches, each batch becomes a stage.

## When to invoke

- The build starts and the focus's gate splits into ordered chunks.
- Mid-build, the work reveals a batch the original cut missed.
- NOT for a new unit of intent (that is [`add-new-focus`](./add-new-focus.verb.md))
  and NOT for a buildable step under a stage (that is
  [`add-phase`](./add-phase.verb.md)).

## What a stage is

Shape rules, file shapes, naming: [`status-tree.md`](./status-tree.md). What this
card adds: a good stage is a **batch with a boundary** — an intent one sentence can
carry, a gate the Human Lead can check, and an end. Order stages by build sequence,
not importance.

## The operation

1. **Confirm the verb** (golden rule): name `add-stage`, the parent focus, and the
   stage's intent; the Human Lead confirms. Ensure a mounted full track whose claim
   covers the focus.
2. **Verify the attach point** is a focus (L1). Under a stage → route to `add-phase`;
   under a phase → refuse, the tree ends at three.
3. **Create the structure**: stage folder + spec index + body scaffold (intent and
   gate drafted with the Human Lead; the rest minimal).
4. **Wire the parent**: the focus index's Children, and the focus body's Stack (in
   build order) and Active child pointer if this stage is now the active one.
5. **State what was created** and where it sits in the build order.

## Refusals

- Attach point is not a focus → route to the right level's verb.
- No mounted full track / outside claim → refuse.
- The "stage" is really a whole new intent → route to `add-new-focus`.

## Related

[`add-phase`](./add-phase.verb.md) the level below ·
[`complete-stage`](./complete-stage.verb.md) closes it ·
[`update-focus`](./update-focus.verb.md) amends its body later ·
[`review-focus-tree`](./review-focus-tree.verb.md) challenges stages that linger.
