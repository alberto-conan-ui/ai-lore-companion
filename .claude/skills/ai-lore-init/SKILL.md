---
name: ai-lore-init
description: Bootstrap a folder into an AI-Lore project
---

# init

`init` turns a plain folder into an AI-Lore project. It runs once per project. The result is a fully working AI-Lore project: a Lore folder, a Memory git repo, the methodology placed at the right paths, the manifest pinned to a `core_version`, ready for the Human Lead to open the first focus.

`init` sets up a **project**. It does not bind AI-Lore to an engine — that is [`install`](./install.md), which runs once per engine, not per project. The two are separate layers: `install` embeds the methodology into the AI; `init` creates a project for it to work on.

## The operation

The steps below are sequential and load-bearing — each depends on what the previous one wrote.

1. **Choose the project name.** A filesystem-safe directory segment: `^[a-zA-Z0-9_][a-zA-Z0-9_-]*$`. Refuse if an enclosing ancestor already contains a `.ai-lore-<name>/` with the same name.
2. **Choose the project shape.** Two options:
   - **Default** — the Payload is what ships. Payload files sit at the project root directly; no `payload/` folder, no `publish/`. Most projects are this shape.
   - **Publishing** — the Payload lives in a `payload/` folder, paired with a `publish/` sibling that carries the curated deliverable (see [Publish](../project-structure.md#publish)). For projects whose deliverable is a folder elsewhere (Google Drive, a static site, a client folder, any path-addressable destination). The Human Lead names the `publish/` target — either a real local directory or a symlink to an external mount.
3. **Create the Lore folder** — `.ai-lore-<project_name>/`.
4. **Write the manifest** — `workspace.yaml` with `project_name` and `core_version`. If the project shape is Publishing, add the `publish:` block — `path` (defaults to `./publish`) and, if a symlink target is set, `target`.
5. **Place the methodology.** Two pieces:
   - **Root shim at `ai_readme.md`.** A two-line file the Human Lead points any AI at: a heading and the line *"This project uses AI-Lore. Read `.ai-lore-<project_name>/process/ai_readme.md` and follow its instructions."* The project name is substituted once at write time.
   - **Methodology copy under `.ai-lore-<project>/process/`.** Copy the pillars and verbs verbatim from the session's loaded methodology. No build, no template substitution, no transformation — the relative paths inside the pillars resolve cleanly because the layout is preserved.

   The root shim is the AI-agnostic handshake; the copied `process/` is the methodology in full.
6. **Shape the workshop and the publish target** — Publishing projects only.
   - **Create `<project>/payload/`** as an empty directory. This is the workshop; the Payload's contents live inside it.
   - **Create `<project>/publish/`.** If `publish.target` is set in `workspace.yaml`, create the symlink: `<project>/publish` → the target path. If only `publish.path` is set, create an empty directory there.
   - The publish process itself (`blueprint/processes/publish.process.md`) is **not** seeded by `init` — it is a project-specific recipe authored at first use; until it exists, the [`publish`](./publish.md) verb refuses.
7. **Initialise the Memory git repository** — `.ai-lore-<project>/memory/` is its own git repo, separate from the Payload. The Payload repo, if not already initialised, is the Project root. `init` adds both `.ai-lore-<project_name>/` and `publish/` to the Payload's `.gitignore` — the Lore folder and the Publish target are excluded from Payload tracking (the `publish/` entry is harmless on default-shape projects). See [`project-structure.md`](../project-structure.md#two-repositories).
8. **Lay the Memory skeleton** via [`write-lore`](./write-lore.md):
   - `status/status.index.md` with `posture: execute` (the default)
   - `journal/live/` and `journal/archive/`, each with its index
   - `blueprint/` with three children — `contracts/`, `processes/`, `mirror/` — each with its index
   - `save-points/` with its index

   The action tree and knowledge tree are optional and created when work first touches them.
9. **Seed the blueprint** with the Human Lead. Each branch is optional at seed time — emptiness is a valid state:
   - **Contracts** — the evergreen rules good Payload must honour, including any contracts that apply to `save-point` beyond the required git commit.
   - **Processes** — repeated procedures the project performs (release runbook, migration ritual, recurring checklist). Publishing projects will author `publish.process.md` here when they first publish; `init` does not pre-seed it.
   - **Mirror** — descriptions of Payload areas. Usually empty at init; populates as the Payload grows areas worth describing.
10. **Open the first focus** with the Human Lead, or leave the project headless until direction arrives. Choose its `focus_type` — `build` for concrete delivery against a gate, `goal` for directional work judged by the Human Lead.

`init` writes Memory only through `write-lore`. The methodology placement in step 5 and the publish-target shaping in step 6 are plain file operations, not Memory writes.
