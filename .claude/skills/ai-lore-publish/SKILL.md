---
name: ai-lore-publish
description: Sync the Payload's curated subset into `publish/` — the project's external deliverable. Publishing projects only.
---

# publish

`publish` syncs the Payload's curated subset into `publish/` — the project's external deliverable. The Payload is the workshop and source of truth; `publish/` is derived state that ships outward. The verb is the **only** path that writes into `publish/`; sessions in any posture treat `publish/` as off-limits otherwise.

## When the Human Lead invokes it

- When the curated deliverable should now reflect a piece of accumulated Payload work — a draft has stabilised, a section is signed off, a milestone is published.
- After a [`save-point`](./save-point.md), if the milestone's worth is meant to be visible at the external destination.
- When the previous `publish/` state is known stale, corrupted, or out of sync — the verb re-derives the deliverable from the Payload.

The session does not self-publish. Publishing is visible outward — to clients, to teammates watching the Drive folder, to the live site — and that visibility is the Human Lead's call.

## What every publish is

A run of the project's `publish.process.md` — the project-specific recipe in `<lore>/memory/blueprint/processes/`. The verb defines the goal (sync Payload → `publish/` per the recipe) and the safety rules (refuse when the project does not declare Publishing, no writes outside `publish/`). The recipe defines the how — what to include, what to exclude, how the sync runs, what curation rules fire before content lands.

Two preconditions are checked before any write:

- **Project declares Publishing.** `workspace.yaml` carries a `publish:` block (see [`project-structure.md`](../project-structure.md#publish)). On a default-shape project the verb refuses; nothing is written.
- **The recipe exists.** `<lore>/memory/blueprint/processes/publish.process.md` is the recipe. Without it the verb has no instructions; it refuses and asks the Human Lead to author the recipe first.

A publish that touches the Payload, the Lore, or anywhere outside `publish/` is a bug — the verb is one-way Payload → `publish/`, never the reverse, and the curation gate is what `publish.process.md` defines.

## The recipe — `publish.process.md`

Project-specific, lives in `<lore>/memory/blueprint/processes/`. Per `blueprint`'s shape (see [`memory.md`](../memory.md)), processes are repeated procedures the project performs — `publish.process.md` is exactly that.

The recipe names what crosses the curation gate and how: which Payload files, folders, or sections are included; how they are transformed (rename, flatten, strip frontmatter, etc.); how the sync into `publish/` is executed (rsync, file copy, write-through to a mount); what is *not* included (drafts, working notes, internal-only material). The recipe is the project's design decision; the verb runs it faithfully.

If the recipe asks for human judgement at a step — confirming a list of files, approving a transformation — the session pauses for the Human Lead.

## Derived state and the safety net

`publish/` is regenerable from the Payload at any time — re-run `publish` and the deliverable matches the current curated subset of Payload. The Payload's history (the git log of the Payload repo) is the durable record; `publish/` carries no history of its own. That asymmetry is the safety net: a wiped or corrupted `publish/` costs no work, only a re-publish.

If `publish/` is a symlink to an external mount (a Drive folder, a static-site source), the verb writes through the symlink — the external location is the storage and the local path is the access point. The verb does not manage the symlink itself; that is `init`'s job at project creation.
