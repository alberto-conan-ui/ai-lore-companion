---
type: verb
name: ack-and-continue
title: ack-and-continue — light mid-execution commit
family: acknowledgement
context: ./acknowledgement.md
track: full
invoker: human-lead
writes:
  - commits on the mounted track's branches, both repos, payload-first
  - next-save-point accumulator (one row)
contracts:
  - golden-rule
  - ack-pairing
updated: 2026-07-02
---

# ack-and-continue

The lightweight sibling of [`ack`](./ack.verb.md): same commit shape, same pairing
discipline, same accumulator row — minimal message ceremony, and the session keeps
going. For chunking during execution, when the next step is more work, not review.

## When to invoke

- A logical chunk landed mid-run — a phase closed, a family of files written, a step
  of a gate done — and stopping to review would break the run's momentum.
- NOT when the Human Lead wants to pause and inspect (that is `ack`), and NOT for
  milestones (that is [`save-point`](./save-point.verb.md)).

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

[`ack`](./ack.verb.md) the deliberate sibling (and the encyclopedia for the pairing
mechanics — read it once; this verb inherits all of it) ·
[`save-point`](./save-point.verb.md) the milestone ·
[`complete-phase`](../status-tree/complete-phase.verb.md) often precedes this verb.
