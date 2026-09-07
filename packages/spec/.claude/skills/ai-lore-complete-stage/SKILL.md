---
name: ai-lore-complete-stage
description: "AI-Lore verb complete-stage — close a batch of work"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/complete-stage.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** status-tree · **track:** full · **writes:** stage body (status, gate checkboxes, journal trail); parent focus body (Stack / Active child pointer) · **contracts:** golden-rule

# complete-stage

Mark a stage's gate met and move the build forward: the stage goes `done`, the parent
focus's active child pointer advances to the next batch.

## When to invoke

- Every condition on the stage's gate is verifiably met.
- NOT for the focus itself — a focus's Done call is the Human-Lead-only
  [`complete-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/complete-focus.verb.md). A session **may** complete stages and
  phases: they are build checkpoints, not the accountability boundary.

## What completing a stage means

The gate is the test. Walk it condition by condition — each checkbox flips only on
evidence (a file that exists, a check that ran, an approval that was given), never on
optimism. A condition that cannot be verified yet keeps the stage open; a condition
that turned out wrong is amended first via [`update-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/update-focus.verb.md)
(with the discard guard and the Human Lead's eyes), then judged.

Completion rolls **up**, never sideways: the stage body's `status:` → `done`, its
gate boxes checked, a journal-trail line recording the close; then the parent focus
body's Stack/Active child pointer advance to the next stage (or note the focus is
gate-ready if this was the last). Open phases under the stage block completion —
close or recut them first.

## The operation

1. **Confirm the verb** (golden rule): name `complete-stage` and the stage; the Human
   Lead confirms. Ensure a mounted full track whose claim covers the focus.
2. **Check children**: every phase under the stage is `done` — or recut with the
   Human Lead.
3. **Walk the gate** condition by condition, evidence in hand. Any condition unmet →
   stop and say exactly which and why.
4. **Write the close**: gate boxes, `status: done`, `updated:`, journal-trail line.
5. **Advance the parent**: focus body's Active child pointer to the next stage in the
   Stack; journal-trail line on the focus where the milestone warrants it.
6. **State the close and what is now active.**

## Refusals

- Unmet or unverifiable gate conditions → refuse; report which.
- Open phases below → refuse; close or recut first.
- Asked to complete a focus → route to `complete-focus` (Human-Lead-only).

## Related

[`complete-phase`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/complete-phase.verb.md) the level below ·
[`add-stage`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/add-stage.verb.md) creates ·
[`complete-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/complete-focus.verb.md) the focus-level Done call ·
[`review-focus-tree`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/review-focus-tree.verb.md) catches stages that sit half-done.


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
