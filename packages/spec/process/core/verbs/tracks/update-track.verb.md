---
type: verb
name: update-track
title: update-track — reshape a track's record
family: tracks
context: ./tracks.md
track: full
writes:
  - tracks/<name>.track.md (claim, focus pointer, notes)
contracts:
  - golden-rule
updated: 2026-07-02
---

# update-track

Amend a track's **record** — most often its claim, occasionally its focus pointer or
notes. The mid-life maintenance verb the track family was missing: claims are
proposals that reality edits.

## When to invoke

- The work outgrew the claim: a legitimate write keeps falling outside it.
- The claim was cut too wide and a sibling track needs the territory.
- Home's working claim needs polish independent of the focus's persistent default
  (the focus's `claim` field is the default; home's record is the working override —
  edit the right one: persistent → [`update-focus`](../status-tree/update-focus.verb.md), working
  → here).
- The track repoints at a different focus (with the Human Lead; this re-seeds the
  claim and updates active-marks).
- NOT for `mounted_by` — mounting state belongs to
  [`mount-track`](./mount-track.verb.md) / [`release-track`](./release-track.verb.md)
  / the closing bookend, never to hand edits.

## What a claim change means

**Disjointness is re-verified at every change** — the new claim against every other
open track's, same check as spawn. Widening home while a child holds the area is
refused (merge or abandon the child first); narrowing is free; swaps between
consenting tracks are two updates the Human Lead confirms together, checked as a
pair.

A focus repoint updates three places as one act: the record's `focus`, the old
focus's active-mark (cleared), the new one's (set) — plus the claim re-seed from the
new focus. Half-done repoints are how registries lie.

## The operation

1. **Confirm the verb** (golden rule): name `update-track`, the track, and the
   change; the Human Lead confirms.
2. **Verify** the change's invariants: claim disjointness across all open tracks, or
   the repoint's three-place consistency.
3. **Write the record** (`updated:`, and the stack file where active-marks moved).
4. **State the new shape** — especially what the track may now touch that it
   couldn't, and vice versa.

## Refusals

- Claim would overlap an open sibling → refuse; recut with the Human Lead.
- `mounted_by` edits → route to the mount/release verbs.
- Repointing a track another session has mounted → that session's business; refuse
  from outside.

## Related

[`spawn-track`](./spawn-track.verb.md) sets the initial shape ·
[`update-focus`](../status-tree/update-focus.verb.md) edits the focus-side claim default ·
[`mount-track`](./mount-track.verb.md) seeds claims at attach ·
[`release-track`](./release-track.verb.md) the other maintenance verb.
