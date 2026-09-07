---
type: verb
name: add-process
title: add-process — author an orchestration of verbs
family: blueprint
context: ./blueprint.md
track: full
floor: un-overridable
writes:
  - blueprint/processes/ (new *.process.md outside core/) + branch index
  - engine projection per the binding
contracts:
  - golden-rule
updated: 2026-07-02
---

# add-process

Author a **process** — a Human-Lead-started orchestration of verbs: a release
runbook, a grooming sweep, a close-out ritual. Part of the un-overridable floor.

## When to invoke

- A sequence of verbs recurs as one intention ("ship a version", "tidy the
  project") and deserves a name, an order, and a checklist.
- A project disagrees with an inherited process → author the same-named shadow.
- NOT for a single operation (that is a verb —
  [`add-verb`](./add-verb.verb.md)) and NOT for a rule (that is
  [`add-contract`](./add-contract.verb.md)).

## What a process is

**Every step is a verb reference — never an inline action.** This is enforced at
authoring, and it is what makes the whole sharing model work: anything a process
does is a named verb a child project can shadow, so a child that disagrees with one
step overrides *that verb* and the inherited process picks it up — **the process
itself is never copied**. A step that can't name its verb has found a gap; route it
through `add-verb` first, then reference it.

The shape, `<name>.process.md`:

- **Frontmatter** — `type: process`, `name`, `title`, `updated`, `invoker`
  (processes are Human-Lead-started), `composes` (the verb names, in order).
- **Body** — when to run it · the steps, each a verb reference with its
  parameterization and any between-steps judgement · what "done" looks like.

Processes orchestrate; verbs act. Authority runs **contract > process > verb**: a
process cannot waive a contract, and a verb's own refusals hold even when a process
invoked it. Per the golden rule, a running process still pauses at **every write**
for the step-verb's confirmation — a declared process makes the confirmations
predictable, never skippable.

Placement and resolution: exactly as verbs — outside `core/`, shadow by name,
lowest wins ([`add-verb`](./add-verb.verb.md) carries the chain's encyclopedia).
Engine wiring rides along per the binding.

## The operation

1. **Confirm the verb** (golden rule); mounted, claim covering
   `blueprint/processes/`.
2. **Settle the design**: name (collision = shadow, said aloud), the composed verbs
   — **every step resolves to a verb in the current resolved set**; gaps route to
   `add-verb` first.
3. **Author** per the shape; the verb-reference rule checked step by step.
4. **Wire**: branch index; engine projection.
5. **State the addition.**

## Refusals

- A step is an inline action → refuse until it names a verb.
- A referenced verb doesn't resolve → author it first.
- Target is `core/`, or a floor shadow → refuse.

## Related

[`update-process`](./update-process.verb.md) ·
[`retire-process`](./retire-process.verb.md) ·
[`add-verb`](./add-verb.verb.md) fills the gaps steps find ·
core processes `groom` and `close-out` are this verb's own products.
