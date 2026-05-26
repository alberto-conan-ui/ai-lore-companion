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
2. **Create the Lore folder** — `.ai-lore-<project_name>/`.
3. **Write the manifest** — `workspace.yaml` with `project_name` and `core_version`.
4. **Place the methodology.** Two pieces:
   - **Root shim at `ai_readme.md`.** A two-line file the Human Lead points any AI at: a heading and the line *"This project uses AI-Lore. Read `.ai-lore-<project_name>/process/ai_readme.md` and follow its instructions."* The project name is substituted once at write time.
   - **Methodology copy under `.ai-lore-<project>/process/`.** Copy the pillars and verbs verbatim from the session's loaded methodology. No build, no template substitution, no transformation — the relative paths inside the pillars resolve cleanly because the layout is preserved.

   The root shim is the AI-agnostic handshake; the copied `process/` is the methodology in full.
5. **Initialise the Memory git repository** — `.ai-lore-<project>/memory/` is its own git repo, separate from the Payload. The Payload repo, if not already initialised, is the Project root. `init` also adds `.ai-lore-<project_name>/` to the Payload's `.gitignore` — the Lore folder is excluded from Payload tracking (see [`project-structure.md`](../project-structure.md#two-repositories)).
6. **Lay the Memory skeleton** via [`write-lore`](./write-lore.md):
   - `status/status.index.md` with `posture: execute` (the default)
   - `journal/live/` and `journal/archive/`, each with its index
   - `blueprint/` with three children — `contracts/`, `processes/`, `mirror/` — each with its index
   - `save-points/` with its index

   The action tree and knowledge tree are optional and created when work first touches them.
7. **Seed the blueprint** with the Human Lead. Each branch is optional at seed time — emptiness is a valid state:
   - **Contracts** — the evergreen rules good Payload must honour, including any contracts that apply to `save-point` beyond the required git commit.
   - **Processes** — repeated procedures the project performs (release runbook, migration ritual, recurring checklist).
   - **Mirror** — descriptions of Payload areas. Usually empty at init; populates as the Payload grows areas worth describing.
8. **Open the first focus** with the Human Lead, or leave the project headless until direction arrives. Choose its `focus_type` — `build` for concrete delivery against a gate, `goal` for directional work judged by the Human Lead.

`init` writes Memory only through `write-lore`. The methodology placement in step 4 is a plain file operation, not a Memory write.
