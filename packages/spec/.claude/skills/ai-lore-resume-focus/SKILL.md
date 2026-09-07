---
name: ai-lore-resume-focus
description: "AI-Lore verb resume-focus — pick a paused focus back up"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/resume-focus.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** status-tree · **track:** full · **writes:** status.stack.md (row status → in progress); focus body (journal-trail resume note) · **contracts:** golden-rule

# resume-focus

Bring a `paused` focus back to `in progress` — with a staleness check, because the
project moved while the focus slept.

## When to invoke

- The Human Lead points the track back at a paused focus.
- NOT for starting a `draft` focus — `draft → in progress` happens automatically on
  first work (stated in [`add-new-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/add-new-focus.verb.md) and
  [`mount-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/mount-track.verb.md)); there is no resume ceremony for a focus
  that never started.

## What resuming means

Read before you run: the pause note (the last journal-trail line) says where the
work stood and the first step back. Then check staleness — the gate against the
project as it *now* is: conditions may have been met by other work, invalidated by
amendments, or superseded entirely. A stale gate is amended via
[`update-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/update-focus.verb.md) (Human Lead confirming) before work
proceeds; resuming into a stale plan is how sessions build the wrong thing
confidently.

Status: stack row and focus frontmatter → `in progress`; a resume line on the
journal trail. If the track's claim was reshaped while the focus slept, reconcile via
[`update-track`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/tracks/update-track.verb.md).

## The operation

1. **Confirm the verb** (golden rule): name `resume-focus`; the Human Lead confirms.
   Ensure a mounted full track whose claim covers the focus.
2. **Read the pause note** and walk the focus chain to the tip.
3. **Staleness check**: gate vs current reality; propose amendments where the world
   moved; land them via `update-focus` first.
4. **Move the status**: row and frontmatter → `in progress`; resume line on the
   trail; `updated:`.
5. **State where the work resumes** — the first step, per the (possibly amended)
   plan.

## Refusals

- Focus is not `paused` → nothing to resume (a `draft` starts by working; a `done`
  reopens only by Human Lead decision through a new focus or an explicit amendment).
- Claim conflicts with an open child track → resolve claims first.

## Related

[`pause-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/pause-focus.verb.md) the way out ·
[`update-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/update-focus.verb.md) amends the stale gate ·
[`review-focus-tree`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/review-focus-tree.verb.md) proposes which pauses deserve
resuming at all.


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
