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
correlation work). [`save-point`](./save-point.verb.md) **seals** it into a dated
entry — final hash pins, the milestone description above the accumulated rows,
which remain as the milestone's *story* — and opens a fresh one.

## Who commits, and who never does

**Sessions never self-ack, self-save-point, self-merge, or self-abandon.** Every
landing onto canonical state is the Human Lead's act — direct, or a standing
instruction that names the verb and cadence; the git operation is just the
mechanism. Five verbs append rows: [`ack`](./ack.verb.md),
[`ack-and-continue`](./ack-and-continue.verb.md),
[`save-point`](./save-point.verb.md), the closing commit of
[`close-session`](../bookends/close-session.verb.md), and the auto-ack of
[`abandon-track`](../tracks/abandon-track.verb.md) (plus
[`merge-track`](../tracks/merge-track.verb.md)'s merge commits). Light tracks are
forbidden to commit entirely.
