---
name: ai-lore-spawn-track
description: "AI-Lore verb spawn-track — open a child workspace"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/spawn-track.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** tracks · **track:** full · **invoker:** human-lead · **writes:** tracks/<name>.track.md (new record); tracks index; git branches track/<name> on both repos · **contracts:** golden-rule

# spawn-track

Create a **child track** from home: record + branches, deliberately, before any
session mounts it. **Human-Lead-managed** — parallelism is a project decision, not a
session convenience.

## When to invoke

- Contention requires it: a second stream of work wants to proceed while home is
  busy, on a disjoint area.
- NOT to attach the current session (that is
  [`mount-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/mount-track.verb.md) — a different act, usually a different
  session) and NOT for a quick journal/backlog/notepad jot (a light track needs no
  spawn, no record, no branch).

## What spawn settles

The track primitive, types, claims, and lifecycle: [`tracks.md`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/tracks.md).
Spawn settles three things with the Human Lead — **name** (unique among open
tracks), **claim** (strictly disjoint from every open track's, verified here at
creation), **focus pointer** (optional; exploratory children are legal) — then
writes the record and branches `track/<name>` on both repos. It never attaches a
session; that is mount's act, usually a different session's.

## The operation

1. **Verify the invoker** is the Human Lead, and the session is home-mounted.
2. **Confirm the verb** (golden rule).
3. **Settle the design**: name, claim (verify disjointness against every open
   track), focus pointer if any.
4. **Branch both repos**: `track/<name>` on the Payload repo and the lore repo, from
   the current trunk state.
5. **Write the record** and wire the tracks index.
6. **State the child's shape** — it exists unmounted; a session attaches via
   `mount-track`.

## Refusals

- Invoked from a child track → refuse; children are spawned from home only.
- Claim overlaps an open track → refuse; recut the claims with the Human Lead.
- Name collides with an open track → refuse.

## Related

[`mount-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/mount-track.verb.md) attaches ·
[`merge-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/merge-track.verb.md) / [`abandon-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/abandon-track.verb.md)
end it · [`update-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/update-track.verb.md) reshapes the claim mid-life ·
[`save-point`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/save-point.verb.md) refuses while children are open.


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
