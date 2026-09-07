---
name: ai-lore-review-references
description: "AI-Lore verb review-references — audit the outward links"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/review-references.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** outward · **track:** full · **home only:** true · **writes:** none directly — repairs execute through the reference/parent verbs · **contracts:** golden-rule

# review-references

Audit every outward link — references *and* the parents list — against reality, and
interview the Human Lead about the dead ones. The outward grooming verb.

## When to invoke

- Periodically — the `groom` process's last step; after machines change or projects
  move on disk.

## What the review hunts

- **Dead targets** — `target_path` (or a parent's path) no longer resolves, or
  resolves to something that is no longer an AI-Lore project. Proposal: remove, or
  repair the path if the project moved.
- **Cold links** — a reference no journal entry has mentioned across many sessions;
  the purpose line reads like history. Proposal: remove (it can return when it
  earns it).
- **Miscast links** — a reference the project keeps *inheriting from* in spirit
  (copying its patterns by hand) → propose promotion to parent; a parent whose
  artifacts are never invoked → propose demotion to reference.
- **Broken contracts** — evidence a session *wrote* through a reference
  (read-only violated): surface loudly; that is a process defect to note, not just
  repair.

## The operation

1. **Confirm the verb** (golden rule); home-mounted.
2. **Walk** `references/` and the manifest's `parents:` — resolve every path, weigh
   every purpose against the journal's recent history.
3. **Interview** per finding; execute accepted outcomes through
   [`remove-reference`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/remove-reference.verb.md) /
   [`add-parent`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/add-parent.verb.md) / [`remove-parent`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/remove-parent.verb.md)
   / [`update-payload`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/payload/update-payload.verb.md)-adjacent repairs as fits.
4. **Close with the delta.**

## Refusals

- Not home / not mounted → refuse. · Bulk-remove without the interview → refuse.

## Related

[`add-reference`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/add-reference.verb.md) / [`remove-reference`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/remove-reference.verb.md)
· [`add-parent`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/add-parent.verb.md) / [`remove-parent`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/remove-parent.verb.md)
· the grooming siblings, composed by `groom`.


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
