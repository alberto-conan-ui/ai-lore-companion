# Migration playbook — v0.3 → v0.4

## Kickstart — paste this into a fresh v0.3 session

If you are upgrading a v0.3 project, copy the block below into a fresh AI session opened against your v0.3 project root. The session does not need to know anything about v0.4 in advance — the prompt fetches this playbook and the playbook drives the rest.

```
You are an AI-Lore v0.3 session being asked to upgrade this project to AI-Lore v0.4.

Fetch the v0.3 → v0.4 migration playbook from:
https://raw.githubusercontent.com/alberto-conan-ui/ai-sdlc/main/process/changelog/v0.4/migration-from-v0.3.md

That file is your sole instruction set for this session. Read it in full before executing anything. Then run it step by step from "Part 1 — Establish the v0.4 shell" through "Part 2 — Import the v0.3 Memory into the v0.4 shape" and the verification at the end.

Rules of engagement:
- Every bash command in the playbook must be proposed before it runs. Wait for Human Lead approval.
- Every Memory edit in Part 2 is propose-then-confirm, file by file. No bulk writes.
- Pause at every checkpoint marked "(pause)" in the playbook and do not proceed without explicit go-ahead from the Human Lead.
- Do not improvise. Do not skip steps. Do not invent steps.
- If a step's preconditions are not met, stop and report — do not work around.
- Your stance for this session is the v0.3 Auditor (the v0.3 migration stance). Stay in it.

The playbook is self-contained: every path, command, and decision the migration needs is in that file. Begin by fetching it.
```

Once the session fetches the file, the rest of this document drives the migration end to end.

---

Bespoke playbook for upgrading a project from AI-Lore v0.3 to v0.4. This is the version-specific counterpart to [`../../project-lifecycle/migration/migration.index.md`](../../project-lifecycle/migration/migration.index.md)'s generic flow, loaded by Migrator at Step 4 — but it can also be invoked directly from a v0.3 session via the Kickstart block above, since v0.3 has no Migrator stance and no `migration.index.md` flow to load it from.

**v0.3 → v0.4 is NOT a generic migration.** The two versions have such different shapes — different Lore folder name, different memory layout, no versioned upstream in v0.3, no `process/` dist in v0.3 — that the upgrade is closer to *re-bootstrap with memory import* than to a normal pin flip. Most of `migration.md`'s mechanical Part 1 does not apply. This playbook replaces Steps 1–5 for this specific upgrade and defines Part 2 as a guided memory import walk.

## What changes between v0.3 and v0.4

Read this section first. Every reshape downstream is driven by one of these diffs.

**Lore folder name.** v0.3 uses `.ai-lore/` uniformly; v0.4 uses `.ai-lore-<project_name>/` so two nested projects never collide on path resolution. The rename is load-bearing — every reference in the new v0.4 process substitutes `{lore_dir}` through this.

**Memory component layout.**

| Component        | v0.3 location                   | v0.4 location                 | Notes |
|------------------|---------------------------------|-------------------------------|-------|
| Status           | `memory/status/status.md`       | `memory/status/status.index.md` | Typed index file. Tracker primitive fields (Mode, Active focus, Journal trail, Focus stack). |
| Focus            | `memory/status/focus/<name>.md` | `memory/status/focus/<name>.focus.md` | Typed `.focus.md` suffix. Four tracker fields via `focus.template.md`. |
| Journal          | `memory/journal/live|archive/`  | `memory/journal/live|archive/` + `journal/journal.index.md`, `live/live.index.md`, `archive/archive.index.md` | Same file layout; new index files. |
| Blueprint        | `memory/knowledge-tree/blueprint/` (KT branch) | `memory/blueprint/` (top-level, peer of status/journal/KT) | **Promoted out of KT.** |
| Action tree      | `memory/action-tree/`           | `memory/action-tree/` + `action-tree.index.md` | Same layout; new index. |
| Knowledge tree   | `memory/knowledge-tree/` with branches `reconciled/ working/ notepad/ blueprint/` | `memory/knowledge-tree/` with branches `reconciled/ working/ notepad/` | Blueprint removed from KT. Each branch gets its own index. |

