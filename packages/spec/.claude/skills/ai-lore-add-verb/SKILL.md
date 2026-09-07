---
name: ai-lore-add-verb
description: "AI-Lore verb add-verb — author a verb (the authoring floor)"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-verb.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** blueprint · **track:** full · **floor:** un-overridable · **writes:** blueprint/verbs/ (new *.verb.md outside core/) + branch index; engine projection (verb → skill) · **contracts:** golden-rule

# add-verb

Author a **verb** — a new unit of *what to do*, or a **shadow** that overrides an
inherited one by name. Part of the un-overridable floor: this is the verb that keeps
the golden rule total (a write with no verb routes here, and the gap closes), so it
can never itself be shadowed away.

## When to invoke

- A kind of write recurs with no fitting verb — the tell:
  [`update-payload`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/payload/update-payload.verb.md) keeps being reached for the same kind
  of edit. Define the specific verb; resolution will prefer it.
- A project disagrees with a core or parent verb → author the same-named shadow.
- NOT for orchestrations of existing verbs (that is
  [`add-process`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-process.verb.md)) and NOT for rules (that is
  [`add-contract`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-contract.verb.md)).

## What a verb is, and where it lives

The artifact shape, placement, the resolution chain, shadowing, and engine wiring:
[`blueprint.md`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/blueprint.md). What this card adds: **the floor exception** —
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

[`update-verb`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/update-verb.verb.md) amends what this authored ·
[`retire-verb`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/retire-verb.verb.md) removes it ·
[`add-process`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-process.verb.md) / [`add-contract`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-contract.verb.md)
the floor siblings · [`install`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/lifecycle/install.verb.md) re-projects everything ·
[`upgrade`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/lifecycle/upgrade.verb.md) re-validates shadows.


---

# Family context

# The blueprint — family context

The shared knowledge of the blueprint (authoring) family. Verb cards in this folder
assume it.

## Three artifact layers

`blueprint/` holds the project's authored, shareable artifacts in three branches —
**verbs** (units of what to do), **processes** (Human-Lead-started orchestrations of
verbs), **contracts** (inviolable, always-on rules) — plus **tooling** (registry of
owned executables; its `core/` ships `ai-lore.py`, the mechanical half of the
lifecycle verbs) and **mirror** (committed description of the Payload's shape).
Authority runs **contract > process > verb**: a process cannot waive a contract; a
verb's refusals hold even when a process invoked it.

## Placement and resolution

Each artifact branch carries a **`core/`** subfolder: the out-of-the-box set, placed
by `init`, replaced **wholesale** by `upgrade` — **never edited in place.** All
customization is **shadow-by-name**: author a same-named artifact in the branch
outside `core/`, and resolution picks it. The chain: **core < parents (declaration
order in `workspace.yaml` breaks same-level ties) < project-local — by name, lowest
level wins.** Contracts **accumulate** across the chain rather than replace,
resolving lowest-wins only on direct name conflict.

**The un-overridable floor**: the bootstrap (`ai_readme.md`) plus
[`add-verb`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-verb.verb.md) / [`add-process`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-process.verb.md) /
[`add-contract`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-contract.verb.md) / [`run-process`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/run-process.verb.md).
Everything else, core included, is shadowable. A shadow carries a one-line *what it changes and why* — that line is
what makes `upgrade`'s shadow re-validation minutes instead of archaeology.

Artifact **names never change** (a rename is retire + add) — names are how
resolution, process steps, and history refer to things.

## The shape of a verb

A verb file is `<name>.verb.md`: typed frontmatter (`type: verb`, `name`, `title`,
`family`, `context` — the family doc, `track` — required track type, `invoker`
where Human-Lead-only, `writes` — exact surfaces, `contracts` — cited by name) and
four sections: *When to invoke* (with NOT-routing to neighbors) · *The operation*
(step 1 always the golden-rule confirmation) · *Refusals* · *Related*. Family-shared
knowledge lives in the family's context doc, loaded with the card — never restated
per card. Engine projection bundles card + context doc into one self-contained
skill, so dedup in source coexists with inline delivery.

## Engine wiring rides along

Authoring an artifact projects it to the engine's native form in the same motion —
verb → skill, contract → hook where checkable, process → the engine's composition
form — per the project's binding. A full re-projection of the resolved set is
[`install`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/lifecycle/install.verb.md)'s job; the authoring verbs keep the
projection incrementally true.
