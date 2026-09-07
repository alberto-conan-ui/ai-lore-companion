---
type: verb
name: save-point
title: save-point — seal a milestone
family: acknowledgement
context: ./acknowledgement.md
track: full
invoker: human-lead
home_only: true
writes:
  - commits on home's branches, both repos, payload-first
  - the accumulator sealed into a dated ledger entry; a fresh next opened
  - save-points index
contracts:
  - golden-rule
  - ack-pairing
updated: 2026-07-02
---

# save-point

The formal milestone: commit home's state, **seal the open next-save-point
accumulator into a dated ledger entry**, check the contracts, open the next
accumulator. Home-only; requires every child track closed — a save-point is a
coherent project state, one trunk, no in-flight branches.

## When to invoke

- A release ships, a focus closes, a migration lands — a state the project may want
  to return to, forever.
- After the last [`merge-track`](../tracks/merge-track.verb.md) closes the last child (merge
  often ends by suggesting this verb).
- NOT for everyday acknowledgement — that is the [`ack`](./ack.verb.md) family; a
  save-point that marks nothing memorable devalues the ledger.

## The seal

Ledger, accumulator, pairing: [`acknowledgement.md`](./acknowledgement.md). What
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
   [`archive-focus`](../status-tree/archive-focus.verb.md) for any `done` focuses this milestone
   closes out.
7. **State the milestone**: entry name, pins, and the story's row count.

## Refusals

- Not the Human Lead → refuse; sessions never self-save-point.
- Child tracks open → refuse; consolidation means consolidated.
- Not home → refuse.
- Contract violations unaddressed → refuse the seal.

## Related

[`ack`](./ack.verb.md) / [`ack-and-continue`](./ack-and-continue.verb.md) fill the
accumulator · [`merge-track`](../tracks/merge-track.verb.md) unlocks this verb ·
[`archive-focus`](../status-tree/archive-focus.verb.md) the offered follow-up ·
[`close-session`](../bookends/close-session.verb.md) independent, as ever.
