---
name: ai-lore-upgrade
description: Migrate a project to a new core version
---

# upgrade

`upgrade` migrates a project from one AI-Lore core version to the next. It runs once per version bump. The project ends pinned at the new `core_version`, with the methodology re-placed on disk and any structural Memory changes the version requires already applied — the focus stack, journal, and standing commitments survive the migration intact.

## The operation

1. **Read the current pin.** `core_version` in `workspace.yaml` names the version the project runs against.
2. **Read the target version's migration notes** — the per-version description of what changed and what a project must do to move. The v0.4 → v0.5 notes are [`migration-from-v0.4.md`](../migration-from-v0.4.md).
3. **Re-populate the methodology.** Replace the project's `ai_readme.md` (root) and `.ai-lore-<project>/process/` with the target version's content. Plain file copy from the session's loaded methodology — same operation `init` performs at project creation.
4. **Apply the structural changes** to Memory via [`write-lore`](./write-lore.md) — new folders, schema changes, removed components. A structural rewrite that discards content trips `write-lore`'s discard guard; the Human Lead confirms each.
5. **Update the manifest** — set `core_version` to the target.
6. **Record the migration** in a journal entry, and take a [`save-point`](./save-point.md) once the upgrade is verified.

If the project was installed into an engine (see [`install`](./install.md)), re-run that install after upgrade so the engine-native delivery picks up the new methodology.

A version that changes Memory shape ships its own migration notes; `upgrade` applies them. The per-version migration content is authored alongside the version it migrates to.
