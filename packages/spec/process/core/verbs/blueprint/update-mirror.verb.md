---
type: verb
name: update-mirror
title: update-mirror — keep the Payload's description true
family: blueprint
context: ./blueprint.md
track: full
writes:
  - blueprint/mirror/ (nodes created, amended, removed; indexes wired)
contracts:
  - golden-rule
updated: 2026-07-02
---

# update-mirror

Create, amend, or remove **mirror nodes** — the project's committed description of
the Payload's shape. One verb for all three: a mirror node is *description*, and
keeping a description true is one act whether that means writing, correcting, or
erasing it.

## When to invoke

- An area of the Payload gains something standing to say: what it is, what it owns,
  what a session must know before working it.
- The Payload restructured and the mirror lies; or
  [`review-mirror`](./review-mirror.verb.md) surfaced the drift.
- A described area was deleted — its node goes (removal of a *description* whose
  subject vanished; the discard guard still shows what's being dropped).
- NOT for aspirations ("this area *should* become…" — backlog or focus material)
  and NOT for learned-but-unvalidated observations
  ([`add-note`](../buffers/add-note.verb.md) until they harden).

## What the mirror is

`blueprint/mirror/` mirrors the Payload's directory tree, **sparsely**: a node
exists only where the project has something standing to say — most folders have
none, and that emptiness is valid, not a gap. Mirror is *committed* description
(the project vouches for it); raw discovery lives in the notepad until it earns
commitment. Each node: frontmatter (`type: blueprint`, `branch: mirror`, `title`,
`updated`) + a body that tells a session what it must know *before* working the
area — ownership, invariants, the traps. The folder mirrors the Payload path, so
finding the node for `src/engine/` never requires a search.

The mirror is what [`update-payload`](../payload/update-payload.verb.md) consults before
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

[`review-mirror`](./review-mirror.verb.md) hunts the drift ·
[`update-payload`](../payload/update-payload.verb.md) the consumer ·
[`integrate-notepad`](../buffers/integrate-notepad.verb.md) routes hardened observations
here.
