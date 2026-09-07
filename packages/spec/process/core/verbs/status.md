# Status

Where the project stands and how its work decomposes. Status is the project's orientation hub — the entry point a session reads first — and in v0.7 it is **one structure**: the **status tree**.

Earlier versions split this in two: a status *registry* (`status/`) and a separate *action tree* (`action-tree/`) for decomposition, joined only by pointers. The two drifted independently — registries bloated into narrative, decomposition branches lingered after they were done. v0.7 merges them into a single tree with a forced, uniform shape, mutated only through a typed set of verbs.

This pillar covers the status tree (its shape and the three levels), the stack file that registers focuses, the focus chain, and the backlog. The workspace primitive underneath — tracks, their types, mounting, claims — lives in [`tracks.md`](./tracks.md); *what a session may touch* is governed by its **track type**, not by any posture or mode. The git arrangement lives in [`git.md`](./git.md). The rest of the persistent record — journal, blueprint, save-points, notepad — lives in [`memory.md`](./memory.md).

## The status tree

Lives at `memory/status/`. One tree, **three positional levels**:

```
focus            (L1) — a unit of intent
└── stage        (L2) — a batch of work toward the focus
    └── phase    (L3) — a buildable step under a stage
```

The shape is the discipline. Four rules, no exceptions:

- **Depth names the level.** A focus's direct children are *always* stages; a stage's direct children are *always* phases. The level is a pure function of position — there is no "what kind of node is this?" judgment to get wrong.
- **At most three deep.** You may stop early — a focus that needs no breakdown stays a focus; a stage that needs no breakdown stays a stage. But you never go past phase.
- **Never skip, never rename.** You cannot attach a phase directly under a focus, and you never call a level by another name. The names are fixed.
- **Every level that exists is a folder** carrying a standard index. Emptiness is valid: you materialize a stage folder only when there's a stage to hold, a phase folder only when there's a phase. "At most three" governs *depth*; "every level is a folder" governs *shape*.

The three node types:

