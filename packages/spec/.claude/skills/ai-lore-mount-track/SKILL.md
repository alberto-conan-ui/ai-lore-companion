---
name: ai-lore-mount-track
description: "AI-Lore verb mount-track — attach a session to a workspace"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/mount-track.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** tracks · **track:** n/a (this verb creates the session's track state) · **writes:** track record (mounted_by, claim seeding); status.stack.md (active-mark); git checkout of the track's branches (children) · **contracts:** golden-rule

# mount-track

Attach a session to an **existing full track** — the entry to write-capable state. A
trackless session reads everything and writes nothing; mounting is what changes
that.

## When to invoke

- Explicitly, when the Human Lead knows the track up front.
- Implicitly, the moment a trackless session is asked to make a full-track write —
  every writing verb routes here when unmounted. The **fast path**: if the only
  candidate is home and home is free, auto-mount silently and proceed; the
  single-session project never feels the machinery.
- NOT for journal/backlog/notepad-only writes — that is light-track work, unmounted
  by design.

## What mounting means

Types, one-per rules, registration, claims: [`tracks.md`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/tracks.md). What this
card adds: **home** needs no checkout (it is the trunk-role branch) and seeds its
claim from the active focus on first mount (an already-set claim is preserved —
focus switch re-seeds, not plain mount); **children** check out `track/<name>` on
**both** repos — one repo on the branch with the other on trunk is a torn state.
Then walk the chain from the track's focus to its tip — a mounted session is expert
on its focus, not just permitted to write it. A `draft` focus moves to
`in progress` on first work, no ceremony.

## The operation

1. **Confirm the verb** (golden rule) — silent on the auto-mount fast path, which is
   its one sanctioned elision (the write that triggered it carries the
   confirmation).
2. **Resolve the candidate**: named track, or home (fast path), or ask the Human
   Lead when home is taken and children exist.
3. **Verify mountable**: exists, and `mounted_by` is blank (a dead session's stale
   mount is [`release-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/release-track.verb.md)'s business — never steal).
4. **Check out branches** (child), **register** (`mounted_by`, active-mark, claim
   seeding), **walk the chain**.
5. **State the mount**: track, claim, focus, chain tip.

## Refusals

- Track already mounted → refuse; point at `release-track` if the holder is dead.
- Track does not exist → refuse; `spawn-track` from home first.
- Session already mounted → refuse; one track per session, close to switch.

## Related

[`spawn-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/spawn-track.verb.md) creates ·
[`release-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/release-track.verb.md) recovers stale mounts ·
[`update-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/update-track.verb.md) polishes the claim ·
[`orient`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/bookends/orient.verb.md) runs the same chain walk at session open ·
[`close-session`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/bookends/close-session.verb.md) unmounts.


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
