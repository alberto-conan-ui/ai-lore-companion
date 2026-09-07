---
name: ai-lore-release-track
description: "AI-Lore verb release-track — clear a dead session's stale mount"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/release-track.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** tracks · **track:** any (recovery runs from wherever the live session is) · **invoker:** human-lead · **writes:** track record (mounted_by cleared); status.stack.md (active-mark cleared) · **contracts:** golden-rule

# release-track

Clear a stale `mounted_by` left by a session that died without closing. The recovery
verb: one field, surgically, **Human-Lead-invoked** — because "that session is dead"
is a judgement about the world outside the project, and only the Human Lead can make
it.

## When to invoke

- A crash, a killed terminal, a lost machine: the session never ran its closing
  bookend, the record still names it, and every mount attempt refuses with "already
  mounted."
- NOT to take a track from a session that might be alive — two sessions on one track
  corrupts the workspace guarantee that everything else stands on. When in doubt,
  the answer is no.

## What releasing means

Two fields, nothing more: `mounted_by` → blank on the record, the active-mark → blank on the stack. Nothing else — the dead session's
uncommitted drift on the track's branches **stays**, honestly dirty, waiting for the
next mounting session to read (via orient's drift check) and for the Human Lead to
acknowledge or discard through the ack family. Releasing does not clean, does not
commit, does not judge the drift — untangling "what was that session doing" belongs
to whoever mounts next, with the journal's last entry as the map.

The active-mark in `status.stack.md` clears too — release substitutes for the close
the dead session never ran, and every unmount path (close, merge, abandon, release)
clears the mark the same way. The track's focus *pointer* survives on its record;
the next mount re-sets the mark.

## The operation

1. **Verify the invoker** is the Human Lead, and the deadness: is the named session
   genuinely gone? (The session ID and the journal's last entry are the evidence to
   read back.)
2. **Confirm the verb** (golden rule).
3. **Clear the fields**: `mounted_by` on the record, the active-mark on the stack; `updated:`.
4. **State the track's condition**: released, its drift intact and waiting, its
   focus pointer intact on the record — mountable again.

## Refusals

- Not the Human Lead → refuse.
- The session may be alive → refuse; never steal a mount.
- Asked to also clean up the drift → refuse here; that is the next mounted
  session's work through the proper verbs (this verb stays two-fields small on
  purpose — recovery tools that do more than they say are how recoveries go wrong).

## Related

[`mount-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/mount-track.verb.md) refuses stale mounts and points here ·
[`orient`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/bookends/orient.verb.md) surfaces the drift the dead session left ·
[`ack`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/ack.verb.md) acknowledges it once understood ·
[`abandon-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/abandon-track.verb.md) if the whole track turns out to be dead
with its session.


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
