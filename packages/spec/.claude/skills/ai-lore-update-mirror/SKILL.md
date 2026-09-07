---
name: ai-lore-update-mirror
description: "AI-Lore verb update-mirror — keep the Payload's description true"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/update-mirror.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** blueprint · **track:** full · **writes:** blueprint/mirror/ (nodes created, amended, removed; indexes wired) · **contracts:** golden-rule

# update-mirror

Create, amend, or remove **mirror nodes** — the project's committed description of
the Payload's shape. One verb for all three: a mirror node is *description*, and
keeping a description true is one act whether that means writing, correcting, or
erasing it.

## When to invoke

- An area of the Payload gains something standing to say: what it is, what it owns,
  what a session must know before working it.
- The Payload restructured and the mirror lies; or
  [`review-mirror`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/review-mirror.verb.md) surfaced the drift.
- A described area was deleted — its node goes (removal of a *description* whose
  subject vanished; the discard guard still shows what's being dropped).
- NOT for aspirations ("this area *should* become…" — backlog or focus material)
  and NOT for learned-but-unvalidated observations
  ([`add-note`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/add-note.verb.md) until they harden).

## What the mirror is

`blueprint/mirror/` mirrors the Payload's directory tree, **sparsely**: a node
exists only where the project has something standing to say — most folders have
none, and that emptiness is valid, not a gap. Mirror is *committed* description
(the project vouches for it); raw discovery lives in the notepad until it earns
commitment. Each node: frontmatter (`type: blueprint`, `branch: mirror`, `title`,
`updated`) + a body that tells a session what it must know *before* working the
area — ownership, invariants, the traps. The folder mirrors the Payload path, so
finding the node for `src/engine/` never requires a search.

The mirror is what [`update-payload`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/payload/update-payload.verb.md) consults before
writing — the reader this verb writes for is a session about to touch the area
cold.

## The operation

1. **Confirm the verb** (golden rule); mounted, claim covering
   `blueprint/mirror/`.
2. **Verify against reality**: the described area, as it is on disk right now —
   never write the mirror from memory or intention.
3. **Write / amend / remove** the node (guard on removals); wire the mirror indexes
   along the path.
4. **State the delta** between what the mirror said and what it now says.

## Refusals

- Describing what doesn't exist yet → refuse; the mirror trails reality, never
  leads it.
- The content is speculative or unvalidated → notepad first.

## Related

[`review-mirror`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/review-mirror.verb.md) hunts the drift ·
[`update-payload`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/payload/update-payload.verb.md) the consumer ·
[`integrate-notepad`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/integrate-notepad.verb.md) routes hardened observations
here.


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
