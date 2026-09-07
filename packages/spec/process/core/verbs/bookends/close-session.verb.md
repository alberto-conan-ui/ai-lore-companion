---
type: verb
name: close-session
title: close-session — the session-closing bookend
family: bookends
track: any (its writes depend on the session's track type)
invoker: session (intrinsic — no external trigger)
writes:
  - journal/live/ (the session record — full and light tracks)
  - track record + status.stack.md (unmount, active-mark cleared)
  - one closing paired commit (full tracks; Human-Lead-confirmed)
  - next-save-point accumulator (the closing commit's row)
contracts:
  - golden-rule
  - ack-pairing
  - journal-append-forward
updated: 2026-07-02
---

# close-session

The session-closing bookend: write the journal, hand over, unmount, land the
closing commit. What makes session 87 start where 86 stopped instead of at zero.

## The journal write

One file per session, `journal/live/YYYY-MM-DD_NN.md` (`NN` the day's session
counter): frontmatter (`type: journal`, `date`, `session`, `track`, `focus`) · the
body — what actually happened, decisions with their why, defects found, dead ends
worth not re-walking · and the **handover** as the last section: where the work
stands, the next step, what the next session must know that the files alone don't
say. Then the one-liner into `live.index.md`, newest first — the trail orient
scans.

**Append-forward unconditionally** (the contract): journal files are never edited
or deleted after writing — sessions 1 through N are the audit trail, wrong guesses
included. By track type: **full** writes all of this; **light** writes the journal
entry only (its whole trace, landing as trunk drift for home to acknowledge);
**trackless leaves nothing** — no entry, no trace, by definition.

## The closing commit

Full tracks close dirty almost always — the journal write itself dirties the lore
repo. The bookend commits **its own writes plus whatever drift remains** as one
closing paired commit on the track's branches: payload-first, accumulator row
(verb column: `close-session`), lore carrying row + journal.
**Human-Lead-confirmed** — the session drafts the message, the Human Lead confirms
before it lands; the never-self-ack rule holds at the door too. Independent of the
ack family as ever: a session that ack'd five minutes ago still closes with its own
commit; one that never ack'd captures everything now.

## Unmount

`mounted_by` cleared on the track record; the focus's **active-mark cleared** in
`status.stack.md` (nobody is on it now — the track's focus *pointer* survives on
the record for the next mount). Where the session ends without this bookend — a
crash, a kill — the stale mount stays until the Human Lead's
[`release-track`](../tracks/release-track.verb.md); this paragraph is why that verb exists.

## The operation

1. **Surface the state**: drift on the track (both repos), work done, anything
   half-finished the handover must carry.
2. **Write the journal** — body + handover; index one-liner. (Light track: this,
   then stop — no commit, no unmount, nothing was mounted.)
3. **Draft the closing message**; the **Human Lead confirms**.
4. **Commit** payload-first, row, lore.
5. **Unmount**: record + active-mark. Verify both trees clean.
6. **Last words**: one line — where things stand, for the human closing the lid.

## Refusals

- Editing a prior journal entry while here → never; append-forward.
- Closing with unexplained drift → the drift goes *in* the closing commit and the
  handover names it; silent drift is the one thing this bookend exists to prevent.
- Trackless asked to journal → trackless leaves no trace; if the session did
  something worth recording, it wasn't trackless — resolve that honestly instead.

## Related

[`orient`](./orient.verb.md) reads tomorrow what this writes today ·
[`ack`](../acknowledgement/ack.verb.md) family — independent, never coupled ·
[`archive-journal`](../lifecycle/archive-journal.verb.md) rolls what accumulates ·
[`release-track`](../tracks/release-track.verb.md) mops up when this never ran.
