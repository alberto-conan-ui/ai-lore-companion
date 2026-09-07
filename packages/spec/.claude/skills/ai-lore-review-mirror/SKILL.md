---
name: ai-lore-review-mirror
description: "AI-Lore verb review-mirror — diff the description against reality"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/review-mirror.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** blueprint · **track:** full · **home only:** true · **writes:** none directly — repairs execute through update-mirror · **contracts:** golden-rule

# review-mirror

Walk the mirror against the Payload as it actually is, surface every lie, and
interview the Human Lead about repairs. The mirror's grooming verb — home-only,
write-less, executing through [`update-mirror`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/update-mirror.verb.md).

## When to invoke

- Periodically — after a big Payload restructure, before a release, as the `groom`
  process's fourth step.
- When a session reports being misled by a node (the strongest trigger there is).

## What the review hunts

The mirror rots silently — the Payload moves and no write ever forces the
description to follow. Node by node, three directions of drift:

- **Stale nodes** — the described area changed: renamed, restructured, re-owned,
  its invariants shifted. Proposal: amend.
- **Orphan nodes** — the described area no longer exists. Proposal: remove (the
  guard shows what goes).
- **Blind spots** — areas that earned description since (a session got burned
  working them cold; a subsystem grew load-bearing). Proposal: new node. Blind
  spots are judgement — the mirror is sparse by design, so "undescribed" is only a
  finding when the silence costs something.

Evidence per finding: the node's text against the directory's reality, recent
Payload history, journal mentions of the area.

## The operation

1. **Confirm the verb** (golden rule); home-mounted.
2. **Walk the mirror tree** node by node against the Payload on disk; sweep for
   blind spots along recent-change paths.
3. **Interview** finding by finding — evidence, reading, proposal; the Human Lead
   disposes.
4. **Execute** accepted repairs through `update-mirror`, each under its own
   confirmation.
5. **Close with the delta**: amended / removed / added / dismissed.

## Refusals

- Not home / not mounted → refuse.
- Bulk auto-repair without the interview → refuse.

## Related

[`update-mirror`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/update-mirror.verb.md) executes ·
[`review-focus-tree`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/review-focus-tree.verb.md) /
[`review-backlog`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/review-backlog.verb.md) /
[`integrate-notepad`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/integrate-notepad.verb.md) /
[`review-references`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/review-references.verb.md) the grooming siblings ·
composed by the `groom` process.


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
