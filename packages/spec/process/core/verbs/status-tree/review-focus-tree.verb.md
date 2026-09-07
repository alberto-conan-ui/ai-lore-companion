---
type: verb
name: review-focus-tree
title: review-focus-tree — challenge what lingers in the tree
family: status-tree
context: ./status-tree.md
track: full
home_only: true
writes:
  - none directly — findings execute through the lifecycle verbs the Human Lead picks
contracts:
  - golden-rule
updated: 2026-07-02
---

# review-focus-tree

Walk the whole status tree, find what lingers, and interview the Human Lead about
each finding. A **grooming verb**: interrogative, home-only, and it writes nothing
itself — every accepted outcome executes through the fitting lifecycle verb.

## When to invoke

- Periodically — before a save-point, after a release, whenever the stack has grown
  rows nobody looks at.
- As part of the `groom` process (this verb is its first step).
- NOT as a bulk-archive hammer: findings are proposals; the Human Lead disposes.

## What the review hunts

Walk every focus — `draft`, `paused`, `in progress`, `done` — and its subtree, with
the journal trail and git history as evidence. The staleness patterns:

- **Overdue Done calls** — work shipped, focus still open. Classic tell: a `paused`
  focus whose gate conditions all verifiably hold (parking shipped work in `paused`
  is the known dishonesty). Proposal: [`complete-focus`](./complete-focus.verb.md).
- **Abandoned pauses** — `paused` with no resume note honored across many sessions,
  the world moved past the gate. Proposal: resume with amendment, or complete/discard
  the honest way.
- **Stale drafts** — `draft` untouched since creation, superseded by later focuses.
  Proposal: fold into the backlog (a draft that lost commitment is pre-focus again)
  or delete the intent explicitly.
- **Half-closed subtrees** — `done` stages under open focuses that finished ages ago,
  open phases under `done`-looking stages. Proposal: the truthful `complete-*` calls.
- **Unarchived closures** — `done` focuses cluttering the live tree. Proposal:
  [`archive-focus`](./archive-focus.verb.md) batch.
- **Pointer rot** — active-child pointers at closed children, stack rows disagreeing
  with frontmatter. Proposal: [`update-focus`](./update-focus.verb.md) repairs.

## The interview

One finding at a time: the evidence (what the trail/git shows), the reading (what it
means), the proposal (which verb, what outcome), then the Human Lead's call —
accept, amend, or dismiss (a dismissal with a reason is recorded knowledge; note it
on the focus's trail via `update-focus` when it changes how the focus should be
read). Accepted outcomes execute immediately through their verbs, each under its own
golden-rule confirmation — the review composes verbs, it never bypasses them.

## The operation

1. **Confirm the verb** (golden rule); home-mounted (grooming curates shared state —
   child tracks don't groom).
2. **Walk the tree** — every stack row, every subtree, evidence from trails and git.
3. **Build the findings list**, ordered by decay (oldest dishonesty first).
4. **Interview** finding by finding; execute accepted outcomes via their verbs.
5. **Close with the delta**: rows moved, subtrees archived, calls made, dismissals
   recorded.

## Refusals

- Not home / not mounted → refuse (grooming is home work).
- Asked to auto-apply without the interview → refuse; the Human Lead disposes per
  finding.

## Related

Executes through: [`complete-focus`](./complete-focus.verb.md) ·
[`archive-focus`](./archive-focus.verb.md) · [`pause-focus`](./pause-focus.verb.md) /
[`resume-focus`](./resume-focus.verb.md) · [`update-focus`](./update-focus.verb.md).
Siblings in grooming: [`review-backlog`](../buffers/review-backlog.verb.md) ·
[`integrate-notepad`](../buffers/integrate-notepad.verb.md) ·
[`review-mirror`](../blueprint/review-mirror.verb.md) ·
[`review-references`](../outward/review-references.verb.md). Composed by the `groom` process.
