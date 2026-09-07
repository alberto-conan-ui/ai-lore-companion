---
name: ai-lore-add-contract
description: "AI-Lore verb add-contract — author an inviolable rule"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-contract.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** blueprint · **track:** full · **floor:** un-overridable · **writes:** blueprint/contracts/ (new *.contract.md outside core/) + branch index; engine reinforcement (contract → hook, where checkable) · **contracts:** golden-rule

# add-contract

Author a **contract** — an inviolable, always-on rule. Part of the un-overridable
floor.

## When to invoke

- A rule emerges that must *never* be skipped: a quality bar, an integration
  obligation, an invariant across releases.
- A note routed by [`integrate-notepad`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/integrate-notepad.verb.md) turns out to
  be a rule.
- NOT for operations (verbs) or sequences (processes) — a contract states what must
  hold, never how to act.

## What a contract is

Defined by **inviolability, not hook-ability.** Enforcement is layered, weakest
floor first: **stated** in the methodology text (works on any AI, the agnostic
baseline) → **cited** by every verb and process it governs (the rule surfaces at the
point of action — this is why verb frontmatter carries `contracts:`) → **reinforced**
by an engine hook where mechanically checkable (the bookend-reinforcement pattern;
optional, never load-bearing). `contracts/` legitimately holds both checkable rules
(*commits carry no AI attribution*) and judgement rules (*never break compat without
a playbook*) — the second kind is no less a contract for being uncheckable by
machine.

**Accumulation, not replacement.** Contracts stack across the resolution chain —
every ancestor's contracts bind, core's included; a same-named local contract
resolves lowest-wins only on *direct conflict*, it does not silence the rest. A
project escapes an inherited contract by consciously shadowing that name — visible,
auditable, on the record.

The shape, `<name>.contract.md`: frontmatter (`type: contract`, `name`, `title`,
`updated`, `checkable: yes|judgement`, `cited_by` — the verbs/processes that carry
it); body — the rule in one evaluable sentence, then what honoring it looks like,
then what checks it (a hook, a walk at [`save-point`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/save-point.verb.md), a
reviewer's eye).

**Citations are half the artifact.** A contract nothing cites fires only at
save-point's walk; wire the `contracts:` line of every governed verb/process in the
same motion ([`update-verb`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/update-verb.verb.md) / `update-process`), and the
hook where checkable.

## The operation

1. **Confirm the verb** (golden rule); mounted, claim covering
   `blueprint/contracts/`.
2. **Settle the rule**: one evaluable sentence; checkable or judgement; who cites
   it; conflict-check against the accumulated set (a contradiction with an
   inherited contract is a shadow decision, said aloud).
3. **Author**; **wire the citations** into the governed artifacts; hook where
   checkable.
4. **Branch index; state the addition** and its citation map.

## Refusals

- It says *how* rather than *what must hold* → verb or process.
- Target is `core/`, or a floor shadow → refuse.
- Uncited and unhooked with no save-point-walk relevance → push back: a rule nothing
  surfaces is an aspiration.

## Related

[`update-contract`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/update-contract.verb.md) ·
[`retire-contract`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/retire-contract.verb.md) ·
[`save-point`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/save-point.verb.md) walks the accumulated set ·
[`integrate-notepad`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/integrate-notepad.verb.md) feeds rules here.


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
