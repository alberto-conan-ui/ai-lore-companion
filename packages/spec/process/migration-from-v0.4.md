# Migration — v0.4 → v0.5

The playbook the [`upgrade`](./verbs/upgrade.md) verb applies when moving a project from AI-Lore v0.4 to v0.5.

v0.5 changes the configuration and operation layer, not the Memory model in shape. The migration is mostly mechanical: add the file schema, reshape what the removed machinery left behind, point the project at the plain-text methodology.

## Kickstart — paste this into a fresh v0.4 session

v0.5 deletes the v0.4 Migrator stance and the entire `project-lifecycle/` flow that drove v0.4-era upgrades. A v0.4 project on disk has no path that reaches v0.5 on its own; the kickstart below is the path.

Copy the block into a fresh AI session opened against your v0.4 project root. The session does not need to know anything about v0.5 in advance — the prompt fetches this playbook and the playbook drives the rest.

```
You are an AI-Lore v0.4 session being asked to upgrade this project to AI-Lore v0.5.

Fetch the v0.4 → v0.5 migration playbook from:
https://raw.githubusercontent.com/alberto-conan-ui/ai-sdlc/main/process/migration-from-v0.4.md

That file is your sole instruction set for this session. Read it in full before executing anything. Then run it step by step from "Before starting" through Step 9 and the verification at the end.

Rules of engagement:
- Every bash command and every file deletion must be proposed before it runs. Wait for Human Lead approval.
- Every Memory edit is propose-then-confirm. No bulk writes.
- Do not improvise. Do not skip steps. Do not invent steps.
- If a step's preconditions are not met, stop and report — do not work around.
- v0.5 has no stances; you are operating as the upgrade session for this one task. Stay in that scope.

The playbook is self-contained: every path, command, and decision the migration needs is in that file. Begin by fetching it.
```

Once the session fetches the file, the rest of this document drives the migration end to end.

## Before starting

This playbook is applied by a session that has fetched the playbook (per Kickstart above) but does not yet have v0.5 methodology loaded — v0.5 source loads in Step 1. References below to v0.5 verbs (`save-point`, `write-lore`, etc.) describe what the session does *after* Step 1; the fallback here uses plain git commits because v0.5 verbs are not yet available.

Verify both git repositories exist:

```bash
git -C .ai-lore-<project>/memory rev-parse --is-inside-work-tree
git -C . rev-parse --is-inside-work-tree
```

Both must return `true`. The lore repo at `.ai-lore-<project>/memory/` was established by v0.4 bootstrap; the Payload repo is the project root. If either is missing, `git init` it before proceeding.

The working tree should be clean on both repos. Take a plain git commit of both repositories first (the v0.5 `save-point` verb is not available until Step 1 places the methodology). The migration deletes directories; the commit is the return point.

## Steps

### 1. Vendor v0.5, remove the build machinery, re-populate the methodology

First, clone v0.5 source to a scratch path — this is what the copy below reads from:

```bash
git clone --depth 1 https://github.com/alberto-conan-ui/ai-sdlc /tmp/ai-lore-v0.5-src
```

The v0.4 build system is gone in v0.5. Delete these directories from `.ai-lore-<project>/`:

- `upstream/` — the pinned source checkouts
- `dist/` — build scratch
- `process/` — the built, substituted copy of the methodology (it will be replaced with the v0.5 plain-text copy in a moment)

v0.5 has no build, no substitution, no templates. The methodology is plain text, placed into the project:

- Write a two-line shim at `ai_readme.md` (project root) — the AI-agnostic handshake. Content: *"This project uses AI-Lore. Read `.ai-lore-<project_name>/process/ai_readme.md` and follow its instructions."*
- Copy v0.5's pillars and verbs verbatim from the scratch clone into a fresh `.ai-lore-<project>/process/`:

```bash
cp -r /tmp/ai-lore-v0.5-src/process .ai-lore-<project>/process
rm -rf /tmp/ai-lore-v0.5-src
```

This is the same placement [`init`](./verbs/init.md) does at project creation. Nothing under `memory/` is touched by this step.

### 2. Update the manifest

In `workspace.yaml`:

- Remove the `plugin` field.
- Set `core_version` to `"0.5"`.

`project_name` is unchanged.

### 3. Add the file schema

Every file under `memory/` gains YAML frontmatter — `type`, `title`, `updated`, `references` — plus its per-type fields. The body structure is unchanged. All schema writes go through [`write-lore`](./verbs/write-lore.md).

**Journal session files are exempt.** The dated session files (`journal/live/YYYY-MM-DD_NN.md` and `journal/archive/YYYY-MM-DD_NN.md`) are append-forward unconditionally and keep their v0.4 form — no retroactive frontmatter. Journal *index* files (`journal/journal.index.md`, `journal/live/live.index.md`, `journal/archive/archive.index.md`) are not exempt — they are indexes like any other and gain frontmatter in this sweep.

Walk the Memory tree applying these substeps in order:

**3a. Inventory.** List every file under `memory/` except the dated journal session files. Classify each by type using the table in [`memory.md`](./memory.md) (`status`, `focus`, `at-node`, `blueprint`, `kt-node`, `save-point`, `index`).

**3b. Common frontmatter on every file.** Write the four common fields:

```yaml
---
type: <one of the type values>
title: <the file's H1 heading>
updated: <today, YYYY-MM-DD>
references:
  - group: <group label>
    path: <relative path>
---
```

