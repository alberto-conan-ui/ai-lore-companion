---
type: verb
name: archive-journal
title: archive-journal — roll the live journal
family: lifecycle
track: full
invoker: human-lead
writes:
  - journal/live/ → journal/archive/ (files moved; both indexes rewired)
contracts:
  - golden-rule
  - journal-append-forward
updated: 2026-07-02
---

# archive-journal

Roll aged journal files from `live/` to `archive/` — the cadence the Human Lead
triggers, now with a verb that owns it.

## When to invoke

- `live/` has grown past what a session usefully scans at orient (the trail's
  one-liners are the working memory; dozens of stale entries dilute them).
- On the project's own rhythm — after a release, at a save-point, seasonally.

## What rolling means

**Move, never edit** — journal files are append-forward unconditionally (the
contract): rolled files keep their names and contents byte-for-byte; the audit trail
survives relocation. The roll takes the *old* — a recency window stays live, chosen
with the Human Lead (a release's worth, a month's worth — the default instinct:
keep what the current focus still references).

Indexes carry the seam: rolled files leave `live.index.md` and join
`archive/archive.index.md` **with their one-liners intact** — the journal trail's
history compresses into the archive index, it never vanishes. Save-point entries
that cite rolled sessions keep resolving (links updated where the path moved —
a stale link is an unfinished roll).

## The operation

1. **Verify the invoker**; **confirm the verb** (golden rule); mounted, claim
   covering `journal/`.
2. **Settle the window** with the Human Lead — what stays live.
3. **Move the rest**; rewire both indexes, one-liners preserved; repair inbound
   links (save-points, focuses).
4. **State the roll**: N files archived, the live window's new span.

## Refusals

- Any edit to a journal file's *content* → refused always; append-forward is a
  contract.
- Rolling the current session or anything the active focus still leans on →
  challenge it; live means live.

## Related

[`close-session`](../bookends/close-session.verb.md) writes what this eventually rolls ·
[`save-point`](../acknowledgement/save-point.verb.md) entries outlive every roll by design ·
the `groom` process may end by offering this.
