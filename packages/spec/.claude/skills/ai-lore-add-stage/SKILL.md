---
name: ai-lore-add-stage
description: "AI-Lore verb add-stage — decompose a focus into a batch of work"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/add-stage.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** status-tree · **track:** full · **writes:** status tree structure (new stage folder + index under a focus); stage body scaffold; parent focus index + body (Stack / Active child pointer) · **contracts:** golden-rule

# add-stage

Attach a **stage** — a coherent batch of work toward a focus — under an existing
focus. The build inner loop's structural add: when a focus's work reveals its
batches, each batch becomes a stage.

## When to invoke

- The build starts and the focus's gate splits into ordered chunks.
- Mid-build, the work reveals a batch the original cut missed.
- NOT for a new unit of intent (that is [`add-new-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/add-new-focus.verb.md))
  and NOT for a buildable step under a stage (that is
  [`add-phase`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/add-phase.verb.md)).

## What a stage is

Shape rules, file shapes, naming: [`status-tree.md`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/status-tree.md). What this
card adds: a good stage is a **batch with a boundary** — an intent one sentence can
carry, a gate the Human Lead can check, and an end. Order stages by build sequence,
not importance.

## The operation

1. **Confirm the verb** (golden rule): name `add-stage`, the parent focus, and the
   stage's intent; the Human Lead confirms. Ensure a mounted full track whose claim
   covers the focus.
2. **Verify the attach point** is a focus (L1). Under a stage → route to `add-phase`;
   under a phase → refuse, the tree ends at three.
3. **Create the structure**: stage folder + spec index + body scaffold (intent and
   gate drafted with the Human Lead; the rest minimal).
4. **Wire the parent**: the focus index's Children, and the focus body's Stack (in
   build order) and Active child pointer if this stage is now the active one.
5. **State what was created** and where it sits in the build order.

## Refusals

- Attach point is not a focus → route to the right level's verb.
- No mounted full track / outside claim → refuse.
- The "stage" is really a whole new intent → route to `add-new-focus`.

## Related

[`add-phase`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/add-phase.verb.md) the level below ·
[`complete-stage`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/complete-stage.verb.md) closes it ·
[`update-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/update-focus.verb.md) amends its body later ·
[`review-focus-tree`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/review-focus-tree.verb.md) challenges stages that linger.


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