**Every folder needs a typed index file** under v0.4's tree-discipline — `[folder-name].index.md` — with a reference header. v0.3 was looser about this; v0.4 enforces it uniformly.

**Process and Upstream.** v0.3 projects reference the methodology by path (typically `methodology: ../` in `workspace.yaml` pointing at a cloned AI-Lore repo) and have no local `upstream/` or `process/` under the Lore folder. v0.4 projects vendor Upstream at `.ai-lore-<project_name>/upstream/core-<version>/` and build Process into `.ai-lore-<project_name>/process/`. **This migration creates the Upstream + Process trees for the first time** — you are not upgrading an existing build, you are establishing one.

**`workspace.yaml` schema.**

| Field              | v0.3                              | v0.4                                   |
|--------------------|-----------------------------------|----------------------------------------|
| `project_name`     | not present                       | **required**, load-bearing folder name |
| `core_version`     | string (e.g. `"0.3"`)             | string (e.g. `"v0.4"`, whatever `setup-project.sh` resolves from the changelog) |
| `plugin`           | name only                         | same                                   |
| `plugin_version`   | present                           | **removed** — plugins pin via core     |
| `plugin_readme`    | path to plugin ai_readme          | **removed** — Process composes it      |
| `code`, `memory`, `methodology` | path aliases         | **removed** — structure is fixed       |

**Modes vocabulary.** v0.3 has three modes (Planning, Executing, Reflecting). v0.4 adds a fourth: **Salvaging**, for sustained distrust during memory reshape. Existing `status.md` mode values carry forward unchanged; the new mode becomes available for future sessions.

**Stances.** v0.3 ships `roles/auditor.md` plus plugin stances under `process/plugins/<plugin>/roles/`. v0.4 consolidates under `process/stances/` with two protected infrastructure stances (Auditor, Migrator) plus plugin-composed stances — and introduces the four-dial system across Chat/Work domains. Existing stance files in v0.3 projects are not portable; after migration, sessions load v0.4 stances from the composed `process/stances/`.

**Project-root `ai_readme.md`.** v0.3 projects carry a handwritten ai_readme.md at the project root. v0.4 generates it from the ai-spine template and installs it by `mv` from `process/` at the end of Part 2. The v0.3 ai_readme.md is replaced.

## Part 1 — Establish the v0.4 shell

Mechanical, scripted where possible. Run from the project root.

### Step 1.1 — Pick a project_name and rename the Lore folder

Decide the `project_name`. It must match `^[a-zA-Z0-9_][a-zA-Z0-9_-]*$`, must not collide with a `.ai-lore-<name>/` folder in any enclosing ancestor, and it becomes the Lore folder suffix on disk. Then rename:

```bash
mv .ai-lore .ai-lore-<project_name>
```

Nothing downstream runs until this is done — every v0.4 path template assumes the new name.

### Step 1.2 — Vendor v0.4 Upstream

Clone v0.4 core next to the existing (v0.3) methodology pointer:

```bash
git clone --depth 1 https://github.com/alberto-conan-ui/ai-sdlc .ai-lore-<project_name>/upstream/core
```

This creates `.ai-lore-<project_name>/upstream/core/` as an unversioned staging path exactly the way bootstrap does. The next step pins it.

### Step 1.3 — Stage the old Memory out of the way

The new build is going to write `process/` and, once Part 2 starts, the playbook will walk old Memory into the new shape. Rename the v0.3 Memory folder aside so it does not collide with the v0.4 skeleton install:

```bash
mv .ai-lore-<project_name>/memory .ai-lore-<project_name>/memory.v03
```

`memory.v03/` is the read-only source for Part 2's import walk. It stays on disk until the Human Lead confirms the migration is complete and the import is verified.

