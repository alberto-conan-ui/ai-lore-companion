---
name: ai-lore-archive-focus
description: "AI-Lore verb archive-focus — relocate a finished focus's subtree"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/archive-focus.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** status-tree · **track:** full · **invoker:** human-lead · **writes:** status tree structure (subtree → status/archive/); status.stack.md (row removed); status.index.md + archive index (wiring) · **contracts:** golden-rule

# archive-focus

Relocate a `done` focus's whole subtree to `status/archive/`, keeping the working
tree lean while losing nothing. **Human-Lead-invoked** — archiving is a curation act.

## When to invoke

- After [`complete-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/complete-focus.verb.md) — immediately (its standing
  offer) or later in a batch.
- During grooming, when [`review-focus-tree`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/review-focus-tree.verb.md) surfaces
  `done` focuses still cluttering the live tree.

## What archiving means

**Relocation, not deletion** — the subtree moves intact (folders, indexes, bodies,
its whole history) from `status/<focus>/` to `status/archive/<focus>/`. Nothing is
rewritten inside; an archived focus reads exactly as it closed. This is why the
discard guard has no business here: the diff is a move.

The registry updates to match: the focus's row **leaves `status.stack.md`** (the
stack registers the working set; the archive index is the ledger of the finished),
the root `status.index.md` drops the child entry, and `archive/archive.index.md`
gains one — link plus its one-line epitaph. Only `done` focuses archive: an unfinished
subtree in the archive is a lie; get the Done call first (or, for work being
discarded rather than finished, say so — that is a different, guard-tripping
conversation via [`update-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/update-focus.verb.md)).

Archived focuses stay referenceable — links into the archive are stable and legal
(predecessor pointers on newer focuses, save-point entries, journal lines).

## The operation

1. **Verify the invoker** is the Human Lead; sessions prompt, never self-archive.
2. **Confirm the verb** (golden rule) and ensure a mounted full track whose claim
   covers `memory/status/`.
3. **Verify the focus is `done`** — otherwise route to `complete-focus` first.
4. **Move the subtree** to `status/archive/<focus>/`, contents untouched.
5. **Rewire**: stack row out, root index entry out, archive index entry in (with the
   epitaph line). Fix any inbound links the move broke — a stale link above the
   target means the write has not finished.
6. **State the move** and the tree's now-lighter working set.

## Refusals

- Focus not `done` → refuse; the Done call comes first.
- A same-named folder already in the archive → surface it; names are forever, so
  this signals an upstream naming defect to resolve with the Human Lead.

## Related

[`complete-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/complete-focus.verb.md) the gate into here ·
[`review-focus-tree`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/review-focus-tree.verb.md) proposes batches ·
[`add-new-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/add-new-focus.verb.md) may cite archived predecessors.


---

# Family context

# The status tree — family context

The shared knowledge of the status-tree family. Verb cards in this folder assume it.

## The tree

Lives at `memory/status/`. One tree, three positional levels:

```
focus            (L1) — a unit of intent
└── stage        (L2) — a batch of work toward the focus
    └── phase    (L3) — a buildable step under a stage
```

Four shape rules, no exceptions: **depth names the level** (a focus's children are
always stages, a stage's always phases — level is a pure function of position);
**at most three deep** (stop early freely; never go past phase); **never skip,
never rename**; **every level that exists is a folder** carrying a standard index.
Emptiness is valid everywhere — a focus that needs no breakdown stays bare.

**The tree's structure is verb-only.** Creating, moving, and finishing nodes happens
only through this family; free-hand structural editing is refused for every track.
Bodies (gate text, context prose) are [`update-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/update-focus.verb.md)'s;
structure is the add/complete/archive verbs'.

## Focus

One unit of intent. Every focus declares a **`focus_type`**:

- **`build`** — delivery against an evaluable **gate** (a checklist the Human Lead
  verifies). Sessions move work forward; only the Human Lead calls `done`.
- **`goal`** — directional work against a **vision**. The session delivers *and*
  critiques; the Human Lead judges.

A focus may carry a **`claim`** — the path prefixes it owns when a track works it
(proposed by the session, confirmed by the Human Lead; polishable later on the
focus or on the track record).

**Lifecycle** — `draft` / `paused` / `in progress` / `done` — stored on the focus's
row in `status.stack.md` (the registry: one row per focus, link + status +
active-mark, nothing else) and mirrored in the focus frontmatter; both move
together. `draft → in progress` happens automatically on first work; `paused` via
[`pause-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/pause-focus.verb.md); **`done` is Human-Lead-only**
([`complete-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/complete-focus.verb.md)). Review is not a state — a focus
awaiting its Done call stays `in progress`; parking shipped work in `paused` is the
dishonesty that rots registries.

## The file shapes

| Node | Frontmatter | Body sections |
|---|---|---|
| focus | `type: focus`, `title`, `updated`, `status`, `focus_type`, `claim` (opt), `references` | Gate/Vision · Context · Stack · Active child pointer · Journal trail |
| stage | `type: stage`, `title`, `updated`, `gated`, `status`, `references` | Intent · Gate · Stack · Active child pointer · Journal trail |
| phase | `type: phase`, `title`, `updated`, `gated`, `status`, `references` | Intent · Gate · Journal trail (Stack rare) |

Every folder's index is pure wiring (References / Siblings / Children) — no
narrative, ever. Bodies: gates are checklists, Context carries the why, Stacks list
children in work order, journal trails are newest-first one-liners.

## Naming, decomposition, closing

Kebab-case names after the intent; sequence-prefix where order matters
(`s1-inventory`, `p2-buffers`). **Decompose late** — materialize a stage when the
work is near, a phase when a stage's batch wants named steps; a speculative subtree
is rot deferred. A phase's defining promise: it closes in a **runnable state**.

Closing rolls **up**: gate boxes flip on evidence only; a node's close advances its
parent's Stack / Active child pointer; open children block a parent's close (close
truthfully or recut, or — at the focus level — the Human Lead waives on the
record). Sessions close stages and phases freely (build checkpoints); the focus
close is the accountability boundary and is the Human Lead's.

Finished focuses relocate whole to `status/archive/` via
[`archive-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/archive-focus.verb.md) — relocation, never deletion; the stack
row leaves the registry, the archive index gains the epitaph.
