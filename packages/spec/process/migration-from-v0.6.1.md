# Migration — v0.6.1 → v0.7

The playbook the [`upgrade`](./verbs/upgrade.md) verb applies when moving a project from AI-Lore v0.6.1 to v0.7.

v0.7 is the **status-tree** release — the largest Memory-shape change since v0.5. It merges the old status registry and the separate action tree into one **status tree** (focus → stage → phase), replaces the bloated `status.index.md` with a strict root index plus a lean `status.stack.md`, makes the tree mutable only through the new verbs (`grow` / `advance` / `archive`), and adds a `blueprint/tooling/` branch and a root-level `out/` scratch folder. Most of the migration is a one-time Memory reshape; the rest is spec-additive (re-place the methodology, re-run installs).

v0.7 also **removes posture and dials** (chat/plan/reshape/execute, altitude/commitment, `redial`, presets); what a session may touch is now governed by **track type** (trackless / light / full), and a new `status/backlog/` holds pre-focus to-dos.

**What does not move:** the **journal files** (`journal/live/*.md`) and the **save-points ledger** (`save-points/*`) are append-forward / append-only and are **never touched** by this migration. The two-repo git contract, the branch arrangement, the claim model, and focus types are unchanged.

**Multi-version hops.** This playbook assumes the project is on v0.6.1. Projects on v0.6 chain through [`migration-from-v0.6.md`](./migration-from-v0.6.md) first; earlier projects chain back through [`migration-from-v0.5.1.md`](./migration-from-v0.5.1.md) and its predecessors to reach v0.6.1, then run this.

## Kickstart — paste this into a fresh v0.6.1 session

```
You are an AI-Lore v0.6.1 session being asked to upgrade this project to AI-Lore v0.7.

Fetch the v0.6.1 → v0.7 migration playbook from:
https://raw.githubusercontent.com/alberto-conan-ui/ai-sdlc/main/process/migration-from-v0.6.1.md

That file is your sole instruction set for this session. Read it in full before executing anything. Then run it step by step.

Rules of engagement:
- Every bash command and every file move must be proposed before it runs. Wait for Human Lead approval.
- Every Memory edit is propose-then-confirm. No bulk writes.
- Do not improvise. Do not skip steps. Do not invent steps.
- If a step's preconditions are not met, stop and report — do not work around.

The playbook is self-contained: every path, command, and decision the migration needs is in that file. Begin by fetching it.
```

## Before starting

**Both git repositories must be at HEAD with a clean working tree.** This migration moves and rewrites Memory files; a dirty tree at start risks losing context. If either repo is dirty, run [`ack`](./verbs/ack.md) or [`save-point`](./verbs/save-point.md) first. Verify:

```
git -C <project> status
git -C <lore>/memory status
```

Both must report "nothing to commit, working tree clean." Confirm `core_version` in `<lore>/workspace.yaml` reads `"0.6.1"`. If it reads something else, this is the wrong playbook.

**Also confirm the Memory is actually v0.6.1-*shaped*, not just version-stamped.** `core_version` is a label; this playbook rewrites real structure and assumes the predecessor's structure is present. Verify the v0.6.1 shape before starting:

```
test -f <lore>/memory/tracks/home.track.md   # tracks exist (v0.6+), home-named (v0.6.1)
test -d <lore>/memory/status/focus           # flat focus files (pre-v0.7)
```

If `tracks/home.track.md` is missing, the project is **structurally behind its version stamp** — `core_version` advanced but the Memory was never migrated. Stop, run the intervening playbooks ([`migration-from-v0.5.1.md`](./migration-from-v0.5.1.md) → [`migration-from-v0.6.md`](./migration-from-v0.6.md)) to bring the *structure* to v0.6.1, then return here. Do **not** hand-patch the missing structure to push through — that is exactly the silent correction the release gate forbids. (Surfaced by the v0.7 RC dogfood, where the source project was stamped ahead of its actual Memory shape.)

## Steps

### 1. Re-place the methodology

Replace the vendored methodology with the v0.7 source. **Where the source comes from depends on the project:**

- **A normal downstream project** fetches the version it is moving to. During an RC that is the **RC tag**, not bare `main` (`main` still holds the prior release); after promotion it is `main`:

  ```bash
  git clone --depth 1 --branch <v0.7 tag or rc tag> https://github.com/alberto-conan-ui/ai-sdlc /tmp/ai-lore-v0.7-src
  rm -rf .ai-lore-<project>/process
  cp -r /tmp/ai-lore-v0.7-src/process .ai-lore-<project>/process
  rm -rf /tmp/ai-lore-v0.7-src
  ```

- **The source / self-hosting project** (`ai-sdlc` itself) does **not** clone — its own `process/` *is* the candidate. Sync the vendored copy from the local tree instead: `cp -r process .ai-lore-<project>/process` (or rely on `install` to re-project it).

- **Multi-hop chains** run each hop against *that hop's* version — never clone bare `main` for an intermediate hop, or you pull the latest methodology into a mid-chain step. Fetch each predecessor playbook and source from its matching tag.