### Step 1.4 — Write a v0.4 `workspace.yaml`

The v0.3 `workspace.yaml` is not compatible with v0.4's schema. Read the v0.3 file once for the `plugin` value, then overwrite:

```bash
cat > .ai-lore-<project_name>/workspace.yaml <<EOF
project_name: <project_name>
core_version: "v0.4"
plugin: <plugin>
EOF
```

Do **not** carry `plugin_version`, `plugin_readme`, `code`, `memory`, or `methodology` across — v0.4 ignores them and their presence indicates a botched migration.

### Step 1.5 — Run the v0.4 build

Rename the Upstream clone to its versioned path and run the build:

```bash
mv .ai-lore-<project_name>/upstream/core .ai-lore-<project_name>/upstream/core-v0.4
bash .ai-lore-<project_name>/upstream/core-v0.4/process/project-lifecycle/build/build-process.sh
```

The build composes through `dist/process/core-v0.4/` and promotes to `.ai-lore-<project_name>/process/`. From this moment on, the project's Process tree is v0.4-shaped.

### Step 1.6 — Run bootstrap Part 2 Steps 4–7 to create a fresh Memory tree

The v0.4 bootstrap Part 2 populates Memory from the skeleton. Run it against this project exactly as a new project would:

1. Read `.ai-lore-<project_name>/process/project-lifecycle/bootstrap/step2.md` and execute Step 4 (copy the memory skeleton) and Step 5 (seed the blueprint from the plugin).
2. **Do not execute Step 6.** Step 6 captures project context for a new project; this project has existing context in `memory.v03/` that Part 2 of this playbook will import.
3. Skip Step 7's ai_readme install and journal write until Part 2 of this playbook is complete.

After Step 5, `.ai-lore-<project_name>/memory/` contains a fresh v0.4 skeleton and a seeded blueprint. `memory.v03/` still contains the v0.3 contents. Both are on disk side by side, ready for the import walk.

### Part 1 checkpoint — confirm before proceeding **(pause)**

Before starting Part 2, confirm with the Human Lead:

- Lore folder renamed to `.ai-lore-<project_name>/`.
- v0.4 Upstream at `.ai-lore-<project_name>/upstream/core-v0.4/`.
- `workspace.yaml` rewritten with v0.4 schema.
- v0.4 `process/` composed and in place.
- v0.4 `memory/` freshly skeletoned + blueprint seeded.
- v0.3 `memory.v03/` preserved for import.

Abort here is straightforward: delete `.ai-lore-<project_name>/upstream/core-v0.4/`, `.ai-lore-<project_name>/process/`, `.ai-lore-<project_name>/memory/`, rename `memory.v03/` back to `memory/`, rename the Lore folder back to `.ai-lore/`, restore the old `workspace.yaml` from git. The rollback is scripted and harmless as long as the Human Lead has not started Part 2.

## Part 2 — Import the v0.3 Memory into the v0.4 shape

Interactive, Migrator-driven, file-by-file. Every write is proposed first; the Human Lead confirms before anything lands. Source is `memory.v03/`; destination is `memory/`.

This is not a bulk copy. Each piece of v0.3 Memory is examined and either:

- **Imported as-is** into the corresponding v0.4 location.
- **Reshaped** to match the v0.4 tracker/index/reference-header discipline before landing.
- **Dropped** if the v0.3 content is stale or already captured elsewhere.

Migrator drives the walk in the order below. The Human Lead decides on every file.

### Step 2.1 — Status

**v0.3 source:** `memory.v03/status/status.md`.
**v0.4 target:** `memory/status/status.index.md` (already exists as a skeleton).

Read the v0.3 `status.md`. Propose an edit to `status.index.md` that carries across:
- The current **Mode** (Planning / Executing / Reflecting — map literally; Salvaging did not exist in v0.3).
- The **Active focus** as a pointer to the focus file you will import in Step 2.2. Leave as `(headless)` for now if the v0.3 status was headless.
- Populate the **Journal trail** section with one line per recent session from `memory.v03/journal/live/`, newest first.
- Populate the **Focus stack** from the v0.3 focus stack, if any.

