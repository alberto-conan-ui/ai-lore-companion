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
  statement lives in [`blueprint.md`](../blueprint/blueprint.md) and the floor).
  Parents form a DAG; a project may not be its own ancestor. Declaring or dropping
  one changes the live verb set and what binds — both verbs walk that delta with
  the Human Lead before landing.

Promotion and demotion between the two kinds is a grooming outcome
([`review-references`](./review-references.verb.md)): a reference the project keeps
imitating by hand wants to be a parent; a parent whose artifacts are never invoked
wants to be a reference.

## The publish surface

Publishing projects split the root: `payload/` (workshop, source of truth) and
`publish/` (the curated deliverable — a directory or a symlink to an external
mount). `publish/` is **derived state**, in no git repo, regenerable at any time,
and written by exactly one verb: [`publish`](./publish.verb.md). The recipe —
what crosses, what curation fires — is the project's own
`publish.process.md`; the verb is the gate.
