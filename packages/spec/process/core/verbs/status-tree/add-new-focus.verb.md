---
type: verb
name: add-new-focus
title: add-new-focus — open a unit of intent
family: status-tree
context: ./status-tree.md
track: full
writes:
  - status tree structure (new focus folder + index)
  - focus body
  - status.stack.md (new row)
contracts:
  - golden-rule
updated: 2026-07-02
---

# add-new-focus

Open a **focus** — one unit of intent at the top of the status tree — and structure
it correctly from birth. This verb is the encyclopedia for everything a focus is;
nothing else creates one.

## When to invoke

- The project commits to a new piece of work — a release, a feature, a campaign, a
  document set.
- A backlog item graduates: the commitment moment. The item informs the focus and is
  removed from the backlog in the same operation.
- NOT for adding work *under* an existing focus — that is [`add-stage`](./add-stage.verb.md)
  / [`add-phase`](./add-phase.verb.md).

## What this creates

Everything a focus *is* — shape rules, focus types and gates, claims, lifecycle,
file shapes, naming, decompose-late — lives in [`status-tree.md`](./status-tree.md);
read it with this card. This verb owns the *birth*: settle `focus_type` (build →
gate checklist; goal → vision), propose the claim, create folder + index + body,
register the `draft` row. Predecessor focuses are cited in `references`.

## The operation

1. **Confirm the verb** (golden rule): name `add-new-focus` and the target; the Human
   Lead confirms. Ensure a mounted full track whose claim covers `memory/status/`.
2. **Settle the design** with the Human Lead: name, `focus_type`, gate or vision,
   claim proposal. If graduating a backlog item, read it and carry its content in.
3. **Create the structure**: focus folder + spec index + focus body per the file
   shape above.
4. **Wire the parent**: add the folder to `status.index.md`'s Children.
5. **Register**: append the row to `status.stack.md` — link + `draft` + blank
   active-mark.
6. **If graduating**: delete the backlog item and its index entry (its content now
   lives in the focus — this is relocation, not loss).
7. **State what was created** and where the focus stands (draft, unmounted).

## Refusals

- No mounted full track, or the tree is outside the claim → refuse; the mount flow
  or the Human Lead resolves.
- A same-named focus exists (active or archived) → refuse; names are forever.
- Asked to create a stage/phase → route to `add-stage` / `add-phase`.

## Related

[`update-focus`](./update-focus.verb.md) amends the body ·
[`add-stage`](./add-stage.verb.md) decomposes ·
[`pause-focus`](./pause-focus.verb.md) / [`resume-focus`](./resume-focus.verb.md)
side-state · [`complete-focus`](./complete-focus.verb.md) the Done call ·
[`archive-focus`](./archive-focus.verb.md) relocates the finished subtree ·
[`review-focus-tree`](./review-focus-tree.verb.md) challenges what lingers ·
[`review-backlog`](../buffers/review-backlog.verb.md) proposes graduations.