Do not carry across v0.3 fields that do not exist in v0.4 tracker shape. If `status.md` had fields beyond the tracker primitive, flag them and ask the Human Lead whether to preserve them elsewhere before dropping.

### Step 2.2 — Focus files

**v0.3 source:** `memory.v03/status/focus/<name>.md` (any file, active or archived).
**v0.4 target:** `memory/status/focus/<name>.focus.md` (typed suffix).

For each v0.3 focus file:

1. Propose creating a new v0.4 focus file at `memory/status/focus/<name>.focus.md` by copying `.ai-lore-<project_name>/upstream/core-v0.4/process/project-lifecycle/bootstrap/focus.template.md` and substituting the three placeholders with values drawn from the v0.3 file (`{focus_title}`, `{focus_gate}`, `{focus_context}`).
2. Preserve v0.3 focus prose that does not fit the four-field tracker shape by appending it as an additional section below the tracker fields — flag each such section to the Human Lead as a candidate for promotion to a KT node.
3. Closed/archived v0.3 focuses go to `memory/status/focus/archive/<name>.focus.md` — the archive folder exists in the v0.4 skeleton.
4. After all focuses are imported, update `memory/status/focus/focus.index.md`'s Children section to list the live ones.

### Step 2.3 — Journal

**v0.3 source:** `memory.v03/journal/live/*.md` and `memory.v03/journal/archive/*.md`.
**v0.4 target:** `memory/journal/live/` and `memory/journal/archive/`.

Journal files are append-forward unconditionally. **Copy every v0.3 journal file verbatim into the v0.4 journal tree** — do not rewrite, do not reformat, do not "update to new shape." The journal is the audit trail; preserving it is more important than conformance to v0.4's newer discipline.

After the copy:
- Update `memory/journal/live/live.index.md`'s Children section to list the imported live files.
- Update `memory/journal/archive/archive.index.md`'s Children section to list the imported archived files.
- If any v0.3 journal file lacks a header metadata table, flag it but do not edit the file.

### Step 2.4 — Blueprint **(reshape, not copy)**

**v0.3 source:** `memory.v03/knowledge-tree/blueprint/` (a KT branch in v0.3).
**v0.4 target:** `memory/blueprint/` (a top-level memory component in v0.4, already seeded from the plugin in Step 1.6).

This is the most meaningful reshape in the migration: blueprint is no longer a KT branch, it is a peer of status/journal/KT. Walk the v0.3 blueprint content file by file:

1. For each v0.3 blueprint file, propose merging its content into `memory/blueprint/` — either extending the plugin-seeded `blueprint.index.md` with the project's accumulated production rules, or creating additional files alongside it if the content warrants its own file.
2. Preserve contract clauses, frontier definitions, and payload-shape declarations exactly as they stood in v0.3 unless the Human Lead explicitly revises them.
3. After the reshape, verify `memory/blueprint/blueprint.index.md` has a reference header pointing at `../memory.index.md` and carries the project's title, not the plugin seed title.

### Step 2.5 — Knowledge tree

**v0.3 source:** `memory.v03/knowledge-tree/{reconciled,working,notepad}/`.
**v0.4 target:** `memory/knowledge-tree/{reconciled,working,notepad}/`.

Three branches carry across (blueprint was handled in 2.4):

1. Copy each branch verbatim, preserving the folder structure, spec files, and indexes.
2. After copy, verify each folder has its `[folder-name].index.md` with a reference header. If v0.3 indexes are missing, create stubs using the v0.4 skeleton's index shapes as templates.
3. Verify every imported file has a reference header. Add one where missing, pointing at the parent index.
4. If any reconciled insight is stale relative to v0.4's shape (e.g., "journal entries use the old metadata format"), flag it to the Human Lead but do not edit the insight — insights are retired, not rewritten.

