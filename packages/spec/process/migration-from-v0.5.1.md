# Migration — v0.5.1 → v0.6

The playbook the [`upgrade`](./verbs/upgrade.md) verb applies when moving a project from AI-Lore v0.5.1 to v0.6.

v0.6 introduces **tracks** — persistent workspaces that wrap a branch and carry their own posture, dials, and focus pointer. Sessions mount tracks (one session per track at a time); master is always present; child tracks branch from master when contention requires it and merge back. The pillar set also grows from five to seven: two new pillars — [`tracks.md`](./tracks.md) (the workspace primitive) and [`git.md`](./git.md) (the git contract) — pull content out of `status.md`, `project-structure.md`, and `memory.md`. See [`tracks.md`](./tracks.md), [`status.md`](./status.md), and [`git.md`](./git.md) for the full model.

The migration is **Memory-only.** The Payload is not touched. State that v0.5.1 carried on `status.index.md` — `active_focus`, `posture`, `dials` — moves onto a new `tracks/master.md`; `status.index.md` restructures into a summary registry. The journal schema gains a `track` field, which the migration backfills for existing entries.

The single-session common case is unchanged after migration: master is the only open track, and every session mounts it automatically on first write. Projects that never open a child track behave exactly as they did under v0.5.1.

**Multi-version hops.** This playbook assumes the project is on v0.5.1. Projects on v0.5 or earlier should chain through the intermediate migrations first ([`migration-from-v0.5.md`](./migration-from-v0.5.md) for v0.5 projects, and from there [`migration-from-v0.4.md`](./migration-from-v0.4.md) if needed) and then run this playbook. The [`upgrade`](./verbs/upgrade.md) verb runs one hop at a time.

## Kickstart — paste this into a fresh v0.5.1 session

Open a fresh AI session against your v0.5.1 project root and paste the block below. The session does not need to know anything about v0.6 in advance — the prompt fetches this playbook and the playbook drives the rest.

```
You are an AI-Lore v0.5.1 session being asked to upgrade this project to AI-Lore v0.6.

Fetch the v0.5.1 → v0.6 migration playbook from:
https://raw.githubusercontent.com/alberto-conan-ui/ai-sdlc/main/process/migration-from-v0.5.1.md

That file is your sole instruction set for this session. Read it in full before executing anything. Then run it step by step.

Rules of engagement:
- Every bash command and every file deletion must be proposed before it runs. Wait for Human Lead approval.
- Every Memory edit is propose-then-confirm. No bulk writes.
- Do not improvise. Do not skip steps. Do not invent steps.
- If a step's preconditions are not met, stop and report — do not work around.

The playbook is self-contained: every path, command, and decision the migration needs is in that file. Begin by fetching it.
```

## Before starting

**Both git repositories must be at HEAD with a clean working tree.** v0.6's structural changes touch `status.index.md` directly; a dirty tree at start risks losing context. If either repo is dirty, run [`ack`](./verbs/ack.md) or [`save-point`](./verbs/save-point.md) before starting. Verify with:

```
git -C <project> status
git -C <lore>/memory status
```

Both must report "nothing to commit, working tree clean." If not, stop and resolve.

Confirm `core_version` in `<lore>/workspace.yaml` reads `"0.5.1"`. If it reads something else, this is the wrong playbook.

## Steps

### 1. Re-place the methodology

Clone the v0.6 source to a scratch path — this is what the copy below reads from:

```bash
git clone --depth 1 https://github.com/alberto-conan-ui/ai-sdlc /tmp/ai-lore-v0.6-src
```

Replace the vendored methodology:

```bash
rm -rf .ai-lore-<project>/process
cp -r /tmp/ai-lore-v0.6-src/process .ai-lore-<project>/process
rm -rf /tmp/ai-lore-v0.6-src
```

The root shim at `ai_readme.md` does not change — its two-line content is the same in v0.6.

### 2. Bump `core_version`

In `<lore>/workspace.yaml`:

