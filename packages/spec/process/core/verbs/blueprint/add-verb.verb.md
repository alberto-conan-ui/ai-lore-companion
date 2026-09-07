---
type: verb
name: add-verb
title: add-verb — author a verb (the authoring floor)
family: blueprint
context: ./blueprint.md
track: full
floor: un-overridable
writes:
  - blueprint/verbs/ (new *.verb.md outside core/) + branch index
  - engine projection (verb → skill)
contracts:
  - golden-rule
updated: 2026-07-02
---

# add-verb

Author a **verb** — a new unit of *what to do*, or a **shadow** that overrides an
inherited one by name. Part of the un-overridable floor: this is the verb that keeps
the golden rule total (a write with no verb routes here, and the gap closes), so it
can never itself be shadowed away.

## When to invoke

- A kind of write recurs with no fitting verb — the tell:
  [`update-payload`](../payload/update-payload.verb.md) keeps being reached for the same kind
  of edit. Define the specific verb; resolution will prefer it.
- A project disagrees with a core or parent verb → author the same-named shadow.
- NOT for orchestrations of existing verbs (that is
  [`add-process`](./add-process.verb.md)) and NOT for rules (that is
  [`add-contract`](./add-contract.verb.md)).

## What a verb is, and where it lives

The artifact shape, placement, the resolution chain, shadowing, and engine wiring:
[`blueprint.md`](./blueprint.md). What this card adds: **the floor exception** —
`add-verb`, `add-process`, `add-contract`, `run-process`, and the bootstrap cannot be shadowed;
authoring the authoring verb with itself is the one circle the system refuses.
A shadow states in one line what it changes and why (upgrade's re-validation reads
that line). A name collision with an inherited verb *is* the shadow mechanism —
say it out loud when it happens.

## The operation

1. **Confirm the verb** (golden rule): name `add-verb` and the verb-to-be; the Human
   Lead confirms. Mounted full track; claim covering `blueprint/verbs/`.
2. **Settle the design**: name (collision-checked against the resolved set — a
   collision with an inherited name means *shadow*, said out loud), family, track
   type, writes, contracts cited, encyclopedia scope.
3. **Author** per the shape above — self-contained, NOT-routed, refusals honest.
4. **Wire**: branch index entry; engine projection per the binding.
5. **State the addition** and where it now sits in the resolved set.

## Refusals

- Target is `core/` → never edited in place; author the shadow outside it.
- Target is the floor (`add-verb`/`add-process`/`add-contract` as shadows) → refuse;
  the floor is fixed.
- It's an orchestration or a rule → route to `add-process` / `add-contract`.

## Related

[`update-verb`](./update-verb.verb.md) amends what this authored ·
[`retire-verb`](./retire-verb.verb.md) removes it ·
[`add-process`](./add-process.verb.md) / [`add-contract`](./add-contract.verb.md)
the floor siblings · [`install`](../lifecycle/install.verb.md) re-projects everything ·
[`upgrade`](../lifecycle/upgrade.verb.md) re-validates shadows.
