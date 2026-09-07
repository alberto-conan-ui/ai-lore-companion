---
name: ai-lore-retire-contract
description: "AI-Lore verb retire-contract — release an inviolable rule"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/retire-contract.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** blueprint · **track:** full · **invoker:** human-lead · **writes:** blueprint/contracts/<name>.contract.md removed + citations unwired + hook removed · **contracts:** golden-rule

# retire-contract

Remove a project-local or shadow contract — the project consciously stops binding
itself. **Human-Lead-invoked**, and the heaviest retire: releasing a rule changes
what every future write may do. Inherits
[`add-contract`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-contract.verb.md)'s encyclopedia.

## When to invoke

- The invariant genuinely no longer applies (the platform changed, the obligation
  ended), or a shadow's conflict with an inherited contract dissolved (retiring the
  shadow restores the inherited rule).
- NOT because the rule is inconvenient this week — that conversation is a conscious
  override at [`save-point`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/save-point.verb.md), on the record, rule intact.

## What retiring means

Read the citation map first — every citing verb/process gets its `contracts:` line
unwired in the same motion; the hook, if any, removed. The retirement's *why* goes
in the landing commit and, when the rule shaped history, a line in the journal —
future sessions reading old save-points will meet the rule's ghost.

## The operation

1. **Verify the invoker**; **confirm the verb** (and read the rule back — the
   Human Lead should hear what is being released); mounted, claim.
2. **Unwire**: citations, hook, index; remove the file.
3. **State what is now permitted** that wasn't — plainly.

## Refusals

- Not the Human Lead → refuse. · Core → refuse ([`upgrade`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/lifecycle/upgrade.verb.md)
  owns core's lifecycle). · "Just skip it this once" → that is a save-point
  override, not a retirement.

## Related

[`add-contract`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-contract.verb.md) · [`update-contract`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/update-contract.verb.md)
· [`save-point`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/save-point.verb.md) for conscious one-time overrides.


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
