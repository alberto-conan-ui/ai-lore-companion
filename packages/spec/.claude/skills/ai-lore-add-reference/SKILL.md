---
name: ai-lore-add-reference
description: "AI-Lore verb add-reference — declare a consult-only link"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/add-reference.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** outward · **track:** full · **writes:** references/<name>.md + references index · **contracts:** golden-rule

# add-reference

Declare a **reference** — a consult-only link to another AI-Lore project on disk
this project looks at for context.

## When to invoke

- The project starts consulting a sibling, a reference implementation, a related
  effort.
- NOT for inheritance — a project whose *artifacts* should be invocable here is a
  **parent** ([`add-parent`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/add-parent.verb.md)); references are lazy and
  read-only, parents are eager and resolved.

## What a reference is

The reference file's anatomy and its three rules (read-only, link-metadata-only,
never auto-loaded): [`outward.md`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/outward.md). This card owns the birth: verify
the target actually exists and is consulted for a reason one line can state, then
author the file and wire the index (creating `references/` + index on first use —
the folder is optional until then).

## The operation

1. **Confirm the verb** (golden rule); mounted full track.
2. **Verify the target** — an AI-Lore project at `target_path`, readable, actually
   consulted for a reason one line can state.
3. **Author the file**; wire `references.index.md` (create the folder + index on
   first use — the folder is optional until then).
4. **State the link.**

## Refusals

- The intent is inheritance → `add-parent`.
- Nothing concrete to consult (a "might be useful someday" link) → notepad it;
  references earn their file by being used.

## Related

[`remove-reference`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/remove-reference.verb.md) ·
[`review-references`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/review-references.verb.md) ·
[`add-parent`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/add-parent.verb.md) the eager sibling ·
[`add-note`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/add-note.verb.md) holds what reading the reference taught.


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
