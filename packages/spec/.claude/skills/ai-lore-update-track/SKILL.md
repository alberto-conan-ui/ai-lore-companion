---
name: ai-lore-update-track
description: "AI-Lore verb update-track — reshape a track's record"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/update-track.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** tracks · **track:** full · **writes:** tracks/<name>.track.md (claim, focus pointer, notes) · **contracts:** golden-rule

# update-track

Amend a track's **record** — most often its claim, occasionally its focus pointer or
notes. The mid-life maintenance verb the track family was missing: claims are
proposals that reality edits.

## When to invoke

- The work outgrew the claim: a legitimate write keeps falling outside it.
- The claim was cut too wide and a sibling track needs the territory.
- Home's working claim needs polish independent of the focus's persistent default
  (the focus's `claim` field is the default; home's record is the working override —
  edit the right one: persistent → [`update-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/update-focus.verb.md), working
  → here).
- The track repoints at a different focus (with the Human Lead; this re-seeds the
  claim and updates active-marks).
- NOT for `mounted_by` — mounting state belongs to
  [`mount-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/mount-track.verb.md) / [`release-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/release-track.verb.md)
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

[`spawn-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/spawn-track.verb.md) sets the initial shape ·
[`update-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/update-focus.verb.md) edits the focus-side claim default ·
[`mount-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/mount-track.verb.md) seeds claims at attach ·
[`release-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/release-track.verb.md) the other maintenance verb.


---

# Family context

# Tracks — family context

The shared knowledge of the track family. Verb cards in this folder assume it.

## Track types

What a session may touch is governed entirely by its track type:

| Type | Mounted? | Record? | Branch? | May write |
|---|---|---|---|---|
| **Trackless** | no | no | no | nothing — read-only, leaves no trace |
| **Light** | no | no | no | journal + backlog + notepad only; forbidden to commit — its writes land as drift on home's branch for a home session to acknowledge |
| **Full** | yes | yes | yes | everything within its claim, through the verbs |

## The primitive

A full track is a persistent workspace — **branch + claim + focus pointer** —
outliving the sessions that mount it. One record per track,
`tracks/<name>.track.md`: `name` (unique among open tracks), `branch` (identical on
both repos; home's is its record's — `trunk` in role-language, commonly `main`),
`claim`, `focus` (optional — tracks can be exploratory), `mounted_by` (a session ID
while mounted).

**Home** always exists, on the trunk-role branch, never spawned/merged/abandoned.
**Children** branch from home as `track/<name>` and end by merge or abandon.
Topology is **flat** — home plus N siblings; no nesting, no spawning from a child.
The lifecycle: **spawn → mount → … → merge/abandon**, with sessions attaching and
detaching along the way (tracks outlive sessions; work-in-progress lives on the
track).

## Mounting

**One session per track; one track per session** — no sharing, no mid-session
swaps. Mounting attaches, never creates. Registration is three-place: `mounted_by`
on the record, the track's name into the focus's **active-mark** in
`status.stack.md` (active is *derived from tracks* — set at mount, cleared at every
unmount path: close, merge, abandon, release), and — for home — the claim seeded
from the active focus's `claim` on first mount. A focus's *lifecycle status* is a
different, stored fact; active-mark and status answer different questions.

## Claims

The rule that makes parallelism safe: each track declares the path prefixes it may
write, **strictly disjoint by prefix across open tracks**, with shared carve-outs —
`*.index.md` files, the status registry, and the next-save-point accumulator
(merge conflicts there are the accepted cost of parallelism; append-shaped content
keeps them cheap). Disjointness is verified at spawn and at every claim change;
while a child claims an area, home may not write it. Home's claim is focus-derived;
with no claimed focus it is implicit — everything not claimed by a child.
