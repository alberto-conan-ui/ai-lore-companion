---
type: verb
name: resume-focus
title: resume-focus — pick a paused focus back up
family: status-tree
context: ./status-tree.md
track: full
writes:
  - status.stack.md (row status → in progress)
  - focus body (journal-trail resume note)
contracts:
  - golden-rule
updated: 2026-07-02
---

# resume-focus

Bring a `paused` focus back to `in progress` — with a staleness check, because the
project moved while the focus slept.

## When to invoke

- The Human Lead points the track back at a paused focus.
- NOT for starting a `draft` focus — `draft → in progress` happens automatically on
  first work (stated in [`add-new-focus`](./add-new-focus.verb.md) and
  [`mount-track`](../tracks/mount-track.verb.md)); there is no resume ceremony for a focus
  that never started.

## What resuming means

Read before you run: the pause note (the last journal-trail line) says where the
work stood and the first step back. Then check staleness — the gate against the
project as it *now* is: conditions may have been met by other work, invalidated by
amendments, or superseded entirely. A stale gate is amended via
[`update-focus`](./update-focus.verb.md) (Human Lead confirming) before work
proceeds; resuming into a stale plan is how sessions build the wrong thing
confidently.

Status: stack row and focus frontmatter → `in progress`; a resume line on the
journal trail. If the track's claim was reshaped while the focus slept, reconcile via
[`update-track`](../tracks/update-track.verb.md).

## The operation

1. **Confirm the verb** (golden rule): name `resume-focus`; the Human Lead confirms.
   Ensure a mounted full track whose claim covers the focus.
2. **Read the pause note** and walk the focus chain to the tip.
3. **Staleness check**: gate vs current reality; propose amendments where the world
   moved; land them via `update-focus` first.
4. **Move the status**: row and frontmatter → `in progress`; resume line on the
   trail; `updated:`.
5. **State where the work resumes** — the first step, per the (possibly amended)
   plan.

## Refusals

- Focus is not `paused` → nothing to resume (a `draft` starts by working; a `done`
  reopens only by Human Lead decision through a new focus or an explicit amendment).
- Claim conflicts with an open child track → resolve claims first.

## Related

[`pause-focus`](./pause-focus.verb.md) the way out ·
[`update-focus`](./update-focus.verb.md) amends the stale gate ·
[`review-focus-tree`](./review-focus-tree.verb.md) proposes which pauses deserve
resuming at all.
