---
name: ai-lore-save-point
description: "AI-Lore verb save-point — seal a milestone"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/save-point.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** acknowledgement · **track:** full · **invoker:** human-lead · **home only:** true · **writes:** commits on home's branches, both repos, payload-first; the accumulator sealed into a dated ledger entry; a fresh next opened; save-points index · **contracts:** golden-rule; ack-pairing

# save-point

The formal milestone: commit home's state, **seal the open next-save-point
accumulator into a dated ledger entry**, check the contracts, open the next
accumulator. Home-only; requires every child track closed — a save-point is a
coherent project state, one trunk, no in-flight branches.

## When to invoke

- A release ships, a focus closes, a migration lands — a state the project may want
  to return to, forever.
- After the last [`merge-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/merge-track.verb.md) closes the last child (merge
  often ends by suggesting this verb).
- NOT for everyday acknowledgement — that is the [`ack`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/ack.verb.md) family; a
  save-point that marks nothing memorable devalues the ledger.

## The seal

Ledger, accumulator, pairing: [`acknowledgement.md`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/acknowledgement.md). What
this card adds — the seal itself: rename `next.save-point.md` to
`YYYY-MM-DD_<slug>.save-point.md`; frontmatter gains `date`, `lore_commit`,
`payload_commit` (this verb's own closing pair — the final pins); the milestone
description goes above the accumulated rows, which remain as the milestone's
*story*. A fresh empty `next` opens in the same lore commit. **The contract
check** precedes the seal: walk the accumulated contracts (all levels) against the
Payload; a violation stops the seal — fix forward, or the Human Lead records a
conscious override in the entry.

## The operation

1. **Verify the invoker** is the Human Lead; home-mounted; **every child track
   closed** (else refuse — merge or abandon first).
2. **Confirm the verb** (golden rule).
3. **Contract check**; stop on violations unless overridden on the record.
4. **Commit the drift** payload-first with the milestone message (this commit's row
   goes into the entry as its closing line).
5. **Seal**: rename, pin `date`/`lore_commit`/`payload_commit`, write the milestone
   description; **open the fresh next**; wire the save-points index.
6. **Commit lore** carrying seal + fresh-open. Offer
   [`archive-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/archive-focus.verb.md) for any `done` focuses this milestone
   closes out.
7. **State the milestone**: entry name, pins, and the story's row count.

## Refusals

- Not the Human Lead → refuse; sessions never self-save-point.
- Child tracks open → refuse; consolidation means consolidated.
- Not home → refuse.
- Contract violations unaddressed → refuse the seal.

## Related

[`ack`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/ack.verb.md) / [`ack-and-continue`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/ack-and-continue.verb.md) fill the
accumulator · [`merge-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/merge-track.verb.md) unlocks this verb ·
[`archive-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/archive-focus.verb.md) the offered follow-up ·
[`close-session`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/bookends/close-session.verb.md) independent, as ever.


---

# Family context

# Acknowledgement — family context

The shared knowledge of the ack family. Verb cards in this folder assume it.

## The drift signal

Memory and Payload are separate git repos (the lore repo's `.git/` lives at
`<lore>/memory/.git/` — address it explicitly: `git -C <lore>/memory`). The working
tree's dirty state on a track's branches is that track's **drift signal**: dirty =
unacknowledged work, clean = acknowledged. Drift is per-track, derived at the
bookends, stored nowhere.

**Branches are record-authoritative.** The methodology says `trunk` as
role-language for home's branch; the *actual* name lives on home's track record
(`main` in most real projects). Children use `track/<name>`, identical on both
repos.

## The pairing discipline

Every acknowledgement commits **both repos as one unit**, and the pair is joined by
**data, not heuristics**:

1. **Payload commits first** (when dirty), on the track's branch.
2. **A row is appended** to the open accumulator (below): date · verb · track ·
   branch · the payload commit's hash · one-line summary. Lore-only acks record
   `—` in the payload column.
3. **The lore repo commits second, carrying the row.** The row's lore-side commit
   is **self-identifying** — the commit that added row N *is* acknowledgement N's
   lore half.

Any consumer — a companion app, a future session — resolves every cross-repo,
cross-branch pair from one file.

## The accumulator and the ledger

`memory/save-points/` is the **append-only ledger** — it never rolls; entries stay
reachable forever. Between milestones, one entry is always **open**:
`next.save-point.md`, the accumulator every ack-family commit appends to. It is a
shared surface (child tracks append too — that is what makes cross-branch
correlation work). [`save-point`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/save-point.verb.md) **seals** it into a dated
entry — final hash pins, the milestone description above the accumulated rows,
which remain as the milestone's *story* — and opens a fresh one.

## Who commits, and who never does

**Sessions never self-ack, self-save-point, self-merge, or self-abandon.** Every
landing onto canonical state is the Human Lead's act — direct, or a standing
instruction that names the verb and cadence; the git operation is just the
mechanism. Five verbs append rows: [`ack`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/ack.verb.md),
[`ack-and-continue`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/ack-and-continue.verb.md),
[`save-point`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/save-point.verb.md), the closing commit of
[`close-session`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/bookends/close-session.verb.md), and the auto-ack of
[`abandon-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/abandon-track.verb.md) (plus
[`merge-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/merge-track.verb.md)'s merge commits). Light tracks are
forbidden to commit entirely.
