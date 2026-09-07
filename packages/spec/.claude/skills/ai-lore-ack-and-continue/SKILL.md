---
name: ai-lore-ack-and-continue
description: "AI-Lore verb ack-and-continue — light mid-execution commit"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/ack-and-continue.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** acknowledgement · **track:** full · **invoker:** human-lead · **writes:** commits on the mounted track's branches, both repos, payload-first; next-save-point accumulator (one row) · **contracts:** golden-rule; ack-pairing

# ack-and-continue

The lightweight sibling of [`ack`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/ack.verb.md): same commit shape, same pairing
discipline, same accumulator row — minimal message ceremony, and the session keeps
going. For chunking during execution, when the next step is more work, not review.

## When to invoke

- A logical chunk landed mid-run — a phase closed, a family of files written, a step
  of a gate done — and stopping to review would break the run's momentum.
- NOT when the Human Lead wants to pause and inspect (that is `ack`), and NOT for
  milestones (that is [`save-point`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/save-point.verb.md)).

## What it is

Everything `ack` is, compressed: payload-first commit, accumulator row (verb column:
`ack-and-continue`), lore commit carrying the row, both repos one unit. The message
is one or two lines naming the chunk — the area-grouped drafting is skipped because
the chunk is small enough that a line carries it. The Human Lead still confirms —
**even the light version is the Human Lead's acknowledgement** — but the
confirmation is designed to cost one breath: "committing p5, ack-and-continue?"

A standing instruction can make the confirmations cheaper still ("ack-and-continue
after each phase, go") — the per-chunk confirmation is then the standing one, named
in the run's plan. What never compresses away: the row, the pairing, the
payload-first order. Ceremony is optional; the record is not.

After the commit the session resumes immediately — no journal write, no pause.

## The operation

1. **Verify the invoker's acknowledgement** — direct, or a standing instruction that
   names this verb and its cadence.
2. **Confirm the verb** (golden rule; the standing instruction can carry it).
3. **Commit payload-first, append the row, commit lore.** One- or two-line message.
4. **State the pair in one line and continue working.**

## Refusals

- No Human Lead acknowledgement, direct or standing → refuse; even light acks are
  theirs.
- Trackless or light track → refuse.
- The "chunk" is actually huge or shapeless → suggest `ack` — a big diff deserves
  the ceremony.

## Related

[`ack`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/ack.verb.md) the deliberate sibling (and the encyclopedia for the pairing
mechanics — read it once; this verb inherits all of it) ·
[`save-point`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/save-point.verb.md) the milestone ·
[`complete-phase`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/complete-phase.verb.md) often precedes this verb.


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