- **focus** (L1) — one unit of intent. Every focus declares a **`focus_type`** (see [Focus](#focus) below). It carries a gate or a vision, context, a stack, an active-child pointer, an optional claim, and a journal trail.
- **stage** (L2) — a coherent batch of work toward the focus. The disciplined successor to the old action-tree container node.
- **phase** (L3) — a buildable step under a stage, each leaving the work in a runnable state.

Stage and phase bodies carry intent, gate, stack, and active-child pointer. The full per-type schema is in [`memory.md`](./memory.md#the-file-schema).

### The tree is verb-only

The status tree's **structure** — folders, indexes, hierarchy, and each focus's row in the stack file — is mutated **only through the status-tree family** ([`status-tree.md`](./status-tree/status-tree.md)): [`add-new-focus`](./status-tree/add-new-focus.verb.md) / [`add-stage`](./status-tree/add-stage.verb.md) / [`add-phase`](./status-tree/add-phase.verb.md) create nodes; [`complete-stage`](./status-tree/complete-stage.verb.md) / [`complete-phase`](./status-tree/complete-phase.verb.md) / [`complete-focus`](./status-tree/complete-focus.verb.md) close them; [`pause-focus`](./status-tree/pause-focus.verb.md) / [`resume-focus`](./status-tree/resume-focus.verb.md) move the side-state; [`archive-focus`](./status-tree/archive-focus.verb.md) relocates a finished subtree. Each verb carries a fixed step-list that preserves the four shape rules above, so the tree cannot rot into the free-for-all the action tree allowed.

Free-form structural editing is refused for *every* track — there is no free-hand path into the tree's structure. [`update-focus`](./status-tree/update-focus.verb.md) fills node **bodies** (the gate text, the context prose) under claim, but it can never create, move, or restructure nodes. Structure is the lifecycle verbs' job; substance is `update-focus`'s.

## status.stack.md — the focus registry

The one content file at the status-tree root, sibling to the root index. It is the project's at-a-glance answer to "what focuses exist, and where does each stand."

**One line per focus** (L1 only). It never mirrors stages or phases — the tree carries those, and every node owns its own status in its own file. Each line is **link + status + active-mark**, and nothing else: no description (that's in the focus's own file), no dates (those are in the journal), no notes.

| Field | What it holds |
|---|---|
| **link** | a link to the focus; the link text is its name |
| **status** | one word from the fixed enum (below) |
| **active-mark** | the track name working it, or blank |

**The status enum is fixed — four words:**

- **draft** — written/planned, not started.
- **paused** — started, then set aside.
- **in progress** — being worked. Review is *not* a separate state — a focus stays `in progress` while it awaits the Human Lead's Done call, right up until it's done. (This collapses the old "stuck in review forever" limbo.)
- **done** — the Human Lead has closed it. (Collapses the old done/achieved split.)

**The active-mark is per-track.** It holds the **track name** — `home`, or `track/<name>` — for a focus a track is currently mounted on; blank otherwise. This honors v0.6 parallel tracks (each track has its own active focus) and doubles as "is anyone on this right now." It is set by [`mount`](./tracks/mount-track.verb.md), not by hand.

The file is a **fixed table** by design: a table cell resists growing into a paragraph the way prose doesn't. That shape *is* the anti-bloat mechanism — the same logic as the strict indexes.

**What is no longer here.** Earlier `status.index.md` also carried a journal trail, a drift summary, and blueprint/save-point pointers. In v0.7 those leave status: the **journal trail** lives in the journal's own index ([`memory.md`](./memory.md) journal section) as its single source; **drift** is derived at [`orient`](./bookends/orient.verb.md) and stored nowhere; the **blueprint and save-point pointers** are pure wiring and live in the root index's References section. Status carries focus status, and nothing else.

## Focus

A **focus** is one unit of intent — the top level of the status tree. Every focus declares its **`focus_type`**:

- **`build`** — concrete delivery against an evaluable gate. The Human Lead checks the gate; the session may move work forward but only the Human Lead calls it `done`.
- **`goal`** — directional work against a subjective target. The Human Lead claims done by judgement; the session's job is to deliver *and* offer an opinionated critique alongside the work.

A `build` carries a list of gate conditions; a `goal` carries a vision the work aims at. Both carry context, stack, active-child pointer, an optional claim, and a journal trail.

A track may point at a focus to declare what work it is doing in that workspace. Focus and track are decoupled: focuses can exist without tracks (dormant), and tracks can exist without focuses (exploratory). See [`tracks.md`](./tracks.md).

## The chain

The focus chain *is* the orientation chain, walked over the status tree. When a session is mounted on a track, the chain starts at the track's active focus and walks down through stages and phases until there is nothing below. Each node adds exactly one thing its parent does not already say; no node repeats its parent.

**Status transitions and the Human Lead.** A focus moves `draft → in progress` on first work and `→ paused` / back via [`pause-focus`](./status-tree/pause-focus.verb.md) / [`resume-focus`](./status-tree/resume-focus.verb.md), but **only the Human Lead moves a focus to `done`** ([`complete-focus`](./status-tree/complete-focus.verb.md)).** This is where human accountability lives at the focus level — the session delivers and may judge the work complete, but the close is the Human Lead's act.

## Indexes

Every index in the status tree is an ordinary AI-Lore index — the standard `*.index.md` three-section grammar (References / Siblings / Children), applied strictly and uniformly, **no status-tree exception**. An index is **pure wiring**: pointers and structure, never instructions, history, or status narrative. The mess earlier versions suffered was the AI *violating* the index spec by stuffing narrative into it; the fix is enforcement, not a special index. The tree-discipline rules live in [`memory.md`](./memory.md#tree-discipline).

## Backlog

The **backlog** is where work that is *not yet a focus* is annotated — future to-dos, ideas, things to get to later. It lives at `memory/status/backlog/`, a sibling to the focus folders and `status.stack.md`, but it is **not part of the focus → stage → phase tree** and never appears in `status.stack.md` — the stack file registers *focuses*, and a backlog item is pre-focus.

The backlog is a **tree of folders and item files** — group similar items into folders as deep as the work wants. Unlike the status tree, it carries no positional-naming rule and no depth cap; the backlog is informal by nature. The one discipline that keeps it navigable is the universal one: **every folder carries a standard index** (pure wiring), and **every item is a typed md file**.

A backlog item **graduates into a focus** when the project commits to it: [`add-new-focus`](./status-tree/add-new-focus.verb.md) creates a focus informed by the item, and the item is then removed from the backlog. Until then it costs nothing and stays out of the focus registry.

The backlog is one of the three surfaces a **light track** may write — the others are the journal and the notepad (see [`tracks.md`](./tracks.md#track-types)). A backlog item is written through [`add-backlog-item`](./buffers/add-backlog-item.verb.md) and groomed by [`review-backlog`](./buffers/review-backlog.verb.md), not through the status-tree verbs — those own the focus tree's structure, not the backlog.
