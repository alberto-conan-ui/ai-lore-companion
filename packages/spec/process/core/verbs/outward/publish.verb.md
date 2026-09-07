---
type: verb
name: publish
title: publish — sync the curated deliverable
family: outward
context: ./outward.md
track: full
invoker: human-lead
home_only: true
writes:
  - publish/ (the sole writer, ever)
contracts:
  - golden-rule
updated: 2026-07-02
---

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
[`add-process`](../blueprint/add-process.verb.md)). This verb is the platform-neutral gate:
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

[`add-process`](../blueprint/add-process.verb.md) authors the recipe ·
[`update-payload`](../payload/update-payload.verb.md) works the workshop ·
[`init`](../lifecycle/init.verb.md) sets the Publishing shape.
