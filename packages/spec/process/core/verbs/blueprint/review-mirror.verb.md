---
type: verb
name: review-mirror
title: review-mirror — diff the description against reality
family: blueprint
context: ./blueprint.md
track: full
home_only: true
writes:
  - none directly — repairs execute through update-mirror
contracts:
  - golden-rule
updated: 2026-07-02
---

# review-mirror

Walk the mirror against the Payload as it actually is, surface every lie, and
interview the Human Lead about repairs. The mirror's grooming verb — home-only,
write-less, executing through [`update-mirror`](./update-mirror.verb.md).

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

[`update-mirror`](./update-mirror.verb.md) executes ·
[`review-focus-tree`](../status-tree/review-focus-tree.verb.md) /
[`review-backlog`](../buffers/review-backlog.verb.md) /
[`integrate-notepad`](../buffers/integrate-notepad.verb.md) /
[`review-references`](../outward/review-references.verb.md) the grooming siblings ·
composed by the `groom` process.
