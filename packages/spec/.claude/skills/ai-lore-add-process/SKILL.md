---
name: ai-lore-add-process
description: "AI-Lore verb add-process — author an orchestration of verbs"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-process.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** blueprint · **track:** full · **floor:** un-overridable · **writes:** blueprint/processes/ (new *.process.md outside core/) + branch index; engine projection per the binding · **contracts:** golden-rule

# add-process

Author a **process** — a Human-Lead-started orchestration of verbs: a release
runbook, a grooming sweep, a close-out ritual. Part of the un-overridable floor.

## When to invoke

- A sequence of verbs recurs as one intention ("ship a version", "tidy the
  project") and deserves a name, an order, and a checklist.
- A project disagrees with an inherited process → author the same-named shadow.
- NOT for a single operation (that is a verb —
  [`add-verb`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-verb.verb.md)) and NOT for a rule (that is
  [`add-contract`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-contract.verb.md)).

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
lowest wins ([`add-verb`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-verb.verb.md) carries the chain's encyclopedia).
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

[`update-process`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/update-process.verb.md) ·
[`retire-process`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/retire-process.verb.md) ·
[`add-verb`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-verb.verb.md) fills the gaps steps find ·
core processes `groom` and `close-out` are this verb's own products.


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
