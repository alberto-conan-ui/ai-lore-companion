---
name: ai-lore-add-parent
description: "AI-Lore verb add-parent — inherit from an upstream project"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/add-parent.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** outward · **track:** full · **invoker:** human-lead · **writes:** {"memory/workspace.yaml (parents": "list)"}; engine re-projection of the resolved artifact set · **contracts:** golden-rule

# add-parent

Declare a **parent** — an upstream AI-Lore project whose verbs, processes, and
contracts become invocable here. **Human-Lead-invoked**: inheriting authority over
what this project may do is the Human Lead's signature.

## When to invoke

- A team/org project publishes shared discipline (its `blueprint/`) that this
  project should run under.
- A reference turns out to be inherited-from in spirit —
  [`review-references`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/review-references.verb.md) proposes the promotion.
- NOT for consult-only context — that is
  [`add-reference`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/add-reference.verb.md).

## What a parent is

Parents vs references, the resolution chain, the DAG: [`outward.md`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/outward.md)
and [`blueprint.md`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/blueprint.md). What this card adds: adding a
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

[`remove-parent`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/remove-parent.verb.md) ·
[`review-references`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/review-references.verb.md) audits the list ·
[`install`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/lifecycle/install.verb.md) projects the resolved set ·
[`upgrade`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/lifecycle/upgrade.verb.md) re-validates local shadows when *core* moves — the
same conversation applies when a parent moves.


---

# Family context

# Outward — family context

The shared knowledge of the outward family. Verb cards in this folder assume it.

## Two kinds of outward link

- **References** — lazy, consult-only. `<lore>/references/<name>.md` (sibling to
  `memory/`, outward pointers, not the project's own thinking): frontmatter
  (`type: reference`, `target_path`, `purpose`, `scope`) + how/when to consult.
  Three rules: **read-only by contract** (never write through one; open the other
  project to work there); **link metadata only** (what reading it taught you goes
  in *this* project's notepad → blueprint, with the reference as source); **never
  auto-loaded** (consulted when work calls, not at session open).
- **Parents** — eager, inherited. An ordered `parents:` list in
  `memory/workspace.yaml`; a parent exposes its `blueprint/` and its artifacts
  become invocable here through the resolution chain (core < parents in declaration
  order < local, by name, lowest wins; contracts accumulate — the chain's full
  statement lives in [`blueprint.md`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/blueprint.md) and the floor).
  Parents form a DAG; a project may not be its own ancestor. Declaring or dropping
  one changes the live verb set and what binds — both verbs walk that delta with
  the Human Lead before landing.

Promotion and demotion between the two kinds is a grooming outcome
([`review-references`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/review-references.verb.md)): a reference the project keeps
imitating by hand wants to be a parent; a parent whose artifacts are never invoked
wants to be a reference.

## The publish surface

Publishing projects split the root: `payload/` (workshop, source of truth) and
`publish/` (the curated deliverable — a directory or a symlink to an external
mount). `publish/` is **derived state**, in no git repo, regenerable at any time,
and written by exactly one verb: [`publish`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/publish.verb.md). The recipe —
what crosses, what curation fires — is the project's own
`publish.process.md`; the verb is the gate.