### Step 2.6 — Action tree

**v0.3 source:** `memory.v03/action-tree/`.
**v0.4 target:** `memory/action-tree/`.

If the v0.3 project used the action tree:

1. Copy the AT verbatim, preserving node folders, leaf files, and the `action-tree.index.md` structure.
2. Verify every AT node file has a reference header.
3. If the plugin's AT vocabulary changed between v0.3 and v0.4 (e.g., SDLC's named types), flag any node whose `type` segment no longer matches and ask the Human Lead whether to rename.

If the v0.3 project did not use the AT, the skeleton's empty `action-tree/` is already in place — nothing to do.

### Step 2.7 — Install the project-root `ai_readme.md`

With Memory imported, run the last mechanical step from bootstrap Part 2 Step 7: `mv .ai-lore-<project_name>/process/ai_readme.md ai_readme.md`. Delete the v0.3 project-root `ai_readme.md` first — it was hand-written and is no longer the entry point.

### Step 2.8 — Verify

Run the bootstrap Part 2 Step 7 verification checklist against the imported project. Every item must pass:

- Every folder has its `[folder-name].index.md`.
- No `{project_name}` placeholder survives anywhere under `memory/`.
- Every file has a reference header (or is a journal file — journal files carry their metadata table in place of a reference header).
- Every focus file has the four tracker fields from `focus.template.md`.
- `status.index.md` points at the active focus and names the Journal trail.
- Link resolution across `memory/` and `process/` is clean.

Any failure here loops back to the relevant Step 2.x and fixes the specific node — do not proceed with a partial pass.

### Step 2.9 — Journal the migration

Write a migration session journal entry at `memory/journal/live/<date>_NN.md` recording:
- The v0.3 → v0.4 upgrade itself (date, old core_version, new core_version, project_name chosen).
- Any v0.3 content that was dropped or flagged during the walk.
- Any v0.3 content that was reshaped (what was merged where).
- Any open follow-ups for the next session.

Update `memory/status/status.index.md`'s Journal trail to include the migration session.

Append the new session file to `live/live.index.md`'s Children list.

### Step 2.10 — Close the Migrator session

Hand off exactly as bootstrap Part 2 does. Suggest the Human Lead close the session cleanly and open a fresh one against the project-root `ai_readme.md`. The first post-migration session on v0.4 is the real acceptance test — if it loads and orients cleanly against the imported Memory, the migration is done.

## After the migration

Keep `memory.v03/` on disk through at least the next working session. When the Human Lead is satisfied that nothing is missing from the import, delete it:

```bash
rm -rf .ai-lore-<project_name>/memory.v03
```

The v0.3 methodology pointer (`methodology: ../` in the old `workspace.yaml`, or a sibling `ai-sdlc/` clone the project referenced) is no longer load-bearing after migration — everything needed to operate is under `.ai-lore-<project_name>/`. The Human Lead may leave the old clone in place for reference or delete it.

## Rollback

Rollback after Part 1 is cheap: reverse Steps 1.1–1.5 as described in the Part 1 checkpoint.

Rollback after Part 2 has begun but before the ai_readme install (Step 2.7) is still cheap: the project-root `ai_readme.md` is still the v0.3 one, `memory.v03/` is still on disk, and `workspace.yaml` can be restored from git. The new v0.4 `memory/`, `upstream/core-v0.4/`, and `process/` tree can be deleted wholesale.

Rollback after Step 2.7 is expensive: the v0.3 `ai_readme.md` at the project root has been replaced. Restore it from git before doing anything else. Then revert the rest of Part 2 as above. Every edit Migrator made in Part 2 was proposed-then-confirmed, so the Human Lead has the audit trail in-session to walk back.

The safest place to stop a shaky migration is **before Step 1.5 runs the build**. Every step after that is recoverable but each one is more expensive than the last.
