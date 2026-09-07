---
name: ai-lore-complete-focus
description: "AI-Lore verb complete-focus — the Human Lead's Done call"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/complete-focus.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** status-tree · **track:** full · **invoker:** human-lead · **writes:** status.stack.md (row status → done); focus body (status, gate boxes, journal-trail close) · **contracts:** golden-rule

# complete-focus

Close a focus. **Human-Lead-only** — this is where human accountability lives at the
focus level. The session delivers, may judge the work complete, may prompt for the
call; only the Human Lead makes it.

## When to invoke

- A `build` focus: the Human Lead checks the gate and calls it.
- A `goal` focus: the session has delivered the work *and its opinionated critique*;
  the Human Lead judges by the vision.
- Overdue calls: a focus whose work shipped long ago and sits `in progress` (or was
  dishonestly parked `paused`) — the call was always the missing piece; make it.

## What the Done call is

By `focus_type`:

- **build** — walk the gate together, condition by condition, evidence in hand. The
  session presents each condition's state honestly (met / unmet / met-with-deviation,
  deviations named). The Human Lead flips the call — including consciously accepting
  deviations; accepted ones are recorded on the gate, not silently absorbed.
- **goal** — the session delivers its critique alongside the work: what the vision
  asked, where the work meets and misses it, what it would do differently. The Human
  Lead judges. The critique is mandatory — a goal closed without one is a rubber
  stamp.

The write: stack row → `done`; focus frontmatter `status: done`; remaining honest
gate boxes; a closing journal-trail line naming the call and its date. `done` focuses
stay in the stack and in place — relocation is
[`archive-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/archive-focus.verb.md), which this verb offers as its last step.

Open children gate the call: stages/phases not `done` are walked — closed via their
complete verbs where true, or explicitly waived by the Human Lead on the record.

## The operation

1. **Verify the invoker** — the Human Lead is making this call; a session reaching
   this step alone stops and prompts instead.
2. **Confirm the verb** (golden rule) and ensure a mounted full track whose claim
   covers the focus.
3. **Walk children**: any open stage/phase → close truthfully or record the waiver.
4. **Run the type's ritual**: gate walk (build) or critique + judgement (goal).
5. **Write the close**: row, frontmatter, gate, journal trail, `updated:`.
6. **Offer `archive-focus`** — now or later; note the choice.

## Refusals

- The invoker is the session's own judgement, not the Human Lead → refuse; prompt.
- Gate conditions unmet and not consciously waived → the call cannot land clean;
  report which.

## Related

[`complete-stage`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/complete-stage.verb.md) / [`complete-phase`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/complete-phase.verb.md)
the session-level closes · [`archive-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/archive-focus.verb.md) relocates ·
[`review-focus-tree`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/review-focus-tree.verb.md) hunts overdue calls ·
[`save-point`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/save-point.verb.md) when the close is milestone-worthy.


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
