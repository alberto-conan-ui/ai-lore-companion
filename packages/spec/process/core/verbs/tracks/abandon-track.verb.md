---
type: verb
name: abandon-track
title: abandon-track — discard a child workspace
family: tracks
context: ./tracks.md
track: full
invoker: human-lead
writes:
  - final auto-ack commit on the child's branches
  - branches deleted both repos; record removed; index + active-mark cleared
contracts:
  - golden-rule
  - ack-pairing
updated: 2026-07-02
---

# abandon-track

Discard a child track: its work does **not** land on home; the branches go; the
record goes. **Human-Lead-invoked, with an explicit confirmation** — this is the
destructive exit, softened by one grace: everything is committed before anything is
deleted.

## When to invoke

- The child's line of work is dead: superseded, disproven, or descoped.
- NOT when any part should survive — cherry-pick that part onto home with the Human
  Lead *first* (a partial merge is still a merge conversation), then abandon the
  rest. And never for home.

## What abandoning means

**Auto-ack first, always.** The child's dirty tree is committed on its branches —
both repos, pairing discipline intact, accumulator rows appended and marked
abandoned — *then* the branches are deleted. Git's object store keeps the commits
reachable by hash; the accumulator rows are the bookmark. Abandonment discards a
*direction*, never evidence: six months later, "what did we try in that track?" has
an answer.

Then the teardown, same shape as merge's: record removed, tracks index rewired, the
focus's active-mark cleared. The focus itself is **not** touched — a focus whose
only track was abandoned goes dormant (in-flight idle → dormant), and its own fate
(pause? new track later? honest discard via the guard?) is a separate conversation
the session should raise.

The Human Lead confirms twice by design: once for the verb, once for the deletion
after seeing what the auto-ack preserved. Destruction earns its ceremony.

## The operation

1. **Verify the invoker** is the Human Lead.
2. **Confirm the verb** (golden rule) and check nobody is mounted on the child (a
   mounted session closes first; a dead one is
   [`release-track`](./release-track.verb.md)'d first).
3. **Auto-ack**: commit the child's drift on both repos; append accumulator rows
   noting the abandonment; report the preserved hashes.
4. **Confirm the deletion** — the Human Lead, seeing the hashes.
5. **Tear down**: branches deleted both repos, record out, index rewired,
   active-mark cleared.
6. **Raise the focus question**: the now-dormant focus's fate.

## Refusals

- Not the Human Lead → refuse; sessions never self-abandon.
- A session is mounted → refuse until closed or released.
- Target is home → never.
- "Skip the auto-ack" → refuse; the grace is not optional — discarding evidence is
  the one thing this verb refuses to do.

## Related

[`merge-track`](./merge-track.verb.md) the landing exit ·
[`release-track`](./release-track.verb.md) clears a dead mount first ·
[`pause-focus`](../status-tree/pause-focus.verb.md) for the orphaned focus ·
[`spawn-track`](./spawn-track.verb.md) if the direction revives later.
