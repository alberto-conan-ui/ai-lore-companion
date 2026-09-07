---
name: ai-lore-abandon-track
description: "AI-Lore verb abandon-track — discard a child workspace"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/abandon-track.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** tracks · **track:** full · **invoker:** human-lead · **writes:** final auto-ack commit on the child's branches; branches deleted both repos; record removed; index + active-mark cleared · **contracts:** golden-rule; ack-pairing

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
   [`release-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/release-track.verb.md)'d first).
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

[`merge-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/merge-track.verb.md) the landing exit ·
[`release-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/release-track.verb.md) clears a dead mount first ·
[`pause-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/pause-focus.verb.md) for the orphaned focus ·
[`spawn-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/spawn-track.verb.md) if the direction revives later.


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
