# Migration — v0.6 → v0.6.1

The playbook the [`upgrade`](./verbs/upgrade.md) verb applies when moving a project from AI-Lore v0.6 to v0.6.1.

v0.6.1 is a **process polish** release. Four of its tweaks (ack/close-session decoupling, focus-carries-claim, the new Gemini binding, the chat marginalia carve-out) are spec-additive — re-placing the methodology and re-running `install-claude` / `install-gemini` is enough. The fifth tweak is a **rename**: the always-present track is now called **home** (file `tracks/home.track.md`), replacing `master` (file `tracks/master.md`). That is the only Memory edit this migration requires.

The branch arrangement is unchanged: home sits on `trunk`, child tracks sit on `track/<name>`. Only the track *name* and the *file name* change.

**Multi-version hops.** This playbook assumes the project is on v0.6. Projects on v0.5.1 or earlier chain through [`migration-from-v0.5.1.md`](./migration-from-v0.5.1.md) (and from there [`migration-from-v0.5.md`](./migration-from-v0.5.md) / [`migration-from-v0.4.md`](./migration-from-v0.4.md) if needed) to reach v0.6, then run this playbook.

## Kickstart — paste this into a fresh v0.6 session

Open a fresh AI session against your v0.6 project root and paste the block below. The session does not need to know anything about v0.6.1 in advance — the prompt fetches this playbook and the playbook drives the rest.

```
You are an AI-Lore v0.6 session being asked to upgrade this project to AI-Lore v0.6.1.

Fetch the v0.6 → v0.6.1 migration playbook from:
https://raw.githubusercontent.com/alberto-conan-ui/ai-sdlc/main/process/migration-from-v0.6.md

That file is your sole instruction set for this session. Read it in full before executing anything. Then run it step by step.

Rules of engagement:
- Every bash command and every file deletion must be proposed before it runs. Wait for Human Lead approval.
- Every Memory edit is propose-then-confirm. No bulk writes.
- Do not improvise. Do not skip steps. Do not invent steps.
- If a step's preconditions are not met, stop and report — do not work around.

The playbook is self-contained: every path, command, and decision the migration needs is in that file. Begin by fetching it.
```

## Before starting

**Both git repositories must be at HEAD with a clean working tree.** v0.6.1's rename touches `tracks/master.md` directly; a dirty tree at start risks losing context. If either repo is dirty, run [`ack`](./verbs/ack.md) or [`save-point`](./verbs/save-point.md) before starting. Verify with:

```
git -C <project> status
git -C <lore>/memory status
```

Both must report "nothing to commit, working tree clean." If not, stop and resolve.

Confirm `core_version` in `<lore>/workspace.yaml` reads `"0.6"`. If it reads something else, this is the wrong playbook.

## Steps

### 1. Re-place the methodology

Clone the v0.6.1 source to a scratch path:

```bash
git clone --depth 1 https://github.com/alberto-conan-ui/ai-sdlc /tmp/ai-lore-v0.6.1-src
```

Replace the vendored methodology:

```bash
rm -rf .ai-lore-<project>/process
cp -r /tmp/ai-lore-v0.6.1-src/process .ai-lore-<project>/process
rm -rf /tmp/ai-lore-v0.6.1-src
```

The root shim at `ai_readme.md` does not change.

### 2. Bump `core_version`

In `<lore>/workspace.yaml`:

- Set `core_version` to `"0.6.1"`.
- `project_name` is unchanged.
- The `publish:` block (if present) is unchanged.

### 3. Rename `tracks/master.md` → `tracks/home.track.md`

The file rename does two things at once: it changes the track's name (`master` → `home`) and aligns the filename with the `[name].[type].md` convention (memory.md tree discipline). The convention applies to every other typed file already; master was the lone exception.

Via [`write-lore`](./verbs/write-lore.md):

1. **Move the file.** `git -C <lore>/memory mv tracks/master.md tracks/home.track.md` — keeps the file's history under git.
2. **Update fields inside the file.** Open `tracks/home.track.md` and edit the frontmatter:
   - `name: master` → `name: home`
   - `title:` — update if it references "master" by name (e.g. `<project> — master` → `<project> — home`); a generic title is fine to leave.
   - Every other field (`branch: trunk`, `claim`, `posture`, `dials`, `focus`, `mounted_by`) is unchanged.
3. **Update the body.** Replace `master` with `home` where it appears as the track's name (claim description, any explanatory prose). Do not edit historical journal trail entries — those are append-forward audit and stay as written.

### 4. Update `tracks/tracks.index.md`

The index points to the renamed file:

- `Children:` entry — `master.md` → `home.track.md`.
- Any prose mentioning "master" as the track name — update to "home."

### 5. Update `status.index.md`

The open-tracks registry references the renamed track:

- The open-tracks list entry for `master` (with `mounted_by:`, focus pointer, etc.) renames to `home` and points at `tracks/home.track.md`.
- The drift summary's per-track label uses `home` instead of `master`.
- Anywhere else in the body that names the track — update to `home`.

Historical journal-trail lines below are **not** edited — they describe past sessions that ran against the master track at the time. The audit trail stays as written.

### 6. Update any blueprint contracts or processes that name the track

Search blueprint files for "master":

```bash
grep -rn -i "master" .ai-lore-<project>/memory/blueprint/
```

For each hit, judge: if the file references the track *as a verb constraint* ("save-points are master-only", "publish is master-only"), update to "home." If it references a historical decision or a quoted journal entry, leave it.

The vast majority of projects have no blueprint references to the track name; this step is a quick search and is often a no-op.

### 7. Commit both repos

Commit the migration as one acknowledgeable unit. The lore repo carries:

- The bumped `core_version` in `<lore>/workspace.yaml` (lives in the Lore folder, so this commit is on the lore repo).
- The renamed `tracks/home.track.md` (with the field edits).
- The updated `tracks/tracks.index.md`.
- The updated `status.index.md`.
- Any blueprint edits from step 6.

The Payload repo carries:

- For self-hosting projects (where the canonical methodology *is* the Payload, as in `ai-sdlc` itself), the re-placed `process/` files. For all other projects, the Payload repo has no changes — the migration is purely Memory.

Use a single focused commit message — for example: *"v0.6.1 migration: master → home rename, methodology re-placed."*

### 8. Re-run installs

If the project is installed against Claude (`install-claude` was run previously), re-run it to re-project the regenerated SKILLs:

```
Invoke the ai-lore-install skill with engine=claude.
```

Same for Gemini if installed (`install-gemini`). The install verbs are idempotent and overwrite only the AI-Lore-owned entries; user-owned settings are preserved.

## Verify

Run [`orient`](./verbs/orient.md) in a fresh session. It should:

- Read the methodology pillars at their v0.6.1 content (home, not master).
- Read `status.index.md` and find `home` as the only open track (assuming no children were open at migration).
- State the readout naming the track `home`.

Confirm that a normal write — for example invoking [`execute`](./verbs/execute.md) and editing a Payload file — triggers an auto-mount of home and lands the write on trunk.

Take a [`save-point`](./verbs/save-point.md) once the migration is verified. The milestone is "project is on v0.6.1, home is the only open track."

## What does not change

The branch arrangement (`trunk` for home, `track/<name>` for children), the verb set, the dials, the postures, the focus types, the two-repo arrangement, the append-forward journal rule, the claim model. The rename is a vocabulary shift — same primitive, better name.
