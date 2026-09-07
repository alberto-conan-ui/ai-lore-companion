# Core Changelog

> **References**
>
> | Group | File |
> |---|---|
> | Memory | [../core/verbs/memory.md](../core/verbs/memory.md) |
> | Migration | [../migration-from-v0.7.md](../migration-from-v0.7.md) (latest; earlier playbooks beside it) |
> | Used by | [../core/verbs/lifecycle/upgrade.verb.md](../core/verbs/lifecycle/upgrade.verb.md) (version migration) |

This folder tracks the evolution of AI-Lore core. Each version is documented here — release notes for what changed and why. The changelog is the source of truth for `core_version`; the [`upgrade`](../core/verbs/lifecycle/upgrade.verb.md) verb reads the relevant entries when migrating a project between versions.

## Version layout

Three shapes coexist, by when the version shipped:

- **Flat file (v0.3 and earlier).** `v<version>.md` at the changelog root, release notes and migration steps inline. Preserved as historical record.
- **Folder (v0.4).** `v0.4/` contains `v0.4.index.md` plus a peer `migration-from-v0.3.md` playbook.
- **Flat file with root migration (v0.5 onwards).** `v<version>.md` holds the release notes; the migration playbook lives at the methodology root as `migration-from-<predecessor>.md`, where the `upgrade` verb reads it.

## Version entry format

Each release follows this structure: version number (major.minor.patch, so sort-V orders correctly), date, a one-paragraph summary, changes grouped by area, and a pointer to the migration playbook.

## Versions

| Version             | Status              | Date           | Summary                                                                                                                    |
| ------------------- | ------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [v0.1](./v0.1.md)   | Baseline            | Pre-2026-03-17 | Original process as shipped. Documented retroactively.                                                                     |
| [v0.2](./v0.2.md)   | Released            | 2026-03-18     | Redesign based on nine design principles from real-world usage.                                                            |
| [v0.2.1](./v0.2.1.md) | Released            | 2026-03-19     | Feedback-driven: interaction modes, session continuity, step node type, unified status.                                    |
| [v0.2.2](./v0.2.2.md) | Released            | 2026-03-21     | Migration hardening: hierarchical numbering, KT notepad, Reflecting mode, Developer removed.                               |
| [v0.2.5](./v0.2.5.md) | Released (internal) | 2026-03-31     | Process refinements: append-forward/reconciliation extracted, AT-is-intention, SDLC naming removed from core.              |
| [v0.2.7](./v0.2.7.md) | Released (internal) | 2026-04-06     | Core process docs: focus-based workflow, status entry point, KT three branches, optional AT, archetypes.                   |
| [v0.3](./v0.3.md)   | Released            | 2026-04-06     | Plugin architecture: slots/joins, mandatory plugins, independent versioning, `.ai-lore/` naming. Subsumes v0.2.5 and v0.2.7. |
| [v0.4](./v0.4/v0.4.index.md) | Released   | 2026-04-15     | Discovery rewrite: pillars, ai-spine, four modes, four-stance set, scripted bootstrap, plugin overlay, versioned Upstream + `dist/` staging. |
| [v0.5](./v0.5.md)   | Released            | 2026-05-26     | Subtraction: stances → dials, modes → postures, Status split from Memory, focus tracking primitive, references, methodology placed by `init`, bindings via `install`. |
| [v0.5.1](./v0.5.1.md) | Released          | 2026-05-26     | Publish shape: new `publish/` project-root category, `publish` verb syncs Payload → curated deliverable, `init` branches on project shape, write-discipline rule pins `publish/` to the verb alone. |
| [v0.6](./v0.6.md)   | Released            | 2026-05-27     | Parallelism pillar: tracks introduced as persistent workspaces (branch + claim + posture + dials + focus), master always-present and uniform with children, save-point as consolidation primitive, claim-disjoint write enforcement, three new verbs (`mount`/`merge`/`abandon`). Pillar set grows 5 → 7 with new `tracks.md` and `git.md`. Single-session common case preserved. |
| [v0.6.1](./v0.6.1.md) | Released          | 2026-05-28     | Process polish: `ack` decoupled from `close-session` (new `ack-and-continue` light sibling for mid-execution chunking, close-session commits its own writes); focuses gain optional `claim` field, home's claim becomes focus-derived; Gemini binding section added to `bindings.md` parallel to Claude; chat posture gains a narrow **marginalia** carve-out for HL-initiated Memory housekeeping (frontmatter, link repair, typos, index entries); always-present track renamed `master` → `home` and file moves from `tracks/master.md` to `tracks/home.track.md` (aligning with the `<name>.<type>.md` convention). |
| [v0.7](./v0.7.md)   | Released            | 2026-06-19     | The status tree: status and the action tree merge into one positional three-level tree (focus → stage → phase, folders, strict indexes); `status.index.md`'s narrative is replaced by a strict root index plus a lean `status.stack.md` (link + status + active-mark, enum `draft`/`paused`/`in progress`/`done`); the tree is mutated only through three new verbs (`grow`/`advance`/`archive`), `write-lore` fills bodies only. **Posture and dials removed** (chat/plan/reshape/execute, altitude/commitment, `redial`, presets) — **track type** is now the write-gate, with three types: trackless (read-only), **light** (journal + backlog only, not mounted, can't ack), and full (mounted, claimed). New `status/backlog/` for pre-focus to-dos. Lazy methodology loading (thin eager core + verb-declared prerequisites); `blueprint/tooling/` fourth branch; root-level `out/` disposable-scratch folder. |

| [v0.8](./v0.8.md)   | Released            | 2026-09-07     | Verb discipline: the golden rule (every write confirmed to a verb) as a contract; 52 entity-family verbs in nine families replace the v0.7 set; methodology dissolves into `blueprint/*/core/` (shadow-by-name, `parents:` inheritance, un-overridable floor); four core contracts; the ack ledger accumulator; process layer + `run-process`; grooming verbs; notepad replaces the knowledge tree; `ai-lore.py` tool. |

**Current version:** v0.8 (latest release; promoted from `v0.8-rc4` — four candidates, each failure a real playbook or tool defect caught by a fresh session on a disposable subject).
