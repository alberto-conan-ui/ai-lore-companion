---
name: ai-lore-update-verb
description: "AI-Lore verb update-verb — amend an authored verb"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/update-verb.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** blueprint · **track:** full · **writes:** blueprint/verbs/<name>.verb.md (outside core/); engine re-projection of the changed artifact · **contracts:** golden-rule

# update-verb

Amend a project-local or shadow verb. Inherits its encyclopedia from
[`add-verb`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-verb.verb.md) — the shape, the resolution chain, the engine
wiring; read it once, this verb applies it to an existing artifact.

## When to invoke

- An authored verb's discipline sharpened with use — refusals learned, scope
  clarified, a step that proved wrong.
- NOT for core artifacts — core is never edited in place. "Update a core verb"
  means: author the shadow (`add-verb`), which then takes the name.

## What holds

The verb's **name never changes** (a rename is retire + add — names are how
resolution, processes, and history refer to it). The discard guard applies: an
amendment that removes discipline (a refusal deleted, a confirmation dropped) is
shown to the Human Lead as what it is before it lands. Re-project to the engine in
the same motion, so the live skill matches the file.

## The operation

1. **Confirm the verb** (golden rule); mounted, claim covering `blueprint/verbs/`.
2. **Amend** per the add-verb shape; discard guard on removals.
3. **Re-project**; update the shadow's what/why line if scope shifted.
4. **State the change.**

## Refusals

- Target in `core/` → shadow instead. · Rename → retire + add. · Floor verbs → fixed.

## Related

[`add-verb`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-verb.verb.md) the encyclopedia ·
[`retire-verb`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/retire-verb.verb.md) the exit.


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
