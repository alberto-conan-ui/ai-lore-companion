---
name: ai-lore-publish
description: "AI-Lore verb publish — sync the curated deliverable"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/publish.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** outward · **track:** full · **invoker:** human-lead · **home only:** true · **writes:** publish/ (the sole writer, ever) · **contracts:** golden-rule

# publish

Sync the Payload's curated subset into `publish/` — the external deliverable of a
**Publishing** project. The one verb allowed to write that surface; writes outside
it are refused regardless of track.

## When to invoke

- The deliverable should reflect the Payload's current state — after a batch of
  work, before a handoff, on the project's own cadence.
- Only in projects whose manifest declares a `publish:` block; everywhere else this
  verb refuses by shape.

## What publishing is

The Publishing shape splits the root: `payload/` is the workshop (source of truth),
`publish/` the curated subset that ships — a real directory or a symlink to an
external mount (a Drive folder, a static-site source). `publish/` is **derived
state**: regenerable from the Payload at any time, in no git repo, and that
asymmetry is the safety net — corrupted or drifted, re-publish.

**The recipe is the project's, not the verb's.** What crosses, how the sync runs,
what curation rules fire — that lives in the project's publish process
(`blueprint/processes/`, conventionally `publish.process.md`, authored via
[`add-process`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-process.verb.md)). This verb is the platform-neutral gate:
it checks the shape, runs the recipe, verifies the result. No recipe → author one
first; publishing without a recipe is hand-curation wearing a verb's name.

## The operation

1. **Verify the invoker** is the Human Lead; home-mounted; manifest declares
   `publish:`.
2. **Confirm the verb** (golden rule).
3. **Read the recipe** and walk it — the recipe's steps are verb references and
   mechanical syncs; curation judgements it defers go to the Human Lead inline.
4. **Verify the result**: the deliverable matches the recipe's promise; nothing
   crossed that the curation rules exclude.
5. **State what shipped** — the delta since last publish.

## Refusals

- No `publish:` block → not a Publishing project; refuse.
- Any other verb or session writing `publish/` → refused always, everywhere.
- No recipe → `add-process` first.

## Related

[`add-process`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-process.verb.md) authors the recipe ·
[`update-payload`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/payload/update-payload.verb.md) works the workshop ·
[`init`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/lifecycle/init.verb.md) sets the Publishing shape.


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