The root shim at `ai_readme.md` does not change.

### 2. Bump `core_version`

In `<lore>/workspace.yaml`, set `core_version` to `"0.7"`. `project_name` and any `publish:` block are unchanged.

### 3. Build the status tree

This is the heart of the migration. Today's Memory has `status/focus/<name>.focus.md` (flat focus files) and a separate `action-tree/` for decomposition. v0.7 wants one tree at `status/`, with each focus a folder.

For each focus in `status/focus/`:

1. **Create the focus folder** `status/<focus-name>/` with a spec index `<focus-name>.index.md` (pure wiring) and move the focus body to `<focus-name>.focus.md` inside it.
2. **Map its action-tree decomposition into stages/phases.** If the focus had an `action-tree/<focus>/` subtree, its container nodes become **stages** (L2 folders) and their leaves become **phases** (L3). Depth names the level — a node directly under the focus is a stage; a node under a stage is a phase. Collapse anything deeper than three levels (rare) by folding the surplus into the phase body.
3. **Convert node frontmatter** — `type: at-node` becomes `type: stage` or `type: phase` by position; drop `node_kind` (position now determines it); keep `gated` and `status`.

The old `status/focus/archive/` and `action-tree/archive/` map to `status/archive/`.

### 4. Write `status.stack.md`

Create `status/status.stack.md` — the focus registry. One row per focus (L1 only): a link to the focus, its status (map the old focus `status` to the v0.7 enum — `draft` / `paused` / `in progress` / `done`; **fold the old `review` into `in progress`**, and the old `achieved` into `done`), and an active-mark (the track name working it, or blank — for a single-track project this is `home` on the active focus, blank otherwise).

### 5. Rewrite `status.index.md` as a strict root index

The old `status.index.md` carried a focus stack, journal trail, drift summary, and pointers — all narrative. Replace it with a **standard index** (References / Siblings / Children, pure wiring): Children point to the focus folders and `status.stack.md`; References point to the blueprint and save-points. Strip all narrative — it lives in the tree, the journal, and the stack file now.

### 6. Relocate the journal trail

Move the newest-first session-trail list out of the old `status.index.md` into the journal index `journal/live/live.index.md` (its single source). Do not edit the journal *files* themselves.

### 7. Retire `action-tree/`

After step 3 has absorbed its content into the status tree, remove the now-empty `action-tree/` folder. (Its content is preserved inside the status tree; verify before deleting.)

### 8. Add the tooling branch, the backlog, and the scratch folder

- Create `blueprint/tooling/` with its index (empty is fine).
- Create `status/backlog/` with its index (empty is fine) — the pre-focus to-do tree.
- Create `out/` at the project root, and add `out/` to the Payload's `.gitignore` (next to the existing `.ai-lore-<project>/` and `publish/` entries).

### 8b. Strip posture and dials

v0.7 removes posture and dials. Apply across Memory:

- **`tracks/home.track.md`** (and any child track record) — delete the `posture` and `dials` frontmatter fields. Tracks are now typed (home and children are **full** tracks); there is no posture/dials field.
- **`status.index.md` / `status.stack.md`** — ensure no `posture`/`dials`/`active_focus` frontmatter remains (these were the v0.5.1-shape live register; v0.7's registry is `status.stack.md`'s focus rows).
- **Journal files** are append-forward — **do not edit** past entries even though their frontmatter carried `dials`/`posture`. Only *new* journal entries omit the fields.
- If the project was installed, the `chat`/`plan`/`reshape`/`execute`/`redial` skills (Claude) or TOML commands (Gemini) are dropped at re-install (step 10) — they no longer exist as verbs.

### 9. Commit both repos

Commit the migration as one acknowledgeable unit. The lore repo carries the bumped `core_version`, the rebuilt `status/` tree, `status.stack.md`, the rewritten `status.index.md`, the relocated journal trail, the removed `action-tree/`, and the new `blueprint/tooling/`. The Payload repo carries the `.gitignore` `out/` entry (and, for self-hosting projects only, the re-placed `process/`). Use one focused message — e.g. *"v0.7 migration: status tree, stack file, tooling branch, out/."*

### 10. Re-run installs

If installed, re-run `install-claude` / `install-gemini` to re-project the regenerated verbs (including the new `grow` / `advance` / `archive` skills) and the thin-core load model.

## Verify

Run [`orient`](./verbs/orient.md) in a fresh session. It should load only the thin core, read `status.stack.md` for the focus registry, walk the status tree (focus → stage → phase) for the active focus, and state the readout. Confirm that adding a node works through [`grow`](./verbs/grow.md), that a status move works through [`advance`](./verbs/advance.md), and that the old `action-tree/` is gone. Take a [`save-point`](./verbs/save-point.md) once verified — the milestone is "project is on v0.7, status tree built."

## What does not change

The journal files and save-points ledger (untouched), the branch arrangement (`trunk` for home, `track/<name>` for children), the claim model (still disjoint-by-prefix for full tracks), focus types, the two-repo arrangement, the append-forward journal rule. (Posture and dials are *removed*, not preserved — see step 8b.)
