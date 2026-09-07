---
name: ai-lore-pause-focus
description: "AI-Lore verb pause-focus — set a focus aside, resumable"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/pause-focus.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** status-tree · **track:** full · **writes:** status.stack.md (row status → paused); focus body (journal-trail pause note) · **contracts:** golden-rule

# pause-focus

Set an in-progress focus aside deliberately: row → `paused`, with a pause note that
makes resumption cheap.

## When to invoke

- Priorities shift and another focus takes the track.
- The focus blocks on something external with no near-term unblock.
- NOT as a parking lot for finished-but-uncalled work — a focus whose work shipped
  and only awaits the Done call stays `in progress` (review lives inside
  `in progress`); prompt the Human Lead for
  [`complete-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/complete-focus.verb.md) instead. Parking shipped work in
  `paused` is the dishonesty that rots registries.

## What pausing means

`paused` is the side-state of the lifecycle (`draft` / `paused` / `in progress` /
`done`) — started, then set aside, resumable. The stack row is the single stored
status; the focus body's frontmatter mirrors it. The **pause note** is the real
work: one journal-trail line stating where the work stands, why it pauses, and the
first step on resume. A pause without a note is a future session's archaeology.

Pausing does not unmount, uncommit, or archive anything — the subtree stays in
place; drift on the track is still the ack family's business.

## The operation

1. **Confirm the verb** (golden rule): name `pause-focus` and the reason; the Human
   Lead confirms. Ensure a mounted full track whose claim covers the focus.
2. **Write the pause note** — standing state, reason, first-step-on-resume — as a
   journal-trail line on the focus body.
3. **Move the status**: stack row and focus frontmatter → `paused`; `updated:`.
4. **State the pause** and what the track does next.

## Refusals

- Focus is `draft` or `done` → nothing to pause.
- The real situation is "shipped, awaiting Done call" → refuse the park; prompt
  `complete-focus`.

## Related

[`resume-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/resume-focus.verb.md) the way back ·
[`complete-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/complete-focus.verb.md) the honest close for shipped work ·
[`review-focus-tree`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/review-focus-tree.verb.md) challenges pauses that quietly
became abandonment.


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
