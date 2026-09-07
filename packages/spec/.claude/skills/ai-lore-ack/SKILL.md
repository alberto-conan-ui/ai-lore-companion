---
name: ai-lore-ack
description: "AI-Lore verb ack — acknowledge accumulated work"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/ack.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** acknowledgement · **track:** full · **invoker:** human-lead · **writes:** commits on the mounted track's branches, both repos, payload-first; next-save-point accumulator (one row per ack) · **contracts:** golden-rule; ack-pairing

# ack

The Human Lead acknowledges accumulated work: the dirty tree on the mounted track's
branches becomes a reviewable commit — **both repos as one unit, recorded as one row
in the next-save-point accumulator**. The deliberate pause-point verb; the message
ceremony is the point.

## When to invoke

- After reviewing a batch of accumulated changes — Memory, Payload, or both.
- Before switching context or stopping, when the work is not milestone-level
  (that is [`save-point`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/save-point.verb.md)).
- When further work would compound the drift past reviewable size.
- NOT mid-execution between chunks — that is
  [`ack-and-continue`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/ack-and-continue.verb.md), same commit shape, no ceremony.

## What an ack is

The pairing discipline, the accumulator row, branch naming, never-self-ack:
[`acknowledgement.md`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/acknowledgement.md). What this card adds: **the message
ceremony is the point.** Grouped by area (focus, status, journal, blueprint,
Payload), specific enough to review later — a vague ack defeats the verb. The
session drafts from the actual diff; the Human Lead confirms or edits before
anything lands. Independent of `close-session` — neither runs nor prompts about
the other.

## The operation

1. **Verify the invoker** is the Human Lead; mounted full track required (light
   tracks are forbidden to commit — their drift is home's to acknowledge).
2. **Confirm the verb** (golden rule).
3. **Draft the message** from the actual diff, area-grouped; the Human Lead
   confirms.
4. **Commit payload-first**, append the accumulator row, commit lore. Verify both
   trees clean.
5. **State the pair**: payload hash, lore hash, the row as written.

## Refusals

- Not the Human Lead → refuse; sessions never self-ack.
- Trackless or light → refuse; nothing to commit on / forbidden to commit.
- Clean trees → nothing to acknowledge; say so.

## Related

[`ack-and-continue`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/ack-and-continue.verb.md) the light sibling ·
[`save-point`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/save-point.verb.md) seals the accumulator ·
[`close-session`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/bookends/close-session.verb.md) commits its own closing state ·
[`merge-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/merge-track.verb.md) / [`abandon-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/abandon-track.verb.md)
append their own rows.


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
