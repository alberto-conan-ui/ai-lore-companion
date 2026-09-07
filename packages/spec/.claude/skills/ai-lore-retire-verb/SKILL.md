---
name: ai-lore-retire-verb
description: "AI-Lore verb retire-verb — remove an authored verb"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/retire-verb.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** blueprint · **track:** full · **invoker:** human-lead · **writes:** blueprint/verbs/<name>.verb.md removed + index unwired; engine projection removed · **contracts:** golden-rule

# retire-verb

Remove a project-local or shadow verb from the resolved set. **Human-Lead-invoked**
— retiring capability is a project decision. Inherits
[`add-verb`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-verb.verb.md)'s encyclopedia.

## When to invoke

- The verb's kind of write no longer happens, or a shadow's disagreement with core
  dissolved (retiring a shadow **restores the inherited verb** — often the point,
  especially at upgrade time when the new core absorbed the shadow's fix).
- NOT for core artifacts (core retires only via [`upgrade`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/lifecycle/upgrade.verb.md)
  replacing it) and never for the floor.

## What retiring means

Check the dependents first: any **process step referencing the verb by name** breaks
on retirement — the resolved set must still satisfy every process, or the process is
amended first ([`update-process`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/update-process.verb.md)). Then: file removed,
index unwired, engine projection removed. History survives in git; the retirement
reason goes in the commit that lands it.

## The operation

1. **Verify the invoker**; **confirm the verb** (golden rule); mounted, claim.
2. **Dependency check** across the resolved processes; amend or refuse.
3. **Remove**: file, index line, projection.
4. **State** what the resolved set now looks like for that name (inherited verb
   restored, or nothing).

## Refusals

- Not the Human Lead → refuse. · Core / the floor → refuse. · A process still
  references it → amend the process first or refuse.

## Related

[`add-verb`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-verb.verb.md) · [`update-verb`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/update-verb.verb.md) ·
[`upgrade`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/lifecycle/upgrade.verb.md) the core-side lifecycle.


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
