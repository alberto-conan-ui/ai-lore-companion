---
name: ai-lore-add-tooling
description: "AI-Lore verb add-tooling — register an owned executable"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-tooling.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** blueprint · **track:** full · **writes:** blueprint/tooling/ (new *.tooling.md) + branch index · **contracts:** golden-rule

# add-tooling

Register a **tooling entry** — the catalog card for an executable resource the
project owns: a build script, a generator, an auxiliary app.

## When to invoke

- The project gains (or already quietly has) a script/tool sessions should reach for
  instead of re-deriving its work by hand.
- NOT for the executable itself — **the tool lives in the Payload** (written via
  [`update-payload`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/payload/update-payload.verb.md) or a project verb); the registry is
  the pointer. And NOT for a checklist the session executes by hand — that is a
  process.

## What a tooling entry is

The distinction that keeps the branch honest: a **process** is a checklist the AI
executes; a **tooling entry** points at something that *executes for it*. One file
per tool, `<name>.tooling.md`: frontmatter (`type: tooling`, `name`, `title`,
`updated`, `path` — where in the Payload it lives); body — its purpose, how to
invoke it (the actual command), when to reach for it, what it must not be used for.
Enough that a session that has never seen it runs it right the first time.

Tooling entries are plain registry cards — no core/shadow subtlety in practice
(core ships none; they are inherently project-specific), though the resolution
chain applies formally like everywhere in `blueprint/`.

## The operation

1. **Confirm the verb** (golden rule); mounted, claim covering
   `blueprint/tooling/`.
2. **Verify the tool exists** at the stated path and the invocation line actually
   runs (a registry card for a broken tool is worse than none).
3. **Author the card**; wire the branch index.
4. **State the addition.**

## Refusals

- The tool doesn't exist yet → build it first (Payload work), then register.
- It's a hand-checklist → [`add-process`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-process.verb.md).

## Related

[`update-tooling`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/update-tooling.verb.md) ·
[`retire-tooling`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/retire-tooling.verb.md) ·
[`update-payload`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/payload/update-payload.verb.md) builds the tools this registers ·
[`integrate-notepad`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/integrate-notepad.verb.md) routes tool-discoveries here.


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
