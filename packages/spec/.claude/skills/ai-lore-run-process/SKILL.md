---
name: ai-lore-run-process
description: "AI-Lore verb run-process — drive an orchestration"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/run-process.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** blueprint · **track:** per the process (most need full; grooming needs home) · **invoker:** human-lead · **floor:** un-overridable · **writes:** none of its own — every write belongs to the step-verbs it drives · **contracts:** golden-rule

# run-process

Drive a **process**: resolve it by name, load it, walk its steps — each step a verb,
each write confirmed. The uniform way any journey starts, and part of the
un-overridable floor: if the process-runner could be shadowed away, every inherited
journey could be silently broken.

## When to invoke

- The Human Lead names a process ("run groom", "start-work on X") — directly, or by
  picking it from the session's suggestion when their intent matches a journey
  better than a single verb.
- NOT for improvising a sequence that has no process — that is just invoking verbs
  in turn; and if the sequence recurs, [`add-process`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-process.verb.md) it.

## What driving means

Resolve the name through the chain (core < parents < local — a local shadow of an
inherited process wins). Load it; verify every step still resolves to a verb in the
current set (a broken reference stops the run before it starts, not at step 4).
Then walk:

- **Each step invokes its verb properly** — the step-verb's own confirmation,
  claim checks, and refusals all apply in full. A process never grants exemptions;
  authority runs contract > process > verb, and per the golden rule the run pauses
  at **every write** — a declared process makes confirmations predictable, never
  skippable.
- **Between-step judgement points** are put to the Human Lead as the process
  states them.
- **A refusing step halts the run** — the session reports which step, why, and
  what would unblock; the Human Lead decides (fix and resume, skip on the record,
  or abort). Steps already completed stand — verbs are real operations, not a
  transaction to roll back.

## The operation

1. **Verify the invoker** is the Human Lead (processes are HL-started, always).
2. **Resolve and load** the process; pre-check every step reference.
3. **Check the process's own preconditions** (home-only, track type, children
   closed — whatever its doc states).
4. **Walk the steps**, confirming per write, surfacing judgement points, halting
   honestly on refusals.
5. **Close with the process's "done looks like"** — met, or where the run stopped.

## Refusals

- Not the Human Lead → refuse.
- Unknown process name → say what the resolved catalog offers; `add-process` fills
  real gaps.
- A step no longer resolves → refuse the run; `update-process` first.

## Related

[`add-process`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-process.verb.md) authors what this drives ·
core journeys: [`groom`](../../../.ai-lore-ai-sdlc/memory/blueprint/processes/core/groom.process.md) ·
[`close-out`](../../../.ai-lore-ai-sdlc/memory/blueprint/processes/core/close-out.process.md) ·
[`start-work`](../../../.ai-lore-ai-sdlc/memory/blueprint/processes/core/start-work.process.md) ·
[`parallel-work`](../../../.ai-lore-ai-sdlc/memory/blueprint/processes/core/parallel-work.process.md) ·
[`recover-session`](../../../.ai-lore-ai-sdlc/memory/blueprint/processes/core/recover-session.process.md).


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
