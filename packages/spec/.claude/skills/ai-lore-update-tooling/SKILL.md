---
name: ai-lore-update-tooling
description: "AI-Lore verb update-tooling — keep a registry card true"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/update-tooling.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** blueprint · **track:** full · **writes:** blueprint/tooling/<name>.tooling.md · **contracts:** golden-rule

# update-tooling

Amend a tooling entry so the card matches the tool. Inherits
[`add-tooling`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-tooling.verb.md)'s encyclopedia.

## When to invoke

- The tool moved, its invocation changed, its scope grew or narrowed.
- A session followed the card and hit a mismatch — fix the card in the same breath
  as the discovery (or [`add-note`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/add-note.verb.md) it when mid-flight).

## The operation

1. **Confirm the verb** (golden rule); mounted, claim.
2. **Verify against the tool** — the amended invocation runs; the path resolves.
3. **Amend the card**; `updated:`. **State the change.**

## Refusals

- The change is to the tool itself → Payload work first, card second.

## Related

[`add-tooling`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-tooling.verb.md) · [`retire-tooling`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/retire-tooling.verb.md).


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