- Set `core_version` to `"0.6"`.
- `project_name` is unchanged.
- The `publish:` block (if present from v0.5.1's Publishing shape) is unchanged.

### 3. Create the tracks/ folder and master record

Create `<lore>/memory/tracks/` and seed it with two files via [`write-lore`](./verbs/write-lore.md):

**`tracks/tracks.index.md`** — the index for the tracks folder. Standard index format; lists `master.md` as a child. References point up to `../memory.index.md` (or equivalent parent).

**`tracks/master.md`** — the master track record. Lift the live state from `status.index.md`'s frontmatter:

- `type: track`
- `title: master` (or a project-specific title — `<project> — master` matches the convention status used)
- `name: master`
- `branch: trunk`
- `claim: implicit` (master claims everything not claimed by an open child; child tracks do not yet exist)
- `posture:` — copy from the current value in `status.index.md`'s frontmatter (`execute` is the v0.5.1 default if nothing else is set)
- `dials:` — copy the current dials from `status.index.md`'s frontmatter
- `focus:` — copy the current `active_focus` path from `status.index.md`'s frontmatter
- `mounted_by:` — leave empty (no session is currently mounted by the upgrade-runner; the upgrade is itself a session, but the unmount happens at close)

Body: a brief claim description ("master — claims everything not claimed by an open child track"), no per-track journal trail at this stage (it can be derived from existing journal entries after the backfill in Step 5).

### 4. Restructure `status.index.md`

`status.index.md` becomes the **summary registry**. Remove the per-type frontmatter fields that moved to master in Step 3 (`active_focus`, `posture`, `dials`) — they are no longer on status.

The remaining frontmatter is the common-fields set: `type: status`, `title`, `updated`, `references`.

The body restructures into:

- **Open tracks** — a section listing master with its branch, focus pointer, posture, dials, and mounted-by. (At this point master is the only open track; the section will gain child tracks as they are opened.)
- **Save-points** — pointer to the ledger at `memory/save-points/`.
- **Blueprint** — pointer to `memory/blueprint/`.
- **Journal trail** — the existing newest-first list of journal entries, unchanged.
- **Drift** — per-track drift summary; at migration time, master is whatever the working trees report.
- **Children** — pointers to subfolders (focus, tracks, journal, blueprint, save-points), updated to include `tracks/`.

The v0.5.1 "Focus stack" section becomes derived information — every open track points at a focus (or none), and the stack reads from those pointers. The section can be removed from `status.index.md` once the tracks registry conveys the same information; many projects will simply keep a brief "in-flight focuses" summary derived from open tracks until a future polish pass strips it.

### 5. Journal frontmatter — going forward only (do **not** rewrite history)

From v0.6 on, a journal entry carries a `track` field. **New** entries get it; **existing** entries are left exactly as written. The journal is append-forward audit — past entries record what was true when they were written, and a project's history routinely spans several methodology versions (and several frontmatter schemas). Bulk-editing old entries to add a field they never had is the kind of history rewrite the append-forward rule exists to prevent, and it conflicts directly with later migrations (v0.6.1→v0.7 explicitly forbids editing past journal frontmatter).

So: **change nothing under `journal/live/` or `journal/archive/`.** A reader infers the track of an unlabelled historical entry from context — for a project that only ever ran the single always-present track, every unlabelled entry is that track by definition. The schema gains the field; the audit trail keeps its provenance.

> **Provenance.** Earlier drafts of this playbook told you to backfill `track: master` into every existing entry. That was wrong — it bent the append-forward rule and contradicted the v0.7 migration. Surfaced by the v0.7 RC dogfood; corrected here.

### 6. Commit both repos

Commit the migration as one acknowledgeable unit. The Lore repo carries:

- The new `tracks/` folder with `tracks.index.md` and `master.md`.
- The restructured `status.index.md`.
- The journal-frontmatter backfill across `live/` and `archive/`.

The Payload repo carries:

- The bumped `core_version` in `<lore>/workspace.yaml` (which lives in the Lore folder, so this commit is on the Lore repo).
- For self-hosting projects (where the canonical methodology *is* the Payload), the re-placed `process/` files. For all other projects, the Payload repo has no changes — the migration is purely Memory.

Use a single focused commit message — for example: *"v0.6 migration: tracks introduced, status restructured, journal backfilled."*

## Verify

Run [`orient`](./verbs/orient.md) in a fresh session. It should:

- Read the methodology pillars at their new v0.6 content.
- Read `status.index.md` as a registry and find master as the only open track.
- State the readout in v0.6 form — open tracks (master only), per-track drift, the focus chain from master's focus pointer.
- Start trackless and offer to mount (silent auto-mount on first write since only master is open).

Confirm that a normal write — for example invoking [`execute`](./verbs/execute.md) and editing a Payload file — triggers an auto-mount of master and lands the write on trunk, exactly as v0.5.1 behaviour did.

Take a [`save-point`](./verbs/save-point.md) once the migration is verified. The milestone is "project is on v0.6, master is the only open track, single-session behaviour preserved."

## What does not change

The Payload itself, the verb set's identities (other than the new `mount`/`merge`/`abandon`), the dials, the postures, the focus types, the file-schema's common-frontmatter fields, the two-repo arrangement, the append-forward journal rule. A reader who knew v0.5.1 Memory recognises v0.6 Memory immediately — the live register has moved from `status.index.md` into a `tracks/master.md` sibling, but every other Memory shape is the same.

## What does change in spirit

Parallelism becomes a real option. From this migration onward, a project can open a child track (via [`mount`](./verbs/mount.md)) when two sessions need to write disjoint parts of the project simultaneously — one in execute, another in plan, for instance. A project that never opens a child track pays no parallelism cost; the option is there for when it is needed.
