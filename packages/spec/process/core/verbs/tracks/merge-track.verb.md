---
type: verb
name: merge-track
title: merge-track — land a child's work onto home
family: tracks
context: ./tracks.md
track: full
invoker: human-lead
writes:
  - git merges track/<name> → trunk on both repos
  - track record removed; tracks index, active-mark cleared
  - next-save-point accumulator (the merge commits' rows)
contracts:
  - golden-rule
  - ack-pairing
updated: 2026-07-02
---

# merge-track

Land a child track's work onto home and end the track's life: merge both repos,
remove the record, delete the branches. **Human-Lead-invoked** — landing onto
canonical state is always theirs.

## When to invoke

- The child's work is done (or done enough) and belongs on home.
- NOT for discarding (that is [`abandon-track`](./abandon-track.verb.md)) and never
  for home itself — home is permanent.

## What the merge is

Both repos merge as one unit — `track/<name>` into trunk on the Payload repo and the
lore repo together; landing one without the other is a torn state, the exact failure
the pairing discipline exists to prevent. Preconditions:

- **The child's tree is clean** — unacknowledged drift merges nothing; the child's
  final state is committed first (its last ack, or this verb's opening step with the
  Human Lead's nod).
- **Nobody is mounted** on the child — a mounted session finishes or closes first.

Conflicts concentrate where the carve-outs allow sharing: index files, the status
registry, the accumulator. Resolve with the Human Lead — index conflicts are wiring
(union them), registry conflicts are facts (take the truth), accumulator conflicts
are append-ordering (keep both rows). Payload conflicts inside the child's claim
should not exist (disjointness); one appearing means a claim was violated — resolve,
then note the violation ([`add-note`](../buffers/add-note.verb.md)) because the discipline
leaked.

After the merge: both merge commits append their rows to the **next-save-point
accumulator** (branch column now reads trunk; the child's per-ack rows arrived with
the merge itself); the record is removed, the tracks index rewired, the focus's
active-mark cleared, the branches deleted on both repos. The child's history
survives in git and in the accumulator — the track was a workspace, not the work.

## The operation

1. **Verify the invoker** is the Human Lead; session home-mounted (or mounting home
   for the act).
2. **Confirm the verb** (golden rule).
3. **Preconditions**: child clean (commit the last drift with the Human Lead if
   not), child unmounted.
4. **Merge both repos** trunk-ward, resolving conflicts with the Human Lead as
   above.
5. **Append the accumulator rows** for the merge commits (payload hash pinned,
   lore-side self-identifying).
6. **Tear down**: record out, index rewired, active-mark cleared, branches deleted
   both repos.
7. **State what landed** — and whether a
   [`save-point`](../acknowledgement/save-point.verb.md) is now warranted (it often is; last child
   closed unlocks it).

## Refusals

- Not the Human Lead → refuse; sessions never self-merge.
- Child dirty or mounted → refuse until resolved.
- Target is home → home never merges away.

## Related

[`abandon-track`](./abandon-track.verb.md) the discarding exit ·
[`spawn-track`](./spawn-track.verb.md) the entry ·
[`ack`](../acknowledgement/ack.verb.md) cleans the child first ·
[`save-point`](../acknowledgement/save-point.verb.md) consolidates after.
