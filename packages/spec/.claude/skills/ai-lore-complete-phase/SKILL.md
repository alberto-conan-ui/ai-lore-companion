---
name: ai-lore-complete-phase
description: "AI-Lore verb complete-phase — close a buildable step"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/complete-phase.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** status-tree · **track:** full · **writes:** phase body (status, gate checkboxes, journal trail); parent stage body (Stack / Active child pointer) · **contracts:** golden-rule

# complete-phase

Mark a phase's gate met. The smallest close in the tree — the day-to-day "this step
is done, next" of a working build.

## When to invoke

- The phase's gate conditions are verifiably met **and the work is in a runnable
  state** — a phase's defining promise.
- NOT for stages or focuses — those are
  [`complete-stage`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/complete-stage.verb.md) and the Human-Lead-only
  [`complete-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/complete-focus.verb.md).

## What completing a phase means

Same discipline as every close, at the finest grain: gate conditions flip on
evidence; the runnable-state promise is itself a condition (a phase that closes with
the Payload broken was cut or closed wrong). The phase body takes `status: done`,
checked boxes, `updated:`, and a one-line journal-trail entry; the parent stage's
Stack/Active child pointer advance to the next phase, or the stage is flagged
gate-ready when this was the last.

A session may complete phases freely — they are its working checkpoints. Frequent
small closes beat one heroic one; pair with
[`ack-and-continue`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/ack-and-continue.verb.md) when a closed phase is a clean
commit chunk.

## The operation

1. **Confirm the verb** (golden rule): name `complete-phase` and the phase; the Human
   Lead confirms. Ensure a mounted full track whose claim covers the focus.
2. **Walk the gate** on evidence; verify the work runs / reads / holds together.
3. **Write the close**: boxes, `status: done`, `updated:`, journal-trail line.
4. **Advance the parent stage's** Active child pointer / flag gate-ready.
5. **State the close and what is next.**

## Refusals

- Unmet gate or non-runnable state → refuse; report which condition.
- Asked to complete a stage or focus → route up.

## Related

[`add-phase`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/add-phase.verb.md) creates ·
[`complete-stage`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/complete-stage.verb.md) the level above ·
[`ack-and-continue`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/ack-and-continue.verb.md) commits the chunk.


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
