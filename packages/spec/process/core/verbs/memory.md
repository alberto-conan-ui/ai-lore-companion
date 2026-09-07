# Memory

Memory is the project's durable record — the persistent half of the Lore. Without it, every AI session starts from zero; with it, session 10 benefits from everything sessions 1 through 9 learned. The live half — status, tracks, focus — lives in [`status.md`](./status.md).

## The components

`.ai-lore-<project>/memory/` holds five persistent components plus the manifest (`workspace.yaml`). The **status tree** also lives under `memory/status/` on disk and is documented in [`status.md`](./status.md) — it carries the project's intent *and* its decomposition in one structure, absorbing what earlier versions kept as a separate **action tree**.

| Component          | Role                                                                                | Required |
| ------------------ | ----------------------------------------------------------------------------------- | -------- |
| **Tracks**         | Persistent workspaces — branch + claim + focus pointer (full tracks). The **home** track is always present; child tracks branch from home and merge back. | Yes      |
| **Journal**        | Continuity wire — session records and handovers.                                    | Yes      |
| **Blueprint**      | The authored, shareable artifacts — verbs, processes, contracts (each with a `core/` OOB set), tooling, and the mirror of the Payload's shape. | Yes      |
| **Save-points**    | Append-only ledger of committed milestones; its open `next` entry is the ack accumulator. | Yes      |
| **Notepad**        | The knowledge inbox — buffer, never destination.                                    | Yes (may be empty) |

Across every component, **emptiness is a valid state**. An empty notepad, a focus with no stages, a blueprint with only its `core/` sets — none are gaps. They mean the project has not yet committed to anything in that area.

## The components in brief

**Tracks** — `memory/tracks/` holds one record per open track. The track primitive is documented in [`tracks.md`](./tracks.md); the git arrangement underneath is in [`git.md`](./git.md).

**Journal** — one file per session in `journal/live/`, named `YYYY-MM-DD_NN.md`. Header (with `track` pointer in frontmatter), a body of what happened, and a **handover** to the next session as the last section. Journal files are **append-forward unconditionally** — never edited or deleted after they are written; they are the audit trail. Files roll from `live/` to `archive/` on a cadence the Human Lead triggers. The journal's index (`journal/live/live.index.md`) carries the **journal trail** — the newest-first list of session one-liners — as its single source; status does not duplicate it. Trackless sessions do not write journal entries.

**Blueprint** — the project's **authored, shareable artifacts**, in five branches (the first four carry a `core/` subfolder holding the out-of-the-box set, never edited in place — customization is shadow-by-name; see [`blueprint.md`](./blueprint/blueprint.md)):

- **`verbs/`** — the units of *what to do*, in family folders: one family context doc plus lean verb cards. Every write in AI-Lore is owned by one of them (the golden rule).
- **`processes/`** — orchestrations of verbs, Human-Lead-started: a release runbook, the grooming sweep, the start-work journey. Steps are verb references only.
- **`contracts/`** — inviolable, always-on rules: the four core contracts, plus evergreen rules the Payload must honour (*"all Payload files have front matter"*). Contracts accumulate across the resolution chain. Stated, cited by the verbs they govern, reinforced by hooks where checkable.
- **`tooling/`** — a registry of executable resources: core ships `ai-lore.py`; the project registers its own build scripts, generators, aux apps. One card per tool — path, invocation, purpose. Distinct from `processes/`: a process is a checklist the AI *executes by hand*; a tooling entry points at something that *executes for it*.
- **`mirror/`** — a description of the Payload's own shape, with a node where the project has something standing to say about an area. Most folders have no mirror node — emptiness is valid.

**Save-points** — `memory/save-points/` is an append-only ledger that never rolls and is never archived. The [`save-point`](./acknowledgement/save-point.verb.md) verb records a milestone here — date, description, lore commit ID, Payload commit ID. A save-point must stay reachable forever, which is why journal files (which roll) cannot hold it.

