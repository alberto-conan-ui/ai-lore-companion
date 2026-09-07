---
name: ai-lore-remove-parent
description: "AI-Lore verb remove-parent — stop inheriting from an upstream"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/remove-parent.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** outward · **track:** full · **invoker:** human-lead · **writes:** {"memory/workspace.yaml (parents": "list)"}; engine re-projection of the resolved artifact set · **contracts:** golden-rule

# remove-parent

Drop a parent from the manifest — its artifacts leave the resolved set, its
contracts stop binding. **Human-Lead-invoked.** Inherits
[`add-parent`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/add-parent.verb.md)'s encyclopedia.

## When to invoke

- The upstream is dead, diverged, or the relationship ended.
- NOT to dodge one inherited artifact — shadow that one name instead
  ([`add-verb`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-verb.verb.md) / [`add-contract`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-contract.verb.md));
  removal is the whole relationship.

## What removal means

The delta runs in reverse and is walked with the Human Lead **before** landing:
verbs that disappear (and any local process step that references them by name — 
those processes are amended first or the removal refuses), shadows that stop
shadowing (the local artifact stays, now standing alone), contracts that stop
binding (said plainly — this is `retire-contract`-grade in effect, at wholesale).

## The operation

1. **Verify the invoker**; **confirm the verb** (golden rule); mounted.
2. **Compute and present the reverse delta**; amend dependent processes first.
3. **Remove the manifest line**; **re-project** the resolved set.
4. **State what changed** — gone, unshadowed, unbound.

## Refusals

- Not the Human Lead → refuse.
- A local process still references an inherited verb by name → amend first.
- The problem is one artifact → shadow it instead.

## Related

[`add-parent`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/add-parent.verb.md) the encyclopedia ·
[`review-references`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/review-references.verb.md) proposes removals ·
[`install`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/lifecycle/install.verb.md) re-projects.


---

# Family context

# Outward — family context

The shared knowledge of the outward family. Verb cards in this folder assume it.

## Two kinds of outward link

- **References** — lazy, consult-only. `<lore>/references/<name>.md` (sibling to
  `memory/`, outward pointers, not the project's own thinking): frontmatter
  (`type: reference`, `target_path`, `purpose`, `scope`) + how/when to consult.
  Three rules: **read-only by contract** (never write through one; open the other
  project to work there); **link metadata only** (what reading it taught you goes
  in *this* project's notepad → blueprint, with the reference as source); **never
  auto-loaded** (consulted when work calls, not at session open).
- **Parents** — eager, inherited. An ordered `parents:` list in
  `memory/workspace.yaml`; a parent exposes its `blueprint/` and its artifacts
  become invocable here through the resolution chain (core < parents in declaration
  order < local, by name, lowest wins; contracts accumulate — the chain's full
  statement lives in [`blueprint.md`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/blueprint.md) and the floor).
  Parents form a DAG; a project may not be its own ancestor. Declaring or dropping
  one changes the live verb set and what binds — both verbs walk that delta with
  the Human Lead before landing.

Promotion and demotion between the two kinds is a grooming outcome
([`review-references`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/review-references.verb.md)): a reference the project keeps
imitating by hand wants to be a parent; a parent whose artifacts are never invoked
wants to be a reference.

## The publish surface

Publishing projects split the root: `payload/` (workshop, source of truth) and
`publish/` (the curated deliverable — a directory or a symlink to an external
mount). `publish/` is **derived state**, in no git repo, regenerable at any time,
and written by exactly one verb: [`publish`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/publish.verb.md). The recipe —
what crosses, what curation fires — is the project's own
`publish.process.md`; the verb is the gate.
