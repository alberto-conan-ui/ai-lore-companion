---
type: contract
name: ack-pairing
title: ack-pairing — every acknowledgement is a paired, ledgered commit
updated: 2026-09-07
checkable: yes
cited_by:
  - ack
  - ack-and-continue
  - save-point
  - close-session
  - merge-track
  - abandon-track
---

# ack-pairing

**Every acknowledgement commits both repos as one unit, payload-first, and appends
one annotated row to the open `next.save-point.md` accumulator whose lore-side
commit is the one that added the row.** No commit on either repo lands outside an
ack-family verb; no ack-family commit lands without its row.

## What honoring it looks like

- **Order:** Payload commits first (when dirty), on the track's branch; the row is
  appended — date · verb · track · branch · payload hash (or `—` when lore-only) ·
  summary; the lore repo commits second, carrying the row.
- **Who:** the Human Lead, always — direct, or by a standing instruction that
  names the verb and cadence. Sessions never self-ack, self-save-point, self-merge,
  self-abandon. Light tracks never commit.
- **Where:** the track's branch, identical on both repos; branch names are
  record-authoritative (home's record says `main`, `trunk`, or the release branch
  of the moment).
- **Seal:** [`save-point`](../verbs/acknowledgement/save-point.verb.md) seals the
  accumulator into a dated entry and opens a fresh one in the same lore commit —
  the ledger is never without an open `next`.

## What checks it

- **Mechanically, at `save-point`'s contract walk and by any consumer:** for every
  row in the ledger, the payload hash resolves in the Payload repo (or is `—`), and
  the lore commit that introduced the row is the pair's lore half. Every lore
  commit since the last seal must be attributable to a row (`git -C <lore>/memory
  log` vs the accumulator's row count). A commit with no row, or a row with no
  commit, is a violation.
- **Reinforced:** the Claude binding's SessionStart orient and the drift check at
  both bookends surface unacknowledged work; the accumulator's existence is
  verified by `ai-lore.py check`.
