---
type: verb
name: add-parent
title: add-parent — inherit from an upstream project
family: outward
context: ./outward.md
track: full
invoker: human-lead
writes:
  - memory/workspace.yaml (parents: list)
  - engine re-projection of the resolved artifact set
contracts:
  - golden-rule
updated: 2026-07-02
---

# add-parent

Declare a **parent** — an upstream AI-Lore project whose verbs, processes, and
contracts become invocable here. **Human-Lead-invoked**: inheriting authority over
what this project may do is the Human Lead's signature.

## When to invoke

- A team/org project publishes shared discipline (its `blueprint/`) that this
  project should run under.
- A reference turns out to be inherited-from in spirit —
  [`review-references`](./review-references.verb.md) proposes the promotion.
- NOT for consult-only context — that is
  [`add-reference`](./add-reference.verb.md).

## What a parent is

Parents vs references, the resolution chain, the DAG: [`outward.md`](./outward.md)
and [`blueprint.md`](../blueprint/blueprint.md). What this card adds: adding a
parent changes the live verb set — new names appear, same-named locals start
shadowing *something*, the parent's contracts start binding. The verb walks that
delta with the Human Lead **before** landing: what you are about to be able to do,
what will now bind you. Position in the `parents:` list is precedence — chosen
deliberately, not appended by default.

## The operation

1. **Verify the invoker**; **confirm the verb** (golden rule); mounted.
2. **Resolve the target**: an AI-Lore project whose `blueprint/` exposes artifacts;
   cycle-check the DAG (a project may not be its own ancestor).
3. **Compute and present the delta**: inherited artifacts, shadow relationships
   triggered, contracts that will accumulate. The Human Lead approves seeing it.
4. **Write the manifest line** (position = precedence, chosen deliberately).
5. **Re-project** the resolved set to the engine (new skills, new hooks).
6. **State the new resolution order.**

## Refusals

- Not the Human Lead → refuse.
- Target exposes no blueprint / is not an AI-Lore project → refuse.
- A cycle → refuse.
- The intent is consult-only → `add-reference`.

## Related

[`remove-parent`](./remove-parent.verb.md) ·
[`review-references`](./review-references.verb.md) audits the list ·
[`install`](../lifecycle/install.verb.md) projects the resolved set ·
[`upgrade`](../lifecycle/upgrade.verb.md) re-validates local shadows when *core* moves — the
same conversation applies when a parent moves.