**Notepad** — `memory/notepad/`, the **knowledge inbox**: one file per note, captured with near-zero friction (`add-note`, light tracks included) and drained by `integrate-notepad`, where every note graduates into a contract, a mirror node, a tooling card, or a backlog item — or dies. Buffer, never destination. (v0.8 retired the knowledge tree: its reconciled branch was doing the blueprint's job with a vaguer contract; the notepad is what survives.)

## Drift and acknowledgement

Memory and Payload are both in git; the working-tree state on each track's branches is the project's drift signal. The mechanics — branches, the per-track drift check, the explicit `git -C` commands, what each verb commits — live in [`git.md`](./git.md). The methodology meaning: every Memory write is confirmed to the verb that owns it (the golden rule), and every commit through [`ack`](./acknowledgement/ack.verb.md), [`ack-and-continue`](./acknowledgement/ack-and-continue.verb.md), [`save-point`](./acknowledgement/save-point.verb.md), or [`close-session`](./bookends/close-session.verb.md) is the Human Lead's act, not the session's.

## Tree discipline

Structural conventions that keep every memory tree navigable:

- **Typed files.** Every file is `[name].[type].md` — the suffix says what it is without opening it.
- **Index per folder.** Every folder carries `[folder-name].index.md`. Its body follows a three-section grammar: **References** (context this folder depends on, up and sideways), **Siblings** (companion files in the same folder), **Children** (nodes below). An index is **pure wiring** — pointers and structure only. Instructions, history, status narrative, and prose belong in the typed body files, never in an index. (This is enforcement of a long-standing rule, hardened in v0.7: an index stuffed with narrative is the defect that bloated pre-v0.7 status pages.)
- **Single source.** Content lives in exactly one place; references point to it. All links point to `.md` files, never folders, using relative paths.
- **Append-forward.** Memory moves forward by adding new artifacts alongside old ones; journal entries are never edited after writing (the `journal-append-forward` contract). Every write goes through the verb that owns its surface.

## The file schema

Every Memory file carries **YAML frontmatter plus a per-type body structure** — parseable by a program, readable by a person, from the same file. Frontmatter does not replace the body; it makes the file machine-addressable while the body stays the human read.

**Common frontmatter — every Memory file:**

| Field | Value |
|---|---|
| `type` | `status-stack` · `track` · `focus` · `stage` · `phase` · `backlog-item` · `journal` · `verb` · `process` · `contract` · `tooling` · `blueprint` (mirror nodes) · `note` · `save-point` · `index` |
| `title` | human-readable title |
| `updated` | date last written (`YYYY-MM-DD`) |
| `references` | list of `{group, path}` — the reference header, as data |

**Per-type extension:**

| `type` | Extra frontmatter | Body |
|---|---|---|
| `status-stack` | — | **the focus stack** — one line per focus (link + status + active-mark); the registry body of `status.stack.md`. See [`status.md`](./status.md#statusstackmd--the-focus-registry) |
| `track` | `name`, `branch` (the branch name on both repos — record-authoritative, `main` for home in most projects), `claim`, `focus` (path, optional), `mounted_by` (session ID, optional) | claim detail, per-track journal trail, notes. **Only full tracks have a record.** |
| `focus` | `status`, `focus_type` (`build`/`goal`), `claim` (optional — path prefixes the focus owns when active on a track) | gate (build) or vision (goal), context, stack, active child pointer, journal trail. **L1 of the status tree.** |
| `stage` | `gated`, `status` | intent, gate, stack, active child pointer, journal trail. **L2 — a focus's child; may hold phases.** |
| `phase` | `gated`, `status` | intent, gate, stack (optional), journal trail. **L3 — a stage's child; a buildable step, no children.** |
| `backlog-item` | `status` (optional) | a future to-do, pre-focus; lives in `status/backlog/`; graduates into a focus via [`add-new-focus`](./status-tree/add-new-focus.verb.md). Not in `status.stack.md`. |
| `journal` | `date`, `session`, `track` (name), `focus` (path) | session body, handover |
| `verb` | `name`, `family`, `context`, `track`, `invoker`, `writes`, `contracts` | When to invoke · The operation · Refusals · Related (see [`blueprint.md`](./blueprint/blueprint.md)) |
| `process` | `name`, `invoker`, `composes` | When to run · The steps (verb references) · Done looks like |
| `contract` | `name`, `checkable` (`yes`/`judgement`), `cited_by` | the rule in one evaluable sentence · what honoring it looks like · what checks it |
| `tooling` | `name`, `path` | purpose · invocation · when to reach for it · what it must not be used for |
| `blueprint` | `branch` (`mirror`) | a mirror node — an area's description |
| `note` | `source` (optional) | the observation as captured, with enough context to survive to integration |
| `save-point` | `date`, `lore_commit`, `payload_commit` (sealed) or `status: open` (the accumulator) | milestone description above the accumulated rows (date · verb · track · branch · payload · summary); contract-override notes if any |
| `index` | — | References / Siblings / Children navigation grammar |

The schema lets a program parse Memory — for example a companion runtime (see [`bindings.md`](./bindings.md)). It never depends on one: a session with no companion reads raw frontmatter'd markdown directly.
