---
type: verb
name: update-focus
title: update-focus — amend bodies in a focus's subtree
family: status-tree
context: ./status-tree.md
track: full
writes:
  - focus / stage / phase bodies (one focus's subtree)
contracts:
  - golden-rule
updated: 2026-07-02
---

# update-focus

Amend the **bodies** of one focus's subtree — the gate text, the vision, the context,
the claim, a stage's intent, a phase's gate, journal-trail lines. This is the
design-of-record verb: locked decisions, amendments, and re-cuts land here.

## When to invoke

- The Human Lead amends the design: a new decision, an amendment, a gate re-cut, a
  claim adjustment.
- A stage/phase body needs its intent or gate sharpened as the work teaches.
- NOT for structure — creating, moving, or removing nodes is
  [`add-stage`](./add-stage.verb.md) / [`add-phase`](./add-phase.verb.md) /
  [`archive-focus`](./archive-focus.verb.md) work. Never both in one act.

## What a body write is

Bodies are prose under schema: a focus body carries Gate/Vision · Context · Stack ·
Active child pointer · Journal trail; stage and phase bodies carry Intent · Gate ·
Stack · Journal trail. Indexes are **not** bodies — an index is pure wiring and this
verb never touches one except to keep a changed title honest.

Three golden rules check every draft before it lands:

1. **Less is more** — write the minimum that carries the meaning.
2. **Write to be reviewed** — the Human Lead reads this; write for that reader.
3. **Never duplicate** — content that exists elsewhere gets a reference, not a copy.

**The discard guard.** One mechanical branch: does the write's diff remove existing
content with no equivalent landing elsewhere? Additive writes and relocations proceed
ungated. A discarding rewrite stops — show the Human Lead exactly what would be lost
and wait for explicit confirmation. Supersession is the middle path: mark the old
text superseded and add the new alongside (how design re-cuts stay honest).

Keep `updated:` frontmatter current; append journal-trail lines newest-first; never
edit a node's `status:` here — status moves belong to the lifecycle verbs.

## The operation

1. **Confirm the verb** (golden rule): name `update-focus`, the target node, and the
   intent; the Human Lead confirms. Ensure a mounted full track whose claim covers
   the focus's folder.
2. **Place the target in the chain** — focus, stage, or phase body — and note any
   ancestry the change disturbs (a stage intent that contradicts the focus context
   has not finished its write).
3. **Draft**, check the three golden rules, run the discard guard.
4. **Write**, updating `updated:` and the journal trail where the change warrants a
   line.
5. **State what changed** in reviewable terms.

## Refusals

- Structure requested (new node, move, delete) → route to the structural verbs.
- Target outside the mounted track's claim → refuse; extend claim or remount.
- A `status:` change → route to the lifecycle verbs
  ([`pause-focus`](./pause-focus.verb.md), [`complete-focus`](./complete-focus.verb.md), …).

## Related

[`add-new-focus`](./add-new-focus.verb.md) creates ·
[`add-stage`](./add-stage.verb.md) / [`add-phase`](./add-phase.verb.md) decompose ·
[`complete-stage`](./complete-stage.verb.md) / [`complete-phase`](./complete-phase.verb.md)
close children · [`review-focus-tree`](./review-focus-tree.verb.md) challenges staleness.
