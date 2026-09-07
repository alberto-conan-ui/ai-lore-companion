# Migration — v0.5 → v0.5.1

The playbook the [`upgrade`](./verbs/upgrade.md) verb applies when moving a project from AI-Lore v0.5 to v0.5.1.

v0.5.1 is **additive.** The version-bump itself is trivial: re-place the methodology files and bump `core_version`. Existing v0.5 projects work unchanged as v0.5.1 projects.

The interesting part is the **publishing branch** at the end of the playbook — a project whose deliverable is a folder elsewhere (a Drive folder, a static site, a client directory) can opt into v0.5.1's new project shape: the Payload becomes the workshop, a new `publish/` sibling carries the curated deliverable, and the [`publish`](./verbs/publish.md) verb syncs between them. The branch is **optional** — most projects skip it.

**Multi-version hops.** This playbook assumes the project is on v0.5. Projects on v0.4 or earlier should chain through the intermediate migration first ([`migration-from-v0.4.md`](./migration-from-v0.4.md) for v0.4 projects) and then run this playbook. The [`upgrade`](./verbs/upgrade.md) verb runs one hop at a time.

## Kickstart — paste this into a fresh v0.5 session

Open a fresh AI session against your v0.5 project root and paste the block below. The session does not need to know anything about v0.5.1 in advance — the prompt fetches this playbook and the playbook drives the rest.

```
You are an AI-Lore v0.5 session being asked to upgrade this project to AI-Lore v0.5.1.

Fetch the v0.5 → v0.5.1 migration playbook from:
https://raw.githubusercontent.com/alberto-conan-ui/ai-sdlc/main/process/migration-from-v0.5.md

That file is your sole instruction set for this session. Read it in full before executing anything. Then run it step by step.

Rules of engagement:
- Every bash command and every file deletion must be proposed before it runs. Wait for Human Lead approval.
- Every Memory edit is propose-then-confirm. No bulk writes.
- Do not improvise. Do not skip steps. Do not invent steps.
- If a step's preconditions are not met, stop and report — do not work around.
- The publishing branch (Steps 3–7) is optional. The Human Lead chooses whether to run it.

The playbook is self-contained: every path, command, and decision the migration needs is in that file. Begin by fetching it.
```

## Before starting

Both git repositories should be at HEAD with a clean working tree. If either is dirty, run [`ack`](./verbs/ack.md) or [`save-point`](./verbs/save-point.md) before starting — the migration touches files, and a clean baseline is the return point.

Confirm `core_version` in `<lore>/workspace.yaml` reads `"0.5"`. If it reads something else, this is the wrong playbook.

## Steps

### 1. Re-place the methodology

Clone v0.5.1 source to a scratch path — this is what the copy below reads from:

```bash
git clone --depth 1 https://github.com/alberto-conan-ui/ai-sdlc /tmp/ai-lore-v0.5.1-src
```

Replace the vendored methodology:

```bash
rm -rf .ai-lore-<project>/process
cp -r /tmp/ai-lore-v0.5.1-src/process .ai-lore-<project>/process
rm -rf /tmp/ai-lore-v0.5.1-src
```

The root shim at `ai_readme.md` does not change — its two-line content is the same in v0.5.1.

### 2. Bump `core_version`

In `<lore>/workspace.yaml`:

- Set `core_version` to `"0.5.1"`.
- `project_name` is unchanged.
- Do **not** add the `publish:` block at this step — that is part of the optional publishing branch below.

Commit both repos with a focused message — the v0.5 → v0.5.1 version bump is one ack-worthy unit. This is the **minimum migration** — every v0.5 project does Steps 1 and 2. Projects not adopting Publishing stop here and skip to Verify.

---

The remaining steps apply **only** if the project is adopting the publishing shape. If the project's deliverable IS the Payload (a code repo, a spec, a documentation set), stop here. The version bump alone is the migration.

If the project's deliverable is a folder elsewhere — a Drive folder, a static site source, a client directory — continue.

### 3. Decide the publish target

Two decisions before any file is touched:

- **Path.** Where `publish/` lives at the project root. Default: `./publish`. Use the default unless there is a reason not to.
- **Target.** Optional — if `publish/` should be a symlink to an external mount, name the absolute target path (e.g. `~/Library/CloudStorage/GoogleDrive-<account>/My Drive/<folder>`, `/path/to/static-site/src`). If omitted, `publish/` is a real local directory.

