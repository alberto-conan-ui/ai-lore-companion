---
name: ai-lore-review-focus-tree
description: "AI-Lore verb review-focus-tree — challenge what lingers in the tree"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/review-focus-tree.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** status-tree · **track:** full · **home only:** true · **writes:** none directly — findings execute through the lifecycle verbs the Human Lead picks · **contracts:** golden-rule

# review-focus-tree

Walk the whole status tree, find what lingers, and interview the Human Lead about
each finding. A **grooming verb**: interrogative, home-only, and it writes nothing
itself — every accepted outcome executes through the fitting lifecycle verb.

## When to invoke

- Periodically — before a save-point, after a release, whenever the stack has grown
  rows nobody looks at.
- As part of the `groom` process (this verb is its first step).
- NOT as a bulk-archive hammer: findings are proposals; the Human Lead disposes.

## What the review hunts

Walk every focus — `draft`, `paused`, `in progress`, `done` — and its subtree, with
the journal trail and git history as evidence. The staleness patterns:

- **Overdue Done calls** — work shipped, focus still open. Classic tell: a `paused`
  focus whose gate conditions all verifiably hold (parking shipped work in `paused`
  is the known dishonesty). Proposal: [`complete-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/complete-focus.verb.md).
- **Abandoned pauses** — `paused` with no resume note honored across many sessions,
  the world moved past the gate. Proposal: resume with amendment, or complete/discard
  the honest way.
- **Stale drafts** — `draft` untouched since creation, superseded by later focuses.
  Proposal: fold into the backlog (a draft that lost commitment is pre-focus again)
  or delete the intent explicitly.
- **Half-closed subtrees** — `done` stages under open focuses that finished ages ago,
  open phases under `done`-looking stages. Proposal: the truthful `complete-*` calls.
- **Unarchived closures** — `done` focuses cluttering the live tree. Proposal:
  [`archive-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/archive-focus.verb.md) batch.
- **Pointer rot** — active-child pointers at closed children, stack rows disagreeing
  with frontmatter. Proposal: [`update-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/update-focus.verb.md) repairs.

## The interview

One finding at a time: the evidence (what the trail/git shows), the reading (what it
means), the proposal (which verb, what outcome), then the Human Lead's call —
accept, amend, or dismiss (a dismissal with a reason is recorded knowledge; note it
on the focus's trail via `update-focus` when it changes how the focus should be
read). Accepted outcomes execute immediately through their verbs, each under its own
golden-rule confirmation — the review composes verbs, it never bypasses them.

## The operation

1. **Confirm the verb** (golden rule); home-mounted (grooming curates shared state —
   child tracks don't groom).
2. **Walk the tree** — every stack row, every subtree, evidence from trails and git.
3. **Build the findings list**, ordered by decay (oldest dishonesty first).
4. **Interview** finding by finding; execute accepted outcomes via their verbs.
5. **Close with the delta**: rows moved, subtrees archived, calls made, dismissals
   recorded.

## Refusals

- Not home / not mounted → refuse (grooming is home work).
- Asked to auto-apply without the interview → refuse; the Human Lead disposes per
  finding.

## Related

Executes through: [`complete-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/complete-focus.verb.md) ·
[`archive-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/archive-focus.verb.md) · [`pause-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/pause-focus.verb.md) /
[`resume-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/resume-focus.verb.md) · [`update-focus`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/status-tree/update-focus.verb.md).
Siblings in grooming: [`review-backlog`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/review-backlog.verb.md) ·
[`integrate-notepad`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/integrate-notepad.verb.md) ·
[`review-mirror`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/review-mirror.verb.md) ·
[`review-references`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/review-references.verb.md). Composed by the `groom` process.


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
