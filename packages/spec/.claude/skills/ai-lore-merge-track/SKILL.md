---
name: ai-lore-merge-track
description: "AI-Lore verb merge-track — land a child's work onto home"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/merge-track.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** tracks · **track:** full · **invoker:** human-lead · **writes:** git merges track/<name> → trunk on both repos; track record removed; tracks index, active-mark cleared; next-save-point accumulator (the merge commits' rows) · **contracts:** golden-rule; ack-pairing

# merge-track

Land a child track's work onto home and end the track's life: merge both repos,
remove the record, delete the branches. **Human-Lead-invoked** — landing onto
canonical state is always theirs.

## When to invoke

- The child's work is done (or done enough) and belongs on home.
- NOT for discarding (that is [`abandon-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/abandon-track.verb.md)) and never
  for home itself — home is permanent.

## What the merge is

Both repos merge as one unit — `track/<name>` into trunk on the Payload repo and the
lore repo together; landing one without the other is a torn state, the exact failure
the pairing discipline exists to prevent. Preconditions:

- **The child's tree is clean** — unacknowledged drift merges nothing; the child's
  final state is committed first (its last ack, or this verb's opening step with the
  Human Lead's nod).
- **Nobody is mounted** on the child — a mounted session finishes or closes first.

Conflicts concentrate where the carve-outs allow sharing: index files, the status
registry, the accumulator. Resolve with the Human Lead — index conflicts are wiring
(union them), registry conflicts are facts (take the truth), accumulator conflicts
are append-ordering (keep both rows). Payload conflicts inside the child's claim
should not exist (disjointness); one appearing means a claim was violated — resolve,
then note the violation ([`add-note`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/add-note.verb.md)) because the discipline
leaked.

After the merge: both merge commits append their rows to the **next-save-point
accumulator** (branch column now reads trunk; the child's per-ack rows arrived with
the merge itself); the record is removed, the tracks index rewired, the focus's
active-mark cleared, the branches deleted on both repos. The child's history
survives in git and in the accumulator — the track was a workspace, not the work.

## The operation

1. **Verify the invoker** is the Human Lead; session home-mounted (or mounting home
   for the act).
2. **Confirm the verb** (golden rule).
3. **Preconditions**: child clean (commit the last drift with the Human Lead if
   not), child unmounted.
4. **Merge both repos** trunk-ward, resolving conflicts with the Human Lead as
   above.
5. **Append the accumulator rows** for the merge commits (payload hash pinned,
   lore-side self-identifying).
6. **Tear down**: record out, index rewired, active-mark cleared, branches deleted
   both repos.
7. **State what landed** — and whether a
   [`save-point`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/save-point.verb.md) is now warranted (it often is; last child
   closed unlocks it).

## Refusals

- Not the Human Lead → refuse; sessions never self-merge.
- Child dirty or mounted → refuse until resolved.
- Target is home → home never merges away.

## Related

[`abandon-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/abandon-track.verb.md) the discarding exit ·
[`spawn-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/spawn-track.verb.md) the entry ·
[`ack`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/ack.verb.md) cleans the child first ·
[`save-point`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/save-point.verb.md) consolidates after.


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
