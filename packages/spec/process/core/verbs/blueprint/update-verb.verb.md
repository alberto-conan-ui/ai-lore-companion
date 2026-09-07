---
type: verb
name: update-verb
title: update-verb — amend an authored verb
family: blueprint
context: ./blueprint.md
track: full
writes:
  - blueprint/verbs/<name>.verb.md (outside core/)
  - engine re-projection of the changed artifact
contracts:
  - golden-rule
updated: 2026-07-02
---

# update-verb

Amend a project-local or shadow verb. Inherits its encyclopedia from
[`add-verb`](./add-verb.verb.md) — the shape, the resolution chain, the engine
wiring; read it once, this verb applies it to an existing artifact.

## When to invoke

- An authored verb's discipline sharpened with use — refusals learned, scope
  clarified, a step that proved wrong.
- NOT for core artifacts — core is never edited in place. "Update a core verb"
  means: author the shadow (`add-verb`), which then takes the name.

## What holds

The verb's **name never changes** (a rename is retire + add — names are how
resolution, processes, and history refer to it). The discard guard applies: an
amendment that removes discipline (a refusal deleted, a confirmation dropped) is
shown to the Human Lead as what it is before it lands. Re-project to the engine in
the same motion, so the live skill matches the file.

## The operation

1. **Confirm the verb** (golden rule); mounted, claim covering `blueprint/verbs/`.
2. **Amend** per the add-verb shape; discard guard on removals.
3. **Re-project**; update the shadow's what/why line if scope shifted.
4. **State the change.**

## Refusals

- Target in `core/` → shadow instead. · Rename → retire + add. · Floor verbs → fixed.

## Related

[`add-verb`](./add-verb.verb.md) the encyclopedia ·
[`retire-verb`](./retire-verb.verb.md) the exit.
