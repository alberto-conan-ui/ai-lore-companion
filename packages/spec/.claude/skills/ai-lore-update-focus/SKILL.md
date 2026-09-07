---
name: ai-lore-update-focus
description: "AI-Lore verb update-focus — amend bodies in a focus's subtree"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/update-focus.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** status-tree · **track:** full · **writes:** focus / stage / phase bodies (one focus's subtree) · **contracts:** golden-rule

# update-focus

Amend the **bodies** of one focus's subtree — the gate text, the vision, the context,
the claim, a stage's intent, a phase's gate, journal-trail lines. This is the
design-of-record verb: locked decisions, amendments, and re-cuts land here.

## When to invoke

- The Human Lead amends the design: a new decision, an amendment, a gate re-cut, a
  claim adjustment.
- A stage/phase body needs its intent or gate sharpened as the work teaches.
- NOT for structure — creating, moving, or removing nodes is
  [`add-stage`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/add-stage.verb.md) / [`add-phase`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/add-phase.verb.md) /
  [`archive-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/archive-focus.verb.md) work. Never both in one act.

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
  ([`pause-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/pause-focus.verb.md), [`complete-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/complete-focus.verb.md), …).

## Related

[`add-new-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/add-new-focus.verb.md) creates ·
[`add-stage`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/add-stage.verb.md) / [`add-phase`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/add-phase.verb.md) decompose ·
[`complete-stage`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/complete-stage.verb.md) / [`complete-phase`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/complete-phase.verb.md)
close children · [`review-focus-tree`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/review-focus-tree.verb.md) challenges staleness.


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