A symlinked target is one-way Payload → external mount. See the Drive-symlink frictions noted in [`project-structure.md`](./project-structure.md#publish) before pointing at a Drive folder.

### 4. Move existing Payload contents into `payload/`

This is the structural step that turns a default-shape project into a Publishing project. The Payload's contents move from the project root into a new `payload/` folder, leaving room for `publish/` to sit beside it as a sibling.

Inventory the project root. Three categories of entries:

- **Move into `payload/`** — the user-authored Payload contents. Source files, documents, working materials, everything the project actually produces.
- **Stay at the project root** — the Lore folder (`.ai-lore-<project>/`), the shim (`ai_readme.md`), and Payload-repo metadata (`.git/`, `.gitignore`, `.gitattributes`, any other top-level dotfiles governing the repo).
- **Will be created in Step 5** — `publish/`. Does not exist yet.

Create the folder and move content with `git mv` so the Payload repo preserves history:

```bash
mkdir -p "<project>/payload"
# For each Payload entry at the project root:
git mv "<project>/<entry>" "<project>/payload/<entry>"
```

`git mv` updates the index in one operation; the commit that follows records the rename rather than a delete + add. Commit immediately after the moves land:

```bash
git -C "<project>" commit -m "v0.5.1 migration: move Payload into payload/"
```

Verify the project root holds only the four categories above (Lore, shim, repo metadata, the new `payload/`). Any straggler is either Payload content that should have moved, or something this migration is not accounting for — stop and resolve before continuing.

If the project used relative paths inside Payload that crossed the new boundary, hunt them down now. A find for references to the old root-level paths is the safety net:

```bash
grep -rn "(^|[^/])<old-toplevel-name>" "<project>/payload" | head -30
```

Adjust as needed. Most projects will not need this.

### 5. Create the `publish/` folder or symlink

If using a symlink target:

```bash
ln -s "<target>" "<project>/publish"
```

If using a real directory:

```bash
mkdir -p "<project>/publish"
```

Verify the path resolves:

```bash
ls -la <project>/publish
```

### 6. Add `publish/` to the Payload's `.gitignore`

In `<project>/.gitignore`, add a line:

```
publish/
```

If the entry is already present (e.g. from a previous experiment), leave it. The Payload repo must not track `publish/` — it is derived state, regenerable from `payload/`.

### 7. Add the `publish:` block to `workspace.yaml`

In `<lore>/workspace.yaml`, append:

```yaml
publish:
  path: ./publish
  target: <target-path-or-omit-if-real-directory>
```

Omit the `target:` line entirely if `publish/` is a real local directory.

### 8. Author `publish.process.md`

Create `<lore>/memory/blueprint/processes/publish.process.md` via [`write-lore`](./verbs/write-lore.md). This is the **recipe** — the project-specific instructions the [`publish`](./verbs/publish.md) verb runs.

The recipe names:

- **What's included** — which Payload files, folders, or sections cross the curation gate.
- **What's excluded** — drafts, working notes, internal-only material, anything that should stay in the workshop.
- **How sync runs** — rsync, file copy, write-through, etc. Whatever moves bytes from the included Payload subset into `publish/`.
- **Any transformations** — renames, flattening, frontmatter stripping, format conversions.
- **Curation rules** — gates that must hold before the publish proceeds (lint pass, link check, HL confirmation on a file list, etc.).

This is design work, not file-moving. The session helps the Human Lead think it through; the decisions are theirs.

Until `publish.process.md` exists, the [`publish`](./verbs/publish.md) verb refuses — no recipe, no publish.

## Verify

Run [`orient`](./verbs/orient.md) in a fresh session. It should walk the focus chain, read `workspace.yaml`'s new `core_version`, detect the project shape (`publish:` block present or absent), and state the current context cleanly.

For projects that adopted publishing shape, invoke [`publish`](./verbs/publish.md) once to test the recipe end-to-end. The first publish surfaces any gaps in `publish.process.md` (missing inclusions, over-eager exclusions, transformation bugs).

Take a [`save-point`](./verbs/save-point.md) once the migration is verified — the milestone is "project is on v0.5.1, shape settled."

## What does not change

The Memory model, the verb set (other than the new `publish`), the dials, the postures, the focus types, the file schema, the two-repo arrangement, the bookends — all unchanged. A reader who knew v0.5 Memory recognises v0.5.1 Memory immediately.
