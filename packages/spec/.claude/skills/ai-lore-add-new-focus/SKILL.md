---
name: ai-lore-add-new-focus
description: "AI-Lore verb add-new-focus — open a unit of intent"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/add-new-focus.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** status-tree · **track:** full · **writes:** status tree structure (new focus folder + index); focus body; status.stack.md (new row) · **contracts:** golden-rule

# add-new-focus

Open a **focus** — one unit of intent at the top of the status tree — and structure
it correctly from birth. This verb is the encyclopedia for everything a focus is;
nothing else creates one.

## When to invoke

- The project commits to a new piece of work — a release, a feature, a campaign, a
  document set.
- A backlog item graduates: the commitment moment. The item informs the focus and is
  removed from the backlog in the same operation.
- NOT for adding work *under* an existing focus — that is [`add-stage`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/add-stage.verb.md)
  / [`add-phase`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/add-phase.verb.md).

## What this creates

Everything a focus *is* — shape rules, focus types and gates, claims, lifecycle,
file shapes, naming, decompose-late — lives in [`status-tree.md`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/status-tree.md);
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

[`update-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/update-focus.verb.md) amends the body ·
[`add-stage`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/add-stage.verb.md) decomposes ·
[`pause-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/pause-focus.verb.md) / [`resume-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/resume-focus.verb.md)
side-state · [`complete-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/complete-focus.verb.md) the Done call ·
[`archive-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/archive-focus.verb.md) relocates the finished subtree ·
[`review-focus-tree`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/review-focus-tree.verb.md) challenges what lingers ·
[`review-backlog`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/review-backlog.verb.md) proposes graduations.


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
