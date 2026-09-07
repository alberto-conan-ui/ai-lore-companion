---
type: verb
name: update-tooling
title: update-tooling — keep a registry card true
family: blueprint
context: ./blueprint.md
track: full
writes:
  - blueprint/tooling/<name>.tooling.md
contracts:
  - golden-rule
updated: 2026-07-02
---

# update-tooling

Amend a tooling entry so the card matches the tool. Inherits
[`add-tooling`](./add-tooling.verb.md)'s encyclopedia.

## When to invoke

- The tool moved, its invocation changed, its scope grew or narrowed.
- A session followed the card and hit a mismatch — fix the card in the same breath
  as the discovery (or [`add-note`](../buffers/add-note.verb.md) it when mid-flight).

## The operation

1. **Confirm the verb** (golden rule); mounted, claim.
2. **Verify against the tool** — the amended invocation runs; the path resolves.
3. **Amend the card**; `updated:`. **State the change.**

## Refusals

- The change is to the tool itself → Payload work first, card second.

## Related

[`add-tooling`](./add-tooling.verb.md) · [`retire-tooling`](./retire-tooling.verb.md).