**3c. Reference-header conversion.** The v0.4 reference-header markdown table becomes the `references` frontmatter field. Worked example — `memory/status/status.index.md` before:

```markdown
# my-project — Status

> **References**
>
> | Group  | File                                     |
> |--------|------------------------------------------|
> | Parent | [../memory.index.md](../memory.index.md) |

## Current state
...
```

After:

```markdown
---
type: index
title: my-project — Status
updated: 2026-05-25
references:
  - group: Parent
    path: ../memory.index.md
---

# my-project — Status

## Current state
...
```

The reference-header markdown block disappears (its content is now the `references` frontmatter). The H1 stays. The body stays.

**3d. Per-type extension.** Add the type-specific frontmatter from [`memory.md`](./memory.md)'s extension table. For example, a focus file additionally needs `status` and `focus_type`; a `save-point` needs `date`, `lore_commit`, `payload_commit`; a `kt-node` needs `branch`.

**3e. Verify.** Every file under `memory/` (except dated journal session files) has frontmatter:

```bash
find .ai-lore-<project>/memory -name '*.md' -not -name '20*_*.md' \
  -exec grep -L '^---' {} \;
```

The `-not -name '20*_*.md'` exclusion targets only dated journal session files (`YYYY-MM-DD_NN.md`); all index files including those inside `journal/` are checked.

Returns nothing if every file has frontmatter.

### 4. Replace mode with posture and dials

v0.5 records the session's working register — its posture and its dials — in `status/status.index.md`.

**Posture.** Replace the `mode` field with `posture` using this mapping:

| v0.4 mode  | v0.5 posture |
| ---------- | ------------ |
| Executing  | `execute`    |
| Planning   | `plan`       |
| Reflecting | `reshape`    |
| Salvaging  | `reshape`    |

The posture verbs ([`plan`](./verbs/plan.md), [`reshape`](./verbs/reshape.md), [`execute`](./verbs/execute.md)) write this field; each posture is a real constraint (`plan` and `reshape` make the Payload read-only).

**Dials.** Add a `dials` field with default values — Altitude `mid`, Commitment `neutral`. v0.5's dial axes are different from v0.4's (Altitude and Commitment, not Voice/Precision/Pushback/Ownership), so v0.4 stance dials do not translate. The Human Lead sets dials explicitly on first [`redial`](./verbs/redial.md).

Existing journal files keep their `Stance`/`Mode` headers (journals are append-forward); new journal files use the v0.5 header (`dials` and `posture` in place of stance and mode).

### 5. Add focus_type to existing focuses

Every focus file gains `focus_type` in its frontmatter. v0.5 distinguishes two shapes:

- `build` — concrete delivery against an evaluable gate.
- `goal` — directional work judged by the Human Lead.

Most v0.4 focuses are `build`. Set `focus_type: build` on each existing focus unless its gate is a prose vision rather than a checklist — in which case it is a `goal`.

### 6. Reshape the blueprint

v0.5's blueprint has three branches: `contracts/`, `processes/`, `mirror/`. The v0.4 blueprint was a single flat surface — its existing content moves into `contracts/`. Create the three child folders, each with its index; move existing blueprint content into `contracts/` unchanged. `processes/` and `mirror/` start empty.

### 7. Add the save-points ledger

Create `memory/save-points/` with its index:

```markdown
---
type: index
title: <project_name> — Save-points
updated: <today>
references:
  - group: Parent
    path: ../memory.index.md
---

# <project_name> — Save-points

The append-only ledger of committed milestones. Each save-point is a file at `<date>_<slug>.save-point.md` recorded by the [`save-point`](../../process/verbs/save-point.md) verb.

## Children

(none yet — no save-points have been recorded)
```

It starts empty — emptiness is a valid state. In v0.5, `save-point` is a hard git-commit contract — see [`save-point.md`](./verbs/save-point.md).

### 8. Optionally, install into an engine

v0.5 runs as plain text with no further setup. If you use Claude Code, run [`install-claude`](./verbs/install.md) to wire the verbs into Claude's native skill/hook machinery — see [`bindings.md`](./bindings.md) for what the install writes. Bindings for other engines are not yet documented; the plain-text path is the methodology in full and works on any AI.

### 9. Verify

Confirm no Memory file body references v0.4-only methodology paths. These paths do not exist in v0.5 and would 404 on next read:

```bash
grep -rE 'process/(tracker|project-lifecycle|operating-rules|stances|modes)' \
  .ai-lore-<project>/memory/ | grep -v '/journal/'
```

Returns nothing if Memory bodies are clean. (Journal bodies are exempt — they are append-forward and may reference v0.4 paths historically.) Update any matches to their v0.5 equivalents in [`memory.md`](./memory.md) and [`status.md`](./status.md), or remove the reference if the content was v0.4-only.

Then run [`orient`](./verbs/orient.md) in a fresh session. It should walk the focus chain cleanly, read the schema'd files without error, read the dials, posture, and focus type, detect that the working tree is clean (the migration has committed), and state the current context. Once verified, take a `save-point` to mark the completed migration.

## What does not change

The Memory model — status, focus, journal, blueprint, action tree, knowledge tree — keeps its shape, its focus chain, and its vocabulary. A reader who knew v0.4 Memory will recognise v0.5 Memory. The save-points ledger and the blueprint sub-structure are the structural additions.
