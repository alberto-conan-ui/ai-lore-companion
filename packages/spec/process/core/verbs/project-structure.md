# Project structure

The foundation layer: the vocabulary every other document uses, the disk layout those documents assume, and the manifest that ties a Project to a version of the methodology.

## The terms

| Term | Definition |
|---|---|
| **Project** | The root directory where work happens. Has a name (`project_name`). Contains a Payload and a Lore. |
| **Payload** | The Project's working materials. Lives at the project root by default, or in `<project>/payload/` in Publishing projects. See [Publish](#publish). |
| **Lore** | The support system. Lives at `<project>/.ai-lore-<project_name>/`. |
| **Memory** | The Project's record of its own thinking — status, tracks, journal, blueprint (verbs, processes, contracts, tooling, mirror), notepad, save-points. Lives at `<lore>/memory/`. |
| **Track** | A persistent workspace within Memory. Comes in three **types** — trackless (read-only), light (journal + backlog only, not mounted), and full (mounted, branched, claimed). A full track is a branch + claim + focus pointer; sessions mount full tracks (one per session). The **home** track always exists on trunk; child tracks branch from home and merge back. Lives at `<memory>/tracks/`. See [`tracks.md`](./tracks.md). |
| **References** | Pointers to other AI-Lore projects on disk this project consults for context. Read-only by contract. Live at `<lore>/references/`. Optional. |
| **Parents** | Other AI-Lore projects this one *inherits* from: their `blueprint/` artifacts become invocable here through the resolution chain. Declared as an ordered `parents:` list in `workspace.yaml`. Optional. |
| **Publish** | Curated destination derived from the Payload — the deliverable for projects whose ship target is not the Payload itself. Lives at `<project>/publish/`, paired with `<project>/payload/`. See [Publish](#publish). |

The Payload is the point — where the work happens. The Lore exists to serve it; Memory is the part of the Lore the session reads and writes as work proceeds; Tracks are the persistent workspaces within Memory that sessions mount to do that work; References, when present, point outward at other projects this one looks at; Publish, when present, is the curated subset that ships outward — the Payload remains the source of truth.

## Disk layout

### The project root

A Project's shape is visible at its root. The default is the Payload at the project root, no publish target. A Project that declares **Publishing** in `workspace.yaml` puts the Payload in `payload/` and the curated deliverable in `publish/`, both at the project root.

```
Default                               Publishing
─────────────────────────             ─────────────────────────
my-project/                           my-project/
├── ai_readme.md                      ├── ai_readme.md
├── [Payload files]   ← Payload       ├── payload/          ← Payload (workshop)
├── out/              ← scratch        ├── publish/          ← Publish (deliverable)
└── .ai-lore-my-project/   ← Lore     ├── out/              ← scratch
                                      └── .ai-lore-my-project/   ← Lore
```

`out/` is the **disposable-scratch catch-all** — see [Scratch (`out/`)](#scratch-out) below. Like `publish/`, it sits at the project root and is in **no** git repo.

Code repositories, specs, documentation sets — anything whose deliverable is the Payload itself — fit the default and need no Publish target. Projects whose deliverable is a folder elsewhere (a Drive folder, a static-site source, a client directory) declare Publishing — the Payload moves into a `payload/` folder so the curated `publish/` sibling can sit cleanly beside it. The choice is set at [`init`](./lifecycle/init.verb.md); see [Publish](#publish) for the details.

### The Lore

The Lore folder is identical in both shapes — same `.ai-lore-<project_name>/` layout, same contents (Publishing projects additionally author `blueprint/processes/publish.process.md`, but the folder shape is the same).

```
.ai-lore-my-project/                  ← Lore  (folder name = .ai-lore-${project_name})
├── ai_readme.md                       the floor — the whole methodology a session carries before reaching an artifact
│
├── memory/                           ← Memory (its own git repo: memory/.git/)
│   ├── workspace.yaml                  manifest — project_name, core_version, publish:, parents:
│   ├── status/                         ← the status tree
│   │   ├── status.index.md               root index (pure wiring)
│   │   ├── status.stack.md               focus registry (link + status + active-mark)
│   │   ├── <focus>/                      L1 — focus folder (index + body)
│   │   │   └── <stage>/                    L2 — stage folder; <phase>/ at L3
│   │   └── archive/                      finished focuses (relocated by archive)
│   ├── tracks/                         tracks.index.md + home.track.md + per-child track records
│   ├── journal/                        live/ and archive/ (live.index.md carries the journal trail)
│   ├── blueprint/                      authored, shareable artifacts
│   │   ├── verbs/                        units of what to do — core/ (OOB, in family folders) + local shadows
│   │   ├── processes/                    orchestrations of verbs — core/ + local
│   │   ├── contracts/                    inviolable rules — core/ + local; accumulate
│   │   ├── tooling/                      registry of executables — core/ ships ai-lore.py
│   │   └── mirror/                       description of the Payload's shape
│   ├── notepad/                        the knowledge inbox — buffer, never destination
│   └── save-points/                    append-only milestone ledger; next.save-point.md is the open accumulator
│
└── references/                       ← References (optional)
    ├── references.index.md            registry
    └── <name>.md                      one file per referenced project
```

The methodology is placed into the project at [`init`](./lifecycle/init.verb.md) time, version-pinned by `core_version`. Two pieces (the `core-containment` contract):

- **A two-line shim at `ai_readme.md` (project root)** — the AI-agnostic entry point. Says *"This project uses AI-Lore. Read `.ai-lore-<project_name>/ai_readme.md` and follow its instructions."* Any AI can be pointed at it.
- **The floor at `.ai-lore-<project>/ai_readme.md`, and the core artifact set under `memory/blueprint/{verbs,processes,contracts,tooling}/core/`.** Nothing else is methodology. A project customizes by shadowing core artifacts by name outside `core/`, and inherits from parents the same way.

[`upgrade`](./lifecycle/upgrade.verb.md) replaces `core/` wholesale when the project moves to a new `core_version`. Engine bindings (see [`bindings.md`](./bindings.md)) layer engine-native delivery on top — they never replace this AI-agnostic baseline.

### The git arrangement

Memory (`<lore>/memory/`) and Payload (the Project root) are each their own git repository. They commit together as one unit through [`ack`](./acknowledgement/ack.verb.md), [`save-point`](./acknowledgement/save-point.verb.md), and the track-lifecycle verbs. Child tracks branch both repos together as `track/<name>`; home sits on its recorded trunk-role branch (`main`, typically) in both. The full git contract — `.gitignore` rules, the `<lore>/memory/.git/` location wart, the Lore remote, `publish/` in no repo, branch arrangement, drift signal mechanics — is covered in [`git.md`](./git.md).

## The Lore folder is uniquely named per project

The Lore folder is `.ai-lore-<project_name>/`, where `<project_name>` is the identifier from `workspace.yaml`. Every project has a different Lore folder name. AI sessions resolve paths by walking ancestors — two projects sharing a `.ai-lore/` name in the same ancestor chain would give ambiguous resolution. Unique names remove the ambiguity.

Project names must be filesystem-safe directory segments: `^[a-zA-Z0-9_][a-zA-Z0-9_-]*$`.

## workspace.yaml

Lives at `<lore>/memory/workspace.yaml` — inside the Memory repo, so `core_version` changes leave a git trace (v0.8 / F7). A manifest, not a configuration file — behaviour is determined by Memory and the methodology, not by switches here.

By default a Project carries only the two required fields:

```yaml
project_name: my-project       # the Project's name; also the Lore folder suffix
core_version: "0.8"            # pinned AI-Lore core version
```

A project that inherits shared discipline adds an ordered **`parents:`** list — paths to other AI-Lore project roots (relative to this project root, or absolute). Their `blueprint/` artifacts resolve here between core and project-local, declaration order breaking ties; contracts accumulate. Managed by [`add-parent`](./outward/add-parent.verb.md) / [`remove-parent`](./outward/remove-parent.verb.md):

```yaml
parents:
  - ../org-discipline
  - ../team-playbook
```

A **Publishing** project adds a `publish:` block — presence of the block is the declaration:

```yaml
project_name: my-project
core_version: "0.8"

publish:                       # presence declares a Publishing project (see Publish)
  path: ./publish              # where Publish lives at the project root
  target: ~/Drive/my-project   # optional — symlink target; init creates the symlink if set
```

`project_name` names the Project and is the last segment of the Lore folder name; `core_version` records which version of AI-Lore the project runs against. Both are required; the `publish:` block is not.

## References

A project may consult other AI-Lore projects for context — a sibling project doing similar work, a parent project, a reference implementation. References make this explicit: the project declares which other projects it looks at and why.

References live at `<lore>/references/` — sibling to `memory/`, not inside it. Memory is the project's own thinking; references are pointers outward. The folder is **optional** — a project with no references simply has no `references/` folder.

Each reference is one file, `references/<name>.md`, with frontmatter and a body:

| Field | Value |
|---|---|
| `type` | `reference` |
| `target_path` | the on-disk path to the referenced project's root (relative or absolute) |
| `purpose` | one line — why this project is referenced |
| `scope` | what part of the referenced project matters (all, a blueprint area, a KT branch, a Payload module) |

The body explains how to consult the reference — what to look at, when to look at it, any caveats. `references/references.index.md` lists what is registered.

References are **read-only by contract.** A session never writes through a reference into another project's Memory or Payload. Cross-project edits happen the other way around: open the other project explicitly and work there.

References are **link metadata only.** Insights this project draws from reading a referenced project belong in this project's notepad (then blueprint, via `integrate-notepad`), with `source` pointing back at the reference name. The reference file describes the link, not the project's interactions with it — otherwise it turns into a competing journal.

References are **not auto-loaded.** The session knows the folder exists from this document; it consults a reference when the work calls for cross-project context, not at every session open.

## Publish

A project whose deliverable is **not** the Payload itself — folders curated for delivery to Google Drive, a static site, a client folder, anywhere a path can point — declares a **Publish** target. The Publishing shape splits the project root into two sibling folders: `payload/` is the **workshop** where the work happens (drafts, sources, actuals); `publish/` is the **curated subset that ships**.

Publish is **optional.** A project with no `publish:` block in `workspace.yaml` is the default shape — the Payload lives at the project root directly, `init` and the methodology behave as before.

`payload/` and `publish/` sit at the project root, siblings to the Lore folder. The two folders carry different rules:

- **`payload/` is the Payload** — read–write by a full track within its claim, tracked by the Payload repo.
- **`publish/` is the deliverable** — written **only** by the [`publish`](./outward/publish.verb.md) verb. Writes outside the verb are refused regardless of track type. This keeps the curation gate honest.
- **`publish/` may be a real directory** (the publish process writes into it) **or a symlink to an external mount** (a Drive folder, a static-site source, a deploy directory). The choice is per-project — declared in `workspace.yaml` and shaped at [`init`](./lifecycle/init.verb.md).
- **The recipe** — what crosses from `payload/` to `publish/`, how the sync runs, what curation rules fire — lives in `<lore>/memory/blueprint/processes/publish.process.md`. The verb is platform-neutral; the recipe is project-specific.

`publish/` is **derived state.** `payload/` is the source of truth; `publish/` is regenerable from `payload/` at any time via the [`publish`](./outward/publish.verb.md) verb. That asymmetry is the safety net: if `publish/` is corrupted, lost, or out of sync, re-publish.

The `workspace.yaml` `publish:` block declares the path and optional symlink target — see [workspace.yaml](#workspaceyaml) above for the format. Presence of the block is the declaration; absence means a default Project, and the [`publish`](./outward/publish.verb.md) verb refuses.

## Scratch (`out/`)

`out/` is the **catch-all for writes AI-Lore must make but isn't meant to keep** — a generated report, a verb's working files, the harness `/plan` scratch file, anything transient. It sits at the project root, **symmetric to `publish/`**, and is present in every project shape.

The contrast with `publish/` is the point. Both live at the root and both are outside git — but `publish/` is a *deliverable* (curated, regenerable, the thing that ships), while `out/` is *disposable* (uncurated, transient, the thing nobody ships). One hard rule keeps `out/` from becoming the next mess:

- **Nothing in `out/` is ever a source of truth.** It is disposable by definition — safe to delete at any time, never referenced as authoritative, never the single copy of anything. A write whose result must survive does not belong in `out/`; it belongs in the Payload or Memory.

`out/` is **global, not per-track** — scratch needs no track-scoping, and a single folder avoids a per-track cleanup story. It is in **no git repo**: the Payload's `.gitignore` excludes it (written by [`init`](./lifecycle/init.verb.md), alongside `.ai-lore-<project>/` and `publish/`), and the lore repo only ever covered `memory/`. See [`git.md`](./git.md#what-git-does-not-own).
