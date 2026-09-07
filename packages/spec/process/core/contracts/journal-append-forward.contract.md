---
type: contract
name: journal-append-forward
title: journal-append-forward — journal files are never edited after writing
updated: 2026-09-07
checkable: yes
cited_by:
  - close-session
  - archive-journal
---

# journal-append-forward

**A journal file (`journal/live/YYYY-MM-DD_NN.md`, and its archived twin) is
written once by the session it records and never edited or deleted afterwards.**
Sessions 1 through N are the audit trail, wrong guesses included; the record moves
forward by adding entries, never by revising them.

## What honoring it looks like

- **One file per session**, written by [`close-session`](../verbs/bookends/close-session.verb.md)
  (body + handover) and indexed once in `live.index.md`.
- **Rolling is moving.** [`archive-journal`](../verbs/lifecycle/archive-journal.verb.md)
  relocates files byte-for-byte; the indexes carry the seam.
- **Corrections are new entries.** A later session that finds an earlier entry
  wrong writes the correction in its own entry and points back — it does not touch
  the old file. Migrations that would "backfill" frontmatter into old entries are
  refused (the v0.7 RC found and fixed exactly that defect, F4).
- Indexes (`live.index.md`, `archive.index.md`) are wiring, not journal — they are
  editable.

## What checks it

- **Mechanically, by git:** any commit whose diff modifies or deletes a tracked
  `journal/(live|archive)/*_NN.md` file is a violation — visible at
  [`save-point`](../verbs/acknowledgement/save-point.verb.md)'s walk (`git log
  --diff-filter=MD -- journal/`), and checked by `ai-lore.py check` against the
  range since the last seal.
- **Reinforced:** the Claude binding's PreToolUse guard **denies** `Write`/`Edit`
  on an existing journal entry file (see [`bindings.md`](../verbs/bindings.md)) —
  the one contract the engine can enforce outright.
