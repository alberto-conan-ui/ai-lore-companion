# MVP — architecture and design specification

Written 2026-09-18 for the focus "MVP — work this project as an AI-Lore 1.0 Space". Status: draft, not reviewed by the Human Lead. It was written by an architect agent during the unattended run the Human Lead asked for on 2026-09-18, and developer and tester agents follow it during that run.

Rulings of the orchestrating session for the unattended run. These are the session's choices, not the Human Lead's, and each can be reversed by the Human Lead.

- The four proposals of section 4 are followed as recommended there. The Human Lead delegated them to the architect on 2026-09-18; they stay labelled as proposals until the Human Lead accepts them.
- Question 1 of section 10.1 is answered with option (b): check scripts and skeleton generators are Python 3 using the standard library only, and the machine check adds `python3`. Reason: the project contract "TypeScript everywhere under `packages/`" names `.js`, `.cjs` and `.mjs` files as violations, changing a contract is outside what the Human Lead confirmed for this run, and `packages/spec` already holds `ai-lore.py`. Where sections 5.5, 5.6 or 9 describe the scripts as JavaScript run through the companion's binary, read Python 3 instead. Every hook the install step generates calls its script by absolute path.
- Questions 2 to 18 of section 10.1 are answered with the defaults given there. On question 18: the existing `packages/spec/process/core/tooling/ai-lore.py` is taken as showing that Lore content shipped by `packages/spec` is not a source file in the contract's sense. This reading is the session's, and the Human Lead is asked to confirm it or change the contract.
- Corrections to section 8.1 found while building M2.1. `AI_LORE_TEST=1` is set when a fixture builder is called, not when its module loads, and the fixture builders are not exported from the core package's main barrel, so the app never loads them in production. The permission to reach live GitHub is not an environment variable of the app: a variable would be inherited by every terminal the app starts. Phase M3.5 passes it as the option `allowLiveGitHub` to the app's own command runner (`createAppCommandRunner` in `main/space/live-github.ts`, reached as `deps.space.runner`), and the app removes the variable if it inherits one.
- The app's typecheck, found while building M3.5: `npm run typecheck -w @ai-lore-companion/app` compiled nothing before this run. It now requires no error in main, preload and shared code, and compares the renderer's errors with `packages/app/typecheck-baseline.json`, which holds 34 errors that v0.8 files had before the run. A new error fails the check, and the baseline can only be lowered.
- The starting state was measured again after that repair: the end-to-end test at line 86 of `cockpit.spec.ts` passes; the three at lines 394, 916 and 1298 still fail.
- The starting state of the repository at commit `4b9d085`, measured on 2026-09-18 before any phase: core build and app typecheck pass. Lint fails on the formatting of `packages/app/src/renderer/src/components/BranchIndicators.tsx`. One core test fails, `chain reader resolves this project's own tracker chain` in `packages/core/test/chain.test.ts`. Four end-to-end tests fail in `packages/app/test/cockpit.spec.ts`, at lines 86, 394, 916 and 1298. A phase is not held to these six failures, does not fix them unless its own files are involved, and reports any other failure as its own.
- The Human Lead confirmed writing into the project for this run through the verbs `mount-track`, `add-phase`, `update-focus`, `complete-phase`, `complete-stage`, `update-payload`, `ack-and-continue` and `close-session`. The sentence in section 9 about needing confirmation is met by that instruction.

How to read this document. A statement with no label is taken from the focus, its stage files, the product document, the critique note, or the code. A statement labelled **Proposal** is this document's own design and has no standing until the Human Lead accepts it. A statement labelled **Proposal — awaiting Human Lead** is one of the decisions the product document lists as open. A statement labelled **Finding** is something read in the code or the Lore that differs from what the source documents assume. Where the focus and the product document differ, the focus governs.

Sources read: the focus file and its eight stage files; the product document (`memory/notepad/ai-lore-1.0-spec.note.md`); the critique note with the Human Lead's twenty decisions; the project's contracts and mirror under `memory/blueprint/`; the notes on renderer imports and on the settings file overwritten by two builds; the code under `packages/`.

---

## 1. Context and scope

### 1.1 What the MVP is

The Human Lead works in AI-Lore v0.8 every day. The 1.0 product document describes a whole product. The MVP is the least of 1.0 that a day's work on this project can be done in, plus the migration of this project from v0.8 onto it. The focus's gate has nine conditions: Detects, Migrates, Installs, Guards, Works, Shows, Reviews, The switch, and Non-goals are recorded. Section 8.6 maps each condition to a test or a manual check.

### 1.2 What exists today

The repository is an npm-workspaces monorepo with three packages.

| Package | What it is | Build and tests |
|---|---|---|
| `packages/core` (`@ai-lore-companion/core`) | Node-only library, ES modules, no Electron import (enforced by a Biome rule). Reads a v0.5.1 to v0.7 project: locating the Lore folder, the focus chain, frontmatter, git changes against a baseline, diff arguments, the directory tree, the chokidar watcher, the path index and fuzzy search, settings, engines, apps, save-points. | `tsc` to `dist/`. Tests are `node:test`, compiled by `tsc -p tsconfig.test.json` to `dist-test/`, one flat file per module under `test/`. |
| `packages/app` (`@ai-lore-companion/app`) | The Electron app. `src/main` (main process, 45 files), `src/preload` (one file, which builds the bridge from the IPC contract when it loads), `src/renderer` (React 18, zustand, dockview, xterm, CodeMirror 6, Radix dialog and popover, cmdk), `src/shared` (IPC types and contract, baseline logic). Built with electron-vite 2 and Vite 5; Electron 32; node-pty; `@modelcontextprotocol/sdk`; zod; write-file-atomic. | Three test levels: `test/headless` (`node:test` with an `electron` stub loaded by a resolve hook), `test/component` (vitest 2 with jsdom and Testing Library), `test/*.spec.ts` (Playwright driving the built Electron app, serial, one worker). |
| `packages/spec` (`@ai-lore-companion/spec`) | The v0.8 methodology as content under `process/`, including one Python 3 script, `process/core/tooling/ai-lore.py`. No build and no tests. | None. |

Root tooling: TypeScript 5.7 with `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `isolatedModules`; Biome 1.9.4 (2 spaces, width 100, single quotes, semicolons, trailing commas, recommended lint rules); Node 20 or later. Root scripts: `npm run lint`, `npm test`, `npm run verify`, `npm run e2e`.

### 1.3 What is kept and what is new

Kept unchanged, because the product document lists them as what the current app does well: the docking workspace, the terminals and their PTY service, the foreground feed, the dormant restore, the virtualised tree, change reading from git, the diff with its history, the markdown editor with Code, Diff and Preview, search, browser tabs, the engines registry, shortcuts, the Apps catalog, ignore rules, the two tiers of settings, the themes and the identity colour.

New in the MVP:

| New | Stage |
|---|---|
| The files a 1.0 Lore starts with, including three check scripts and two skeleton generators (Python 3, by the ruling above) | M1 |
| In `packages/core`: detection, the Lore reader, the desk's records, roots with change tracking, baseline points | M2 |
| The welcome screen with open and detect, the machine check, creating a Space and its Project, installing into Claude Code, adopting a plain repository | M3 |
| Session modes enforced, the write-guard, the session header, the Skills column read from the Lore, the two dialogs requested by the session through the local server, the Agents board written on GitHub | M4 |
| The Files window on roots, with reviewed marks | M5 |
| Migration from v0.8 | M6 |
| The Dashboard read from the Space's GitHub Project through a cache | M7 |
| The switch of this project | M8 |

### 1.4 Non-goals

From the focus: Runtimes; the Lore, Workbench, repository and publish-area screens; mirror review in the UI; unattended sessions, tagging and scheduling; the first-steps list; Settings additions beyond what the current app has plus engines; the Linux build; the read-only AI helper; any engine other than Claude Code.

Cut, each with its stand-in, from the focus's cut line: working while GitHub cannot be reached (claims are on the desk so writing works; plan updates fail and the session says so; no queue); `spec-before-breakdown` and `stage-gate` as check scripts (both ship as rule only); the guided first session at setup (setup and migration write the Space's corpus entry and the mirrors themselves); what Preview adds to markdown.

Consequence for the design: the desk's record types include unattended tags because stage M2 lists them, and nothing in the MVP writes one.

### 1.5 Findings that change the work

**Finding 1 — the existing reader does not read a v0.8 project.** Stage M2 says "the v0.8 reader stays as it is, used only by detection and by migration". `core/src/chain/lore.ts`, `workspace/version.ts` and `workspace/shape.ts` read the manifest at `<lore folder>/workspace.yaml`. In v0.8 the manifest is at `<lore folder>/memory/workspace.yaml` (stated in `packages/spec/process/ai_readme.md`, and true of this project). `core/src/chain/reader.ts` reads an active focus from `status.index.md` frontmatter; v0.8 keeps the focus registry in `status/status.stack.md` and each focus in its own folder. The end-to-end fixture in `packages/app/test/fixture.ts` builds a v0.5.1 tree. So detection needs to look in both manifest locations, and migration needs a new reader for the v0.8 tree. The existing reader is left as it is and keeps serving the current cockpit window. This adds one phase to M6 and a rule to M2's detection.

**Finding 2 — the changes tracker is not shape-agnostic.** Stage M2 names `changes`, `diff`, `tree`, `watcher` and `search` as shape-agnostic. `readChanges(workingTreeRoot, baseline)`, `readDiffText`, `readCommitList`, `readDirectory`, `attachWatcher` and the path index are. `changes/tracker.ts` is not: its scope type is `'payload' | 'lore'` and its snapshot has exactly those two keys. The IPC types in `shared/ipc.ts` carry the same two-value scope. M2 therefore adds a tracker keyed by root id, and M5 adds root-keyed IPC beside the existing scope-keyed IPC.

**Finding 3 — two roots share one working tree.** The Lore and the default publish area are folders inside the Space repository. `git status --porcelain` and `git diff --name-status` report paths relative to the repository root, not to the folder. Reading the changes of such a root needs a path restriction and relative paths. M2 adds this as a new function and does not edit `changes/changes.ts`.

**Finding 4 — the desktop app has no single-instance lock, and the development build and the installed build share one `userData` folder** (both use the product name "AI-Lore"; see the note `concurrent-app-settings-clobber`). Two running builds can therefore write the same desk records. Section 5.4 covers this.

**Finding 5 — the v0.8 Claude binding's hook command is a relative path.** `.claude/settings.json` registers `python3 .claude/hooks/ai-lore-guard.py pre` for the file-writing tools. When an agent's working directory is not the project root, the script is not found, the hook fails, and the write is stopped, whatever its target. This happened while this document was being written: the author's working directory was the Lore's `memory/` folder, and the file-writing tool was stopped for a file outside the project. Two consequences. Developer and tester agents must run with the project root as their working directory. And every hook command the 1.0 companion generates uses absolute paths, for the interpreter's script argument and for every path argument (section 5.6 requires this in any case, because the files are outside the Space).

**Finding 6 — routing every opened folder through detection would fail the existing end-to-end suite and differs from a project contract.** `test/fixture.ts` builds a v0.5.1 project, `launchApp` opens it through the `COCKPIT_ROOT` environment variable, and the 43 tests of `test/cockpit.spec.ts` expect the cockpit window. The contract "Companion versioning + minimum core_version" requires that a project under `MIN_CORE_VERSION` opens in the altered window, and names the end-to-end test that checks it. Stage M6 requires that a folder of v0.8 or older goes to the migration screen. If detection routing replaced today's routing in M3.5, the existing suite would fail, which section 2.4 rule 1 and section 8.7 forbid. Section 2.4 item 3 proposes a switch that keeps both; section 10.1 question 13 lists it.

**Finding 7 — an engine is started through a shell command string.** `main/pty.ts` starts an engine as `zsh -i -l -c '<binary> <args>'`, so that the engine gets the Human Lead's `PATH`; each token goes through `quoteForShell`. On macOS the `userData` folder is under `Application Support`, so every generated path of section 5.6 contains a space. Section 5.14 states what may reach that command line.

---

## 2. Architecture

### 2.1 Packages and the direction of dependencies

```
packages/spec   content only                  no code imports it; its files are copied
packages/core   Node library, no Electron     imports nothing from app
packages/app
  src/shared    types and constants           imports types only from core
  src/main      Electron main process         imports core (values and types), shared
  src/preload   generated bridge              imports shared only
  src/renderer  React UI                      imports shared (values and types), core (TYPES ONLY)
```

Rules, all of which already hold in the code and are carried forward:

1. `packages/core` never imports `electron`, `electron-builder` or `electron-vite`. Biome enforces it (`biome.json`, override for `packages/core/**`).
2. The renderer imports from `@ai-lore-companion/core` with `import type` only. A value import makes Vite follow core's `src/index.ts` to `watcher/watcher.ts` and then to chokidar's native binding, and the build fails. Verified: `electron.vite.config.ts` bundles core into main and preload and does not externalise anything for the renderer; `shared/ipc.ts` already mirrors `WORKSPACE_LAYOUT_SCHEMA_VERSION`, `DOCK_SNAPSHOT_VERSION` and `isChainErrorPayload` for this reason. A constant the renderer needs is declared a second time in `src/shared/`, with a comment naming the core original. A function the renderer needs is called through IPC.
3. The shell and companion boundary contract holds: no file under `renderer/src/shell/` imports core or names an AI-Lore concept. All 1.0 renderer code is on the companion side of that boundary.
4. All 1.0 logic that can run without Electron is in `packages/core`, so that it is tested with `node:test` and no Electron process. Main-process files for 1.0 are limited to: IPC handlers, window management, the local server, PTY spawning, timers, and building the objects core needs (paths, the command runner, the GitHub adapter).

### 2.2 Where 1.0 code is placed

**Proposal.** One new folder per package layer holds all 1.0 code. Existing files are edited only at the places listed in section 2.4.

```
packages/spec/
  process/                      v0.8, unchanged
  lore-1.0/                     M1. The tree a new Space starts with, as a template.
    ai_readme.md
    lore/
      index.md
      space.md                  the Space's manifest card (section 4.4; proposal)
      corpus/   index.md  core/
      verbs/    index.md  core/  default/
      processes/index.md  core/ (empty, with its index)  default/
      contracts/index.md  core/  (card + Python 3 check script for three; card only for two)
      mirrors/  index.md  publish.md  generators/  (two Python 3 scripts)
    publish/specs/index.md
    gitignore.template          becomes .gitignore: workbench/ and repos/

packages/core/src/
  (existing folders unchanged)
  space/                        all 1.0 library code
    index.ts                    re-exports every subfolder; created once in M2.1
    result.ts                   the Result type (section 6.4)
    exec/                       CommandRunner, GitPort, the live-system guard
    fs/                         atomic write, safe path join, tree copy with hashes
    layout/                     the paths of a Space; the data-folder paths of a desk
    manifest/                   reading and writing lore/space.md
    detect/                     FolderKind
    lore/                       cards, layers, the index of a part
    desk/                       claims, gate answers, unattended tags, reviewed marks,
                                session closes, first-seen commits, sessions
    roots/                      roots of a Space, changes per root, the root tracker
    baseline/                   the four kinds of baseline point
    github/                     GitHubPort, the gh adapter, FakeGitHub
    machine/                    the machine check
    steps/                      the step runner used by setup and migration
    setup/                      create a Space, scaffold, adopt a repository, open by address
    install/                    projection into Claude Code
    testing/                    fixture builders that the app's tests also use (section 8.3)
    claims/                     the claim rules (who may take which target)
    project/                    the Project snapshot, its cache, the Dashboard model
    legacy/                     the v0.8 reader (M6)
    migrate/                    plan, apply, verify
  index.ts                      gains one line: export * from './space/index.js'

packages/core/test/
  space/                        one test file per module, same node:test convention
  support/                      temp folders and temp git repositories, for core's tests only

packages/app/src/
  shared/ipc/space/             one contract fragment and one types file per feature
  main/space/                   context.ts, windows.ts, template-dir.ts, log.ts
    ipc/                        one register module per feature
    session-server/             the session requests on the local server
    sessions/                   launching an engine with its out-of-Space configuration
    project-refresh.ts          the timer, focus and on-demand refresh of the cache
  renderer/src/space/           welcome, machine check, setup, migration, the Space window
                                (header, rail), Dashboard, session header, Skills column,
                                the two dialogs, the Files window
packages/app/test/
  headless/space/  component/space/  space-*.spec.ts
```

The template folder name `lore-1.0`, the folder name `space/` and the file names above are proposals. The stage fixes only that M1's content is "in `packages/spec`, as a 1.0 tree beside the v0.8 one".

### 2.3 Where each stage's files are placed

| Stage | packages/spec | packages/core/src/space | packages/app/src |
|---|---|---|---|
| M1 | `lore-1.0/**` | tests only: `test/space/lore-template.test.ts`, `checks.int.test.ts`, `generators.int.test.ts` | — |
| M2 | — | `result`, `exec`, `fs`, `layout`, `manifest`, `detect`, `lore`, `desk`, `roots`, `baseline` | — |
| M3 | — | `github`, `machine`, `steps`, `setup`, `install` | `shared/ipc/space/{setup,machine}`; `main/space/{context,windows,template-dir}`; `main/space/ipc/{setup,machine}`; `renderer/src/space/{welcome,machine,setup,window}`; packaging of the template |
| M4 | — | `claims`; `project/session-issue.ts` (M4.7) | `main/space/{session-server,sessions}`; `main/space/ipc/{sessions,dialogs}`; `renderer/src/space/{session-header,skills,dialogs}` |
| M5 | — | small additions to `roots`, `baseline` | `main/space/ipc/{roots,files}`; `renderer/src/space/files/**` |
| M6 | — | `legacy`, `migrate` | `main/space/ipc/migration`; `renderer/src/space/migration` |
| M7 | — | `project` | `main/space/project-refresh.ts`; `main/space/ipc/project`; `renderer/src/space/dashboard` |
| M8 | — | none (the stage has no code of its own) | none |

### 2.4 How 1.0 code is kept beside v0.8 code until the switch

The Human Lead keeps working in v0.8 until M8. The current cockpit window must keep working for the whole MVP. The rules:

1. **Additive only.** No existing module under `core/src` (outside `space/`) is changed in behaviour. No existing IPC channel changes its name or types. Existing tests keep passing in every phase.
2. **Existing files a 1.0 phase may edit**, and what for. Any other edit to an existing file needs a line in the phase's report saying why.

| File | Edit |
|---|---|
| `core/src/index.ts` | one export line for `space/` (M2.1) |
| `app/src/shared/ipc/contract.ts` | spread the 1.0 contract fragments into `CONTRACT` (M3.5, once) |
| `app/src/shared/ipc.ts` | new modes in `WindowInitPayload`; re-export of 1.0 types (M3.5, once) |
| `app/src/main/ipc/index.ts` | add the 1.0 register modules to `MODULES` (M3.5, once; M3.5 creates an empty register module per feature, and later phases fill their own) |
| `app/src/main/ipc/types.ts` | `Deps` gains a lookup of the Space context for a window (M3.5) |
| `app/src/main/index.ts` | opening a folder goes through detection; Space windows get a Space context (M3.5) |
| `app/src/main/pty.ts` | `spawn` accepts extra environment variables and a working folder per spawn (M4.4) |
| `app/src/main/helper/mcp-host.ts` | the set of tools becomes a parameter of `register`, with today's three report tools as the default, so the helper's tests pass unchanged (M4.3). The contract "AI Helper is read-only by construction" requires the helper's control plane to bind to `127.0.0.1` and to check a token per session; this server also serves the helper, so the edit must not change either |
| `app/src/renderer/src/App.tsx` | renders the 1.0 surface for the new window modes (M3.5, once; M3.5 creates a placeholder component per new mode, and later phases replace their own placeholder file) |
| `app/src/renderer/src/components/tabKinds.tsx`, `AiTab.tsx` | the AI tab shows the session header and reads skills from the Lore when the window is a Space window (M4.6) |
| `app/package.json` | `build.extraResources` for the Lore template (M3.9) |
| `packages/spec/package.json` | `files` gains `lore-1.0/` (M1.1) |

3. **Routing by detection.** `main/index.ts` today calls `checkProjectCompatibility` and opens either the cockpit window or the altered window. In 1.0 it calls `detectFolder` first:

| Detected | Window |
|---|---|
| 1.0 Space | the Space window |
| AI-Lore project of v0.8 | the migration screen |
| AI-Lore project older than v0.8 | the migration screen in its "upgrade to v0.8 first" state, with the reason |
| plain git repository | the not-a-Space screen with "create a Space about it" and a terminal |
| anything else | the not-a-Space screen with a terminal |

**Proposal (Finding 6).** Detection routing is turned on by the environment variable `AI_LORE_SPACE_ROUTING=1`, read once when the app starts (the name is a proposal). Without it, `main/index.ts` routes as it does today, `launchApp` stays as it is, and the existing end-to-end suite and the altered-window test of the versioning contract keep passing. The 1.0 end-to-end tests and the manual checks set the variable. Making detection routing the default, and changing the versioning contract for projects under the floor, is a decision for the Human Lead at M8.

**Proposal.** Until M8 is complete, the migration screen also carries an action "Open in the v0.8 cockpit", which follows today's code path unchanged. Without it, a development build of the 1.0 companion could not open this project for daily work. The focus does not mention this action. The alternative is that daily v0.8 work uses only the installed build of the current app; that works as long as the installed build is not replaced before M8.

4. **Separate persisted state.** Everything 1.0 persists goes under `<userData>/spaces/`, in new files. No 1.0 field is added to `settings.json` or to any file the current app rewrites whole. This follows stage M2's watch item.
5. **Deleting the v0.8 code is not part of the MVP.** The product document places it in its last build step.

---

## 3. Domain model

The shapes below are TypeScript. Field names are proposals unless the comment says the source fixes them. Every persisted shape has a `version` number and every reader keeps fields it does not know when it writes the file back (section 5.4).

### 3.1 Space, desk, layout

```ts
/** The folder layout is fixed by the product document. */
type SpacePaths = {
  root: string;            // <space>/
  aiReadme: string;        // <space>/ai_readme.md
  lore: string;            // <space>/lore/
  publish: string;         // <space>/publish/          the default publish area
  repos: string;           // <space>/repos/            git-ignored
  workbench: string;       // <space>/workbench/        git-ignored
  drafts: string;          // <space>/workbench/drafts/
  journal: string;         // <space>/workbench/journal/
  scratch: string;         // <space>/workbench/scratch/
};

/** The companion's data for one desk. Location is a proposal (section 4.2). */
type DeskPaths = {
  dir: string;             // <userData>/spaces/<key>/
  desk: string;            // <userData>/spaces/<key>/desk/        the desk's records
  install: string;         // <userData>/spaces/<key>/install/     what is installed into the engine
  sessions: string;        // <userData>/spaces/<key>/sessions/    per-session generated files
  ui: string;              // <userData>/spaces/<key>/ui/          layout, open documents, baselines
};
```

`<key>` is the SHA-1 of the Space folder's resolved absolute path, the same rule `main/project-data.ts` uses for projects today. Consequence: moving the Space folder starts a new, empty desk record. This matches the product document's definition of the desk as "the Space's folder on the Human Lead's machine".

### 3.2 Detection

```ts
type FolderKind =
  | { kind: 'space'; root: string; manifest: SpaceManifest }
  | { kind: 'legacy'; root: string; lorePath: string; projectName: string;
      coreVersion: string | null;
      manifestLocation: 'lore-folder' | 'memory-folder';
      migratable: boolean }          // true when coreVersion is 0.8 or a 0.8.x
  | { kind: 'plain-repository'; root: string; originUrl: string | null }
  | { kind: 'other'; root: string };
```

The focus fixes three cases: a Space, an AI-Lore project of v0.8 or older recognised by its manifest and core version, and neither. Stage M3 needs "neither" split in two, because a plain repository gets the offer to create a Space about it. A legacy project is recognised by a single `.ai-lore-<name>` folder whose manifest has `project_name` matching the folder name; the manifest is looked for at `memory/workspace.yaml` first, then at `workspace.yaml`. How a Space is recognised is not fixed by the sources; section 4.4 proposes the manifest card.

### 3.3 The Lore

```ts
type LorePart = 'corpus' | 'verbs' | 'processes' | 'contracts' | 'mirrors';
type Layer = 'core' | 'default' | 'own';
type Pillar = 'specifying' | 'planning' | 'working' | 'producing' | 'shaping';

/** What the product document says each kind's frontmatter holds. Key names are M1's to fix.
 *  Additions of this document: `name` on a contract, and the value 'both' for `when`
 *  (the product document gives lore-integrity a check before a write and one after). */
type CorpusCard   = { kind: 'corpus';   term: string; pointsAt: string[] };
type VerbCard     = { kind: 'verb';     name: string; pillar: Pillar;
                      mode: 'read-only' | 'writing'; invokedBy: string };
type ProcessCard  = { kind: 'process';  name: string; pillar: Pillar;
                      steps: string[]; gates: string[]; unattended: boolean };
type ContractCard = { kind: 'contract'; name: string; pillar: Pillar; target: string;
                      check: string | null; when: 'before' | 'after' | 'both' | null };
type MirrorCard   = { kind: 'mirror';   payload: string; generator: string; skeleton: string };

type LoreEntry<C> = {
  card: C;
  part: LorePart;
  layer: Layer;
  path: string;                 // absolute
  replacesDefault: boolean;     // an own file with the name of a default
};
```

Layer resolution, fixed by the product document and decision 13: each part has `core/`, `default/` and the Space's own files beside them. An own file with the same name as a default is used instead of it. Nothing may take the name of a core file; the reader reports such a file as an error entry and does not use it. M1 fixes the frontmatter keys; M2.3 reads what M1 wrote. If M1 and the types above disagree, M1's cards govern and the types are corrected.

### 3.4 Sessions, modes, claims, gates

```ts
/** Fixed: two modes. Blocked is the state of an unattended session at a gate; not in the MVP. */
type SessionMode = 'read-only' | 'writing';

/** Fixed: the Lore, or a payload. A repository is held whole, on a named branch. */
type WriteTarget =
  | { kind: 'lore' }
  | { kind: 'publish-area'; name: string }
  | { kind: 'repository'; name: string; branch: string };

type IssueRef = { repository: string; number: number; url: string };

type SessionRecord = {
  id: string;                   // generated by the companion when the AI tab starts its engine
  engine: string;               // an id from the engines registry
  attended: true;               // unattended sessions are a non-goal
  mode: SessionMode;
  startedAt: string;            // ISO 8601
  closedAt?: string;
  item?: IssueRef;              // the item or focus the session is on, when it is on one
  issue?: IssueRef;             // the session's own issue, created when it first enters Writing
};

/** Fixed by stage M2: session, target and branch. */
type Claim = { sessionId: string; target: WriteTarget; claimedAt: string };

/** Fixed by stage M4: process, step and answer. Answers fixed by the product document. */
type GateAnswer = {
  id: string; sessionId: string;
  process: string; step: string; question: string;
  answer: 'yes' | 'no' | 'take-over';
  answeredAt: string;
};

type UnattendedTag = { item: IssueRef; taggedAt: string };   // defined, never written in the MVP
```

Claim rules, from the product document: the Lore is one target and is always exclusive; a repository is one target whatever the branch, so one session holds a repository at a time; a publish area is one target; a session may hold several targets and may change them while in Writing; the Workbench is always writable and is never a target. On one desk the desk's record decides. `claims/` in core is a pure function over the list of claims: `tryClaim(claims, sessionId, targets) → Result<Claim[], Held[]>`.

### 3.5 Roots, changes, baseline points, reviewed marks

```ts
type RootKind = 'lore' | 'workbench' | 'publish-area' | 'repository';

type Root = {
  id: string;                   // 'lore' | 'workbench' | 'publish:<name>' | 'repo:<name>'
  kind: RootKind;
  name: string;
  path: string;                 // absolute folder
  tracking:
    | { tracked: true; workTree: string; subPath: string }   // subPath '' for a repository
    | { tracked: false; reason: 'git-ignored' | 'outside-a-repository' };
};

/** Fixed: four kinds of point. */
type BaselinePoint =
  | { kind: 'reviewed-mark';  commit: string; at: string }
  | { kind: 'merged-pull-request'; commit: string; at: string; number: number; title: string }
  | { kind: 'session-close';  commit: string; at: string; sessionId: string }
  | { kind: 'commit';         commit: string; at: string; subject: string; sessionId?: string };

type ReviewedMark  = { rootId: string; commit: string; markedAt: string };
type SessionClose  = { rootId: string; commit: string; sessionId: string; at: string };
type FirstSeen     = { rootId: string; commit: string; at: string };
```

Fixed by the product document: the changed files of a root are the files that differ between the baseline and the working tree, together with the untracked files; the default baseline of a root is its last reviewed mark; a root never marked compares against the commit it had when the desk was created (recorded as `FirstSeen` the first time the companion sees the root); marking as reviewed records the root's present commit, so uncommitted files stay listed; the Workbench has no change tracking and the UI says so. A session close is the commit a session left when it left Writing on that root; the companion records it when the session leaves Writing.

### 3.6 The Project and its issues

```ts
/** Fixed by the default layout: Stage is a single-select field; its values are the columns. */
type ProjectSnapshot = {
  fetchedAt: string;
  project: { owner: string; number: number; title: string; url: string };
  stageField: { id: string; options: { id: string; name: string }[] };   // order as on GitHub
  focuses: FocusItem[];
  standalone: PlanItem[];
  sessions: SessionIssue[];
};

type PlanItem  = { issue: IssueRef; title: string; state: 'open' | 'closed';
                   status: string | null; labels: string[] };
type FocusItem = PlanItem & { stage: string | null; kind: string | null;
                   items: PlanItem[]; specUrl: string | null };
type SessionIssue = { issue: IssueRef; column: 'Read only' | 'Writing' | 'Blocked' | 'Done';
                   targets: WriteTarget[]; attended: boolean;
                   person: string; machine: string; updatedAt: string };
```

Fixed: a focus is a parent issue; its items are sub-issues; a standalone item is an issue under no focus; kinds are labels; every issue is in the Space repository; the Agents board has four columns and the fields focus, write targets with branches, mode, attended, person and machine. **Proposal — awaiting Human Lead** in the product document (its decision 2): the Agents board is a view of the same Project, filtered to session issues. This design assumes it, and identifies a session issue by the label `session` (the label name is a proposal). How the four columns are represented (a second single-select field, or the built-in Status field with four options) is not fixed; **Proposal**: a single-select field named `Agents` with the four values, so the built-in Status field stays free for items.

---

## 4. The four open proposals

Each of these is listed as open in the product document, and the focus uses all four. For the MVP the focus and its stages already fix part of three of them, and the focus governs: stage M5 says a reviewed mark "records the root's present commit in the desk's records" (4.1); stage M2 says the desk's records are "kept in the companion's data folder and not in the Space" (4.2); the focus's cut line says sessions ask for the dialog "through the companion's local server", and stage M4 says the server "gains two requests a session can make: enter Writing, and a gate" (4.3). Nothing in the focus fixes 4.4. What remains a proposal in each section is the file format, the file location inside the data folder, the protocol on the local server, and the manifest.

### 4.1 Reviewed marks — Proposal — awaiting Human Lead

**Recommended.** As the product document proposes: a reviewed mark is a record `{ rootId, commit, markedAt }` written by the companion when the Human Lead presses Mark as reviewed on a root. It is kept with the desk's records, so it is personal to the Human Lead on that desk. Marks are appended, never edited, so the baseline picker can list earlier marks. File: `desk/reviewed-marks.json`.

**Alternative.** A git ref in the root's repository, for example `refs/ai-lore/reviewed/<account>`. It survives the loss of the data folder and could be pushed to another desk. It means the companion writes into payload repositories and the Space repository, which the product document says it does not do, and it has no meaning for a publish area outside a repository.

**Containment.** All reads and writes go through `desk/marks.ts` (`listMarks(rootId)`, `addMark(rootId, commit)`). `baseline/` and the Files window call only these. Changing the store changes that one module.

### 4.2 Where the desk's records are kept — Proposal — awaiting Human Lead

Stage M2 already writes "kept in the companion's data folder and not in the Space", which adopts the product document's proposal for the MVP. It is listed here because the product document still lists it as open.

**Recommended.** `<userData>/spaces/<key>/desk/`, one JSON file per concern, each written atomically:

| File | Content |
|---|---|
| `sessions.json` | `SessionRecord[]` |
| `claims.json` | `Claim[]` |
| `gate-answers.json` | `GateAnswer[]` |
| `unattended-tags.json` | `UnattendedTag[]` |
| `reviewed-marks.json` | `ReviewedMark[]` |
| `session-closes.json` | `SessionClose[]` |
| `first-seen.json` | `FirstSeen[]` |
| `project-cache.json` | `ProjectSnapshot` |
| `migration.json` | the migration ledger (section 5.9) |

Each file is `{ "version": 1, "records": [...] }`. The write-guard check script reads `sessions.json` and `claims.json`, so their format is part of M1's contract card and may not change without changing the script.

**Alternative.** A git-ignored folder inside the Space, for example `<space>/.desk/`. A colleague or a backup of the Space folder would carry it, and a moved Space would keep its records. A session could write it, and then the write-guard and the gate record prove nothing; this is the reason the product document gives for the data folder.

**Containment.** Core never computes the desk folder. Main passes `DeskPaths` into every core function that needs it, and the check scripts receive the folder as an argument. A different location changes `layout/desk-paths.ts` and nothing else.

### 4.3 How a session asks the companion for a dialog — Proposal — awaiting Human Lead

**Recommended.** As the product document proposes, the local server the app already runs. In the code that server is `main/helper/mcp-host.ts`: an HTTP server bound to `127.0.0.1` on a port chosen by the operating system, one path per session (`/mcp/<sessionId>`), a bearer token per session, speaking MCP so that a request is a tool call whose arguments are validated by a zod schema. The session is started with `--mcp-config <file> --strict-mcp-config` pointing at it, as the helper is today. Four tools:

| Tool | Arguments | Returns |
|---|---|---|
| `request_writing` | `targets: WriteTarget[]`, `item?: number`, `reason: string` | `{ ticket }` at once; the companion shows the entering-Writing dialog |
| `request_gate` | `process`, `step`, `question`, `bearsOn?: string` | `{ ticket }` at once; the companion shows the gate dialog |
| `await_answer` | `ticket` | the answer, or `{ status: 'pending' }` after at most 120 seconds |
| `leave_writing` | none | the session's new mode; lets the session return to Read only at the end of the work process, as the header's Leave Writing action does from the UI |

Stage M4 and the product document describe two requests, one for entering Writing and one for a gate, each returning the Human Lead's answer. `await_answer` and `leave_writing` are additions of this document. `leave_writing` only reduces what the session may write. The request and the wait are separate calls because the Claude Code documentation, as read for this document on 2026-09-18, gives an idle limit of five minutes for a tool call over HTTP, and a Human Lead may take longer to answer. The verb text tells the session to call `await_answer` again while the status is pending. The 120 seconds is a proposal.

The answer to `request_writing` is `{ granted: true, claims }`, or `{ granted: false, reason: 'held' | 'declined', heldBy? }`. The companion writes the claim to the desk's record before it returns the answer. The answer to a gate is the `GateAnswer`. The session's file-writing tools cannot write either record: the records are outside the Space, and the server offers no tool that writes them except through the Human Lead's dialog. Section 5.4 states the limit that applies to shell commands.

**Alternative.** A plain HTTP endpoint on the same server and a small command-line script in the Lore that posts to it. It works for an engine that has no MCP client. It needs a script runtime on the machine (under the ruling at the top of this document `python3` is required in any case), its arguments are not validated by a protocol, and the session must be allowed to run that script in the shell.

**Containment.** A `DialogBroker` in `main/space/session-server/broker.ts` owns tickets, pending requests and answers, and knows nothing about MCP. The MCP tools are a thin adapter over it. A different transport is a second adapter.

### 4.4 Where the list of payloads is kept — Proposal — awaiting Human Lead

**Recommended.** As the product document proposes, a small manifest in the Space repository that holds no state, written by `payload-add` (and by setup and migration). This design places it at `lore/space.md`, as a card, so that it is covered by the claim on the Lore and by lore-integrity, and is listed in `lore/index.md`:

```yaml
---
type: space
format: 1
name: ai-lore
github:
  repository: alberto-conan-ui/ai-lore        # owner/name of the Space repository
  project: 7                                   # the Project's number under that owner
repositories:
  - name: ai-lore-companion                    # its folder is always repos/<name>
    github: alberto-conan-ui/ai-lore-companion
publish_areas:
  - name: publish
    path: publish                              # inside the Space's folder
  - name: handbook                             # outside the Space: name only;
                                               # its path is kept with the desk's records
---
```

The example values are illustrative. The same file is what detection uses to recognise a 1.0 Space: a folder is a Space when `lore/space.md` exists and its frontmatter has `type: space`. The file location, the key names and the use of the file as the detection marker are this document's proposals; the product document fixes only what the manifest names.

**Alternative.** No manifest: the list of payloads is derived from the frontmatter of the cards in `lore/mirrors/`, since every payload has a mirror and a mirror names its payload. It adds no file. It leaves no place for the Project's number, and detection would need another marker.

**Containment.** `manifest/` exposes `readSpaceManifest(root)` and `writeSpaceManifest(root, manifest)`. `detect/`, `roots/`, `setup/` and `migrate/` use only these.

---

## 5. Design

### 5.1 Processes and IPC

The app has a main process, one renderer per window, one preload script, a utility process for search, and one PTY per terminal. 1.0 adds windows, not processes: the Space window and the Files window are two `BrowserWindow`s that load the same renderer bundle and differ by their `WindowInitPayload` mode.

```ts
type WindowInitPayload =
  | { mode: 'welcome'; recents: RecentProject[] }                 // existing
  | { mode: 'cockpit' }                                           // existing
  | { mode: 'altered'; folder: string; reason: AlteredReason }    // existing
  | { mode: 'space-welcome'; recents: RecentSpace[] }             // see the note below
  | { mode: 'machine-check' }
  | { mode: 'setup'; start: SetupStart }
  | { mode: 'migration'; folder: string; legacy: LegacySummary }
  | { mode: 'not-a-space'; folder: string; plainRepository: boolean }
  | { mode: 'space'; space: SpaceSummary }
  | { mode: 'space-files'; space: SpaceSummary; open?: OpenInFiles };
```

**Proposal.** The existing `welcome` mode and `WelcomeScreen.tsx` stay as they are, because the existing end-to-end suite uses them. With detection routing on (section 2.4), main sends `space-welcome` where it sends `welcome` today, and the 1.0 welcome screen of M3.6 renders for it. The recents of Spaces are kept under `<userData>/spaces/`, apart from today's recents file.

IPC keeps the existing mechanism: one typed table (`CONTRACT` in `shared/ipc/contract.ts`), from which the preload bridge, the `CockpitApi` type and the main-side registrar are derived. To let phases work in parallel, the 1.0 entries are declared in one fragment per feature and spread into `CONTRACT` once:

```ts
// shared/ipc/space/roots.contract.ts
export const SPACE_ROOTS_CONTRACT = {
  spaceRootsList:        invoke<[], RootSummary[]>('space:roots-list'),
  spaceRootSetBaseline:  invoke<[arg: { rootId: string; commit: string }], void>('space:root-set-baseline'),
  spaceRootMarkReviewed: invoke<[arg: { rootId: string }], ReviewedMark>('space:root-mark-reviewed'),
  onSpaceRootChanges:    push<RootChangesPayload>('space:root-changes'),
} as const;
```

Rules for every new channel: the method name starts with `space` (or `onSpace` for a push); the channel string starts with `space:`; arguments are one object; a handler validates its argument with a zod schema before use, because the renderer hosts embedded browser tabs and its messages are not trusted input; a handler that takes a path resolves it against the Space's roots (section 5.14). Main-side handlers are register modules with the existing signature `(reg, deps) => void`, one per feature, under `main/space/ipc/`.

Main keeps a `SpaceContext` per Space (not per window), holding: `SpacePaths`, `DeskPaths`, the manifest, the roots, the root tracker, the watchers, the PTY service, the search service, the desk store, the `DialogBroker`, and the GitHub port. Both windows of a Space resolve to the same context.

### 5.2 Command running, git and the filesystem

```ts
type RunResult = { code: number; stdout: string; stderr: string };
type CommandRunner = {
  run(bin: string, args: readonly string[],
      opts?: { cwd?: string; env?: Record<string, string>; input?: string; timeoutMs?: number }
  ): Promise<RunResult>;
};
```

One implementation, `execFileRunner`, uses `child_process.execFile` with an argument array and no shell. Modules under `core/src/space` take a `CommandRunner` as a parameter; they never import `child_process` themselves, and they start `git`, `gh` and `python3` (the check scripts and the skeleton generators) only through it. Tests replace the runner with a scripted one, and the real runner enforces the rule against live systems (section 8.1). The existing synchronous git readers call `child_process` directly and are not covered by the runner's guard; tests pass them folders under the temporary folder only.

`GitPort` is a set of functions over a `CommandRunner`: `head`, `currentBranch`, `originUrl`, `isClean`, `clone`, `init`, `addAll`, `commit`, `push`, `logForPath`, `mergeBase`. Read commands against a folder the companion must leave untouched use `git --no-optional-locks`, so that `git status` does not rewrite the index file. The existing synchronous readers (`readChanges`, `readDiffText`, `readCommitList`) are reused as they are for local reads, as the current tracker does; any new command that touches the network (`clone`, `push`, every `gh` call) is asynchronous.

Filesystem helpers in `fs/`: `writeFileAtomic(path, text)` (temporary file in the same folder, `fsync`, rename), implemented with `node:fs` so that core gains no dependency; `safeJoin(base, relative)` which returns an error when the result is outside `base` after resolving symbolic links; `copyTree(from, to, { exclude })` which returns a list of `{ relativePath, sha256 }` and skips a file that already exists at the destination with the same hash.

### 5.3 GitHub access

**Mechanism.** The GitHub CLI, `gh`, run through the `CommandRunner`. The reasons are in the sources: the machine check requires `gh` signed in with the `project` scope; branches are created with `gh issue develop --branch-repo`; sessions use `gh` as the Human Lead's account. The companion therefore never reads, stores or passes a token; authentication stays inside `gh`. Projects are reached with `gh api graphql`.

**Abstraction.** Core defines the interface; the app and the tests choose the implementation.

```ts
type GitHubPort = {
  auth(): Promise<Result<{ account: string; scopes: string[] }, GitHubError>>;
  // repositories
  findRepository(fullName: string): Promise<Result<RepositoryInfo | null, GitHubError>>;
  createRepository(arg: { owner: string; name: string; private: boolean }): Promise<Result<RepositoryInfo, GitHubError>>;
  // the Project
  findProject(arg: { owner: string; title: string }): Promise<Result<ProjectInfo | null, GitHubError>>;
  createProject(arg: { owner: string; title: string }): Promise<Result<ProjectInfo, GitHubError>>;
  ensureSingleSelectField(arg: { project: ProjectInfo; name: string; options: string[] }): Promise<Result<FieldInfo, GitHubError>>;
  linkProjectToRepository(arg: { project: ProjectInfo; repository: string }): Promise<Result<void, GitHubError>>;
  ensureLabels(arg: { repository: string; labels: LabelSpec[] }): Promise<Result<void, GitHubError>>;
  // issues
  findIssueByMarker(arg: { repository: string; marker: string }): Promise<Result<IssueRef | null, GitHubError>>;
  createIssue(arg: { repository: string; title: string; body: string; labels: string[] }): Promise<Result<IssueRef, GitHubError>>;
  addSubIssue(arg: { parent: IssueRef; child: IssueRef }): Promise<Result<void, GitHubError>>;
  addIssueToProject(arg: { project: ProjectInfo; issue: IssueRef }): Promise<Result<ProjectItemId, GitHubError>>;
  setSingleSelect(arg: { project: ProjectInfo; item: ProjectItemId; field: FieldInfo; option: string }): Promise<Result<void, GitHubError>>;
  comment(arg: { issue: IssueRef; body: string }): Promise<Result<void, GitHubError>>;
  closeIssue(arg: { issue: IssueRef }): Promise<Result<void, GitHubError>>;
  developBranch(arg: { issue: IssueRef; branchRepository: string; name: string }): Promise<Result<{ branch: string }, GitHubError>>;
  // reads
  readProject(arg: { project: ProjectInfo }): Promise<Result<ProjectSnapshot, GitHubError>>;
  mergedPullRequests(arg: { repository: string; limit: number }): Promise<Result<MergedPullRequest[], GitHubError>>;
};

type GitHubError =
  | { kind: 'unreachable'; message: string }
  | { kind: 'not-signed-in' }
  | { kind: 'missing-scope'; scope: string }
  | { kind: 'rate-limited'; retryAfterSeconds: number | null }
  | { kind: 'failed'; message: string };
```

Two implementations. `GhCliGitHub(runner)` builds `gh` argument arrays and parses JSON output. `FakeGitHub` keeps repositories, issues, sub-issue links, one Project with its fields and items, and pull requests in memory; it can save and load its state as one JSON file; `createRepository` creates a bare git repository in a temporary folder and returns its path as the clone address, so clone and push work without a network; it can be told to answer `unreachable` or `rate-limited`. `FakeGitHub` is in `core/src/space/github/fake.ts` and is exported, because core tests, app headless tests and the end-to-end tests all use it. Main uses it only when both `COCKPIT_E2E=1` and `AI_LORE_FAKE_GITHUB=<state file>` are set; the existing `COCKPIT_E2E` flag is the precedent for test-only behaviour in main. **Proposal.** When `COCKPIT_E2E=1` is set and `AI_LORE_FAKE_GITHUB` is not, main uses a port whose every call answers `unreachable`, and never builds `GhCliGitHub`, so an end-to-end test that forgets the fake cannot reach live GitHub.

Budget. The stage files give the limits: setup's GitHub writes are few and sequential (M3); issue creation is limited to 80 a minute and 500 an hour (M6); the Project is read in few GraphQL queries, within 5,000 points an hour shared with the sessions (M7). **Proposal**, the figures that meet them: issue creation is sequential with at least one second between two creations; the plan screen warns when a migration would create more than 400 issues; the Project is read with one query per page of 100 items, with sub-issues and field values in the same query.

**Open point.** Stage M3 lists "views" among what setup creates on the Project. This document could not confirm that the GitHub API can create a Project view; `gh project` has no command for it. M3.1 must check. If it cannot be done, the options are to copy a template Project (the copy carries its views), or to list the three views in setup's summary as a step the Human Lead does by hand. The M3 gate does not mention views.

### 5.4 The desk's records

`desk/store.ts` exposes one small module per file of section 4.2, each with a read function and named write functions (`addClaim`, `releaseClaims(sessionId)`, `recordGateAnswer`, `addMark`, and so on). Rules:

- Only the main process writes. The renderer asks through IPC. A session's file-writing tools cannot write these files: they are outside the Space, and the write-guard refuses every path outside the Space. A shell command is limited only by the engine's permission rules (section 5.6), and the desk folder's path appears in the session's hook commands, so a shell command that gets past those rules could write a desk record. This is the same limit that section 5.6 states for every shell write, and the risk table in section 10.2 lists it.
- A write is read, change, atomic write, inside one synchronous function, so two writes in the same process cannot interleave.
- A reader keeps fields and records it does not understand and writes them back. This is the answer to the two-builds problem recorded in the note: a development build and an installed build of different versions share `userData`.
- **Proposal.** A file `desk/owner.json` holds the process id and start time of the app instance that opened the Space. A second instance that finds a live owner opens the Space with writing of desk records disabled and says so in the header. The sources do not cover two instances; without this, two builds could both grant the same target.
- A file that does not parse is renamed to `<name>.corrupt-<timestamp>` and treated as empty, and the header shows a notice. For `claims.json` and `sessions.json`, empty means every session is in Read only and holds no target, so nothing in the Lore or a payload can be written until a claim is made again.

### 5.5 Installing into Claude Code

Stage M3 fixes: verbs and processes become skills under a prefix; contract checks become hooks; settings and permissions are placed outside the Space's folder.

**Proposal.** The projection writes a Claude Code plugin folder under the desk's data folder and the session is started with it:

```
<userData>/spaces/<key>/install/claude-code/
  plugin/
    .claude-plugin/plugin.json          name: "lore"  (the prefix; skills are invoked as /lore:<name>)
    skills/<verb-or-process>/SKILL.md   generated from each resolved card: a short description
                                        from the frontmatter, and an instruction to read the card
                                        at its path in the Space and follow it
  checks/                               copies of every contract check script resolved from the Lore
                                        (Python 3 files, for example write-guard.py; M1 fixes the names)
  install.json                          what was installed, from which card, with each card's hash
```

Language of the scripts, by the ruling at the top of this document: the check scripts and the skeleton generators are Python 3 files that import the standard library only. They are run as `python3 <absolute path of the script> <arguments>`, by the hooks of section 5.6, by core through the `CommandRunner`, and by a person from a command line. The machine check requires `python3` (section 5.8). Two consequences. The Python standard library has no YAML parser, so each script that reads frontmatter or `lore/space.md` carries a small parser of its own, as `packages/spec/process/core/tooling/ai-lore.py` does for v0.8. **Proposal**: M1.1 limits card frontmatter and the manifest to a subset that such a parser reads (scalars, lists of scalars, one-level maps and lists of one-level maps, which is what the example of section 4.4 uses), states the subset in the corpus entry "frontmatter", and the TypeScript writers in `manifest/` and `migrate/` write only that subset. The TypeScript side reads with `js-yaml`, which core already depends on.

The Claude Code documentation, as read for this document, describes `--plugin-dir <path>`, skills named `<plugin>:<skill>`, and the layout above. The prefix `lore` is a proposal; the product document proposes only that there is a prefix. A skill's body points at the card instead of copying it, so an edit to an own card takes effect without reinstalling; reinstalling is needed when a card is added, removed or renamed, and the companion does it when the watcher reports a change under `lore/verbs`, `lore/processes` or `lore/contracts`. Check scripts are copied out of the Space so that a session that edits a script in the Lore through the shell does not change the script that guards it; the copy is refreshed by the same reinstall.

Stage M3 says contract checks become hooks. In this design the install step copies the check scripts, and the hook entries that call them are written per session (section 5.6), because a hook command carries the session's id.

`install/claude-code.ts` is a pure function from the resolved Lore to a list of `{ path, content }`, plus a writer. It is tested without Claude Code. The M3 gate's "a Claude Code session in the Space that lists the 1.0 skills" is a manual check with the real engine.

### 5.6 Sessions, Read only and the write-guard

**Starting a session.** When an AI tab starts its engine in a Space window, main creates a `SessionRecord` in Read only, registers the session with the local server (id and token), writes the session's files, and spawns the engine in the PTY with the Space folder as working folder:

```
<userData>/spaces/<key>/sessions/<sessionId>/
  settings.json      permissions and hooks for this session
  mcp.json           the local server's address for this session and its bearer token
  hooks/pre-write.py   the Claude Code adapter for the before-write checks (Python 3)
  hooks/post-write.py  the adapter for the after-write checks (Python 3)

claude --settings <settings.json> --mcp-config <mcp.json> --strict-mcp-config
       --plugin-dir <install>/claude-code/plugin
       --allowedTools mcp__ailore__request_writing mcp__ailore__request_gate
                      mcp__ailore__await_answer mcp__ailore__leave_writing
```

This is the mechanism `main/helper/hooks.ts` and `helper/manager.ts` use for the read-only helper: generated files outside the project, passed by `--settings`, with the port, token and session id written into them. A generated hook command has the form `python3 "<absolute path>/hooks/pre-write.py" --space "<absolute path>" --desk "<absolute path>" --session <id>`; every path in it is absolute and quoted (Findings 5 and 7), and it does not depend on the working directory. **Proposal.** The text of the two adapters is a constant in a TypeScript module under `main/space/sessions/`, written out when the session starts; an adapter reads the JSON, runs each check script with `python3` by absolute path with an argument list and no shell, and passes on the exit code and standard error. The alternative is a static `.py` file shipped with the template; section 10.1 question 14 lists it.

**Difference from stage M4.** The stage says Read only is enforced "by starting the engine with deny-writes settings and hooks placed outside the Space, the mechanism the read-only helper uses today". The launch mechanism is reused. The helper's permission profile is not: it denies `Write`, `Edit` and `Bash` outright, and the product document says a session in Read only writes the Workbench and updates the Project with `gh`. **Proposal**: in a 1.0 session the file-writing tools stay available and the write-guard hook refuses by path. Section 10.1 question 15 lists it.

**File edits.** `settings.json` registers a `PreToolUse` hook for the file-writing tools (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`). The hook is the adapter: it reads Claude Code's JSON from standard input, takes `tool_input.file_path`, and runs each applicable check script from `install/claude-code/checks/` with engine-neutral arguments:

```
python3 <install>/claude-code/checks/write-guard.py
        --space <space folder> --desk <desk folder> --session <id> --path <absolute path>
exit 0 = allow.  exit 2 = refuse; the reason is on standard error and names the mode.
```

The script file names and the argument names are proposals; M1.5 fixes them in the contract cards, and M4.4 follows the cards. Path rule for the write-guard script (**Proposal**, the sources do not cover symbolic links): before comparing, the script resolves symbolic links in the path to be written (for a file that does not exist yet, in its nearest existing parent folder) and in the folder of each target, and compares the resolved paths, so a link inside the Workbench that points into `lore/` or `repos/` is judged by where it points. When the script starts `git` to read a repository's branch it uses an argument list and no shell.

The write-guard's decision, fixed by the product document: a path under `workbench/` is allowed; a path under `lore/` or a payload is refused in Read only, with a message that names the mode; in Writing it is allowed only when the path is inside a claimed target, and for a repository only when the repository's checked-out branch is the claimed branch; any other path inside the Space (for example `ai_readme.md`) and any path outside the Space is refused (**Proposal**: the sources do not say what happens to a path that is neither Lore, payload nor Workbench). **Proposal**, not covered by the sources: when the script cannot read the desk's record it refuses; when the adapter cannot find or run a check script, or `python3` is missing, it refuses and says which, so that a broken installation is reported as one. From the product document: `lore-integrity` runs before a write (refuse under `core/` or `default/`) and after a write to the Lore (frontmatter parses, references resolve, every index lists exactly its children), and a failure "is reported to the session, which must fix it before leaving Writing"; `journal-append-forward` refuses a write to a journal entry of an earlier session. The after-write adapter reports a failure to the session on standard error. Whether leaving Writing is refused while the Lore fails lore-integrity is question 17 of section 10.1; the default is that it is not refused.

**Shell commands.** Stage M4's watch item applies: a hook sees only the command's text. What enforces each kind of write:

| Write path | What enforces it |
|---|---|
| The engine's file-writing tools | The write-guard check, by path. Enforced. |
| Shell commands | Claude Code's own permission rules in the session's `settings.json`: an allow list for the read commands and the `git` and `gh` commands the default verbs use, and `ask` for everything else, so the Human Lead sees any other command before it runs. Its documentation says these rules match by prefix and that another form of the same command can get past them. The permission rules therefore reduce what a shell command can write and do not prevent a write outside the claim. The allow list and the `ask` default are proposals; M4.1 checks them with the real engine. |

Claude Code's documentation also describes operating-system sandbox settings for the shell (`sandbox.filesystem.allowWrite` and `denyWrite`). Whether they can follow a claim that changes while the session runs is not known. M4.1 is an investigation with the real engine that answers this before M4.4 fixes the permission profile. Until it is answered, the text shown to the Human Lead says that shell commands are limited by the engine's permission rules and not by the write-guard.

**Sessions not started by the companion.** A `claude` process started by hand in the Space folder gets none of the above. The guards hold only for sessions the companion starts. The design does not write a `.claude/` folder into the Space, because stage M3 places settings outside the Space.

**Entering and leaving Writing.** Entering: the session calls `request_writing`; main checks `tryClaim` against the desk's record and, when GitHub is reachable, against the cached Agents board for other desks; the dialog lists the Lore, each publish area and each repository with a branch field, shows who holds what, and disables a held target (the product document also has the session read the board again after claiming, to catch another desk; stage M4 does not name it and this design does not do it); on confirm main writes the claims, sets the session's mode, pushes the new header state to the renderer, answers the ticket, and then creates or moves the session's issue on GitHub. When the item is known and a repository is claimed, the branch is created with `developBranch` before the answer is returned. Leaving: from the header action, from `leave_writing`, or at session close; main records a `SessionClose` with the current commit of each claimed root, releases the claims, sets Read only, and moves the session issue to Read only or, at close, to Done with the handover as its last comment. If GitHub cannot be reached, the claim and the mode change still happen, the GitHub update fails, and the header and the answer to the session say so; nothing is queued (the focus's cut line).

### 5.7 The session header, the Skills column and the two dialogs

The header is one line above the terminal: engine, mode pill, a chip per target with its branch, the item, attended, and Leave Writing. Its state comes from main by a push channel keyed by session id; the renderer holds no mode of its own. The Skills column replaces, in a Space window, what `main/prompts.ts` does for v0.8: main reads verbs and processes with the Lore reader, groups them by pillar, and re-reads when the watcher reports a change under `lore/`; selecting one types `/lore:<name>` into the terminal without a newline, which the existing AI tab already does for v0.8 verbs.

Stage M4's two regressions to guard: a dragged terminal keeps its process, and restored tabs stay dormant. The header is rendered inside the existing AI tab component and must not change the identity or the mounting of the terminal element. Existing coverage: `test/cockpit.spec.ts` has an end-to-end test that moves a terminal tab to another group through the dock API and checks that its process is kept (Playwright cannot produce the dock's native drag). Dormant restore is covered at component level in `test/component/tabKinds.test.tsx` and in the headless settings test, not end to end; a comment in `cockpit.spec.ts` says layout restore is disabled today. M4.6 adds the move check for a Space window end to end, and the dormant check for a Space window at the level where it can be shown, which M4.6 reports.

The dialogs are Radix dialogs built on the existing `overlay/ModalSheet`. A dialog is opened by a push from main carrying the ticket and the request; its answer is one `invoke` carrying the ticket. A pending gate is also listed in main's `DialogBroker`, which is what the Dashboard's Needs you reads in M7.

### 5.8 Setup: the step runner

The product document proposes, and stage M3's gate requires, that every step of setup first checks whether it has already been done. Setup and migration share one runner:

```ts
type Step<C> = {
  id: string;
  title: string;                                   // shown on the screen
  describe(ctx: C): Promise<PlanLine[]>;           // what it would do; used by the dry run
  isDone(ctx: C): Promise<boolean>;                // asks the real state, not a ledger
  run(ctx: C): Promise<Result<void, StepError>>;
};
type PlanLine = { what: string; from?: string; to?: string; count?: number };
```

`runSteps` goes through the steps in order, skips a step whose `isDone` is true, stops at the first error, and reports progress through a callback. The machine check covers what stage M3 lists (`git`; `gh` signed in with the `project` scope, and how to add it; an engine from the registry present and signed in) and, by the ruling at the top of this document, `python3` (`python3 --version` answers with a 3.x version; the lowest accepted 3.x is for M3.2 to fix from what M1's scripts use). Stage M3 and decision 16 name three requirements; `python3` is a fourth, added by the ruling and reversible with it. A skeleton generator is run by core as `python3 <template or Lore path>/mirrors/generators/<script> <arguments>` through the `CommandRunner`. Creating a Space is the steps: check the machine; create or find the Space repository; create or find the Project, its Stage field with Spec, Plan, Build, Review, Done, its labels, its link to the repository; scaffold the desk from the template (copy `lore-1.0/`, fill the Space's name, write `lore/space.md`, create `workbench/` and `repos/`, write `.gitignore`); write the Space's corpus entry from the form; clone each repository into `repos/` and write its mirror with a generated skeleton; first commit and push; install into Claude Code; record `FirstSeen` for every root. Adopting a plain repository is the same list with the repository's origin address filled in; the original checkout is only read. Opening by GitHub address is: clone the Space repository, create the Workbench, install, list the manifest's repositories for confirmation, clone them.

The template folder is found by `main/space/template-dir.ts`: in development it is `packages/spec/lore-1.0`; in a packaged app it is under `process.resourcesPath`, put there by `build.extraResources`. Core receives the folder as a parameter.

### 5.9 Migration

Fixed by the focus: a new Space folder and repository; the payload repository cloned fresh into `repos/`; `memory/` and `references/` copied as they are into `publish/archive/v0.8/`; the old folder and both old repositories left exactly as they were, with a pointer from the Space; the mapping table; every step checks whether it was already done; a project older than v0.8 is told to upgrade to v0.8 first.

**Reading the source.** `legacy/v08-reader.ts` reads, and only reads: the manifest; `status/status.stack.md` (focus, status); each focus folder (focus file, stage folders and files); `status/backlog/*.backlog.md`; `journal/live/` (the newest entry and its handover section); `blueprint/contracts/` outside `core/`; `blueprint/mirror/`; `notepad/`; and the payload repository's origin address. It has no write function. Git commands against the source are limited to `rev-parse`, `status`, `remote get-url` and `ls-files`, all with `--no-optional-locks`.

**The plan, shown before anything is created.** `migrate/plan.ts` builds the step list and calls `describe` on every step. The plan screen shows the mapping table of the focus with this project's real counts and destinations, the fields the Human Lead must fill (the new Space's folder, name, owner, and description), and what will not be carried. Nothing is written, locally or on GitHub, until the Human Lead confirms.

**Applying.** The steps, in order, each with its own `isDone`:

1. Record the source's state: for both source repositories, the head commit and the output of `git status --porcelain`. Kept in memory and in the ledger for the verification at the end.
2. Create the Space (the steps of section 5.8, reused).
3. Clone the payload repository from its origin address into `repos/<name>`.
4. Copy `memory/` and `references/` into `publish/archive/v0.8/`, excluding the `.git` folder of the Lore repository. Done when every source file has a destination file with the same SHA-256.
5. Write the pointer to the old folder and the two old repository addresses. **Proposal**: in `publish/archive/index.md`, outside `v0.8/`, so that the archive folder stays identical to its source.
6. Contracts: each project contract becomes `lore/contracts/<name>.md` with frontmatter, rule only, and the part's index is updated. **Finding**: this project's `blueprint/contracts/` holds three `*.contract.md` files with one contract each and one `contracts.spec.md` with five contracts as sections. How the second is carried is question 16 of section 10.1.
7. Mirror: the prose of the v0.8 mirror nodes is carried into the mirror of the payload repository in `lore/mirrors/`, with a skeleton generated fresh.
8. Workbench: the newest journal handover becomes the first entry of `workbench/journal/`; the product document, its images and the critique note go to `workbench/drafts/`.
9. The Space's corpus entry, from the project's name and the description on the plan screen.
10. Commit and push the Space repository. The archive must be on GitHub before step 11, because the issues link to archived files by address.
11. Issues, sequential and paced: the in-progress focus as a focus issue at its stage, its stages as sub-issues linking to their archived files; each paused focus as a standalone issue labelled `paused`, linking to its archived subtree; each backlog item as a standalone issue.
12. Install into Claude Code.
13. Verify: lore-integrity passes; every archived file's hash equals its source's; both source repositories have the head and status recorded in step 1.

**Running it again duplicates nothing.** Three mechanisms. The local steps ask the real state (a file with the same hash exists; a card exists). The GitHub steps ask GitHub: the repository and the Project are found by name before they are created, and every issue the migration creates carries a hidden marker in its body, `<!-- ai-lore-migrated: <source relative path> -->`, which `findIssueByMarker` searches for before creating. The ledger `desk/migration.json` records each completed step with what it created, and is consulted first to save calls; if the ledger is lost the markers still prevent duplicates. The marker text is a proposal.

**Migration and this document's open points.** Several details of the mapping are not fixed by the focus; they are listed in section 10 and each has a default so that M6 can be built and the plan screen can show the choice.

### 5.10 The Files window on roots

The Files window reuses the existing components (`FileTree`, `ChangesPanel`, `BaselinePicker`, `EditorPanel`, `CommitRow`, `SearchDialog`) with a root id where they take a scope today. **Proposal**: a component gets a root-keyed variant only where its props name `ChangeScope`; shared logic is moved into a function both variants call, and the v0.8 variant keeps its name and its tests.

Main holds one `RootTracker` per Space: `snapshot(rootId)`, `baseline(rootId)`, `setBaseline`, `scheduleRefresh(rootId)`, `refreshNow()`, with the same 200 ms debounce as today's tracker. Re-reading is triggered as today: a file event from the watcher, a move of the repository's head (`.git/logs/HEAD`), and the window gaining focus. A root that is a folder inside a working tree is read with `readChangesIn(workTree, baseline, subPath)`: `git status --porcelain -z -uall -- <subPath>` for `HEAD`, or `git diff --name-status -z <baseline> -- <subPath>` plus untracked files under the sub-path; paths are made relative to the root. Renames are reported by git as `R` entries and carried as today's `ChangeEntry` does.

Baseline points for a root are the union of: reviewed marks and session closes from the desk's records; merged pull requests from `GitHubPort.mergedPullRequests` for a repository root (each with its merge commit), omitted with a stated reason when GitHub cannot be reached; commits from `readCommitList`, grouped under a session when a session close or the session's start and end times bracket them. The per-file history shows the same four kinds and pins a diff to a point without changing the root's baseline; that is already how `EditorPanel` treats a pinned commit.

What is remembered (open documents, modes, pins, the selected root, each root's baseline, both windows' positions) is written to files under `<userData>/spaces/<key>/ui/`, one file per concern, by the focused window only, following the existing rule in the product document.

### 5.11 The Dashboard and the Project cache

`project/cache.ts` reads and writes `desk/project-cache.json`. `main/space/project-refresh.ts` refreshes it on a timer, when a Space window gains focus, and on demand, never more than one refresh at a time; the interval is a setting and its default is a proposal of five minutes. A refresh that fails with `unreachable` leaves the cache as it is and records the failure time. The Dashboard receives `{ snapshot, fetchedAt, state: 'fresh' | 'stale' | 'offline' }` by push and renders only that.

`project/dashboard-model.ts` is a pure function from a `ProjectSnapshot`, the desk's sessions, the pending gates and the current time to the three parts: columns in the order of the Stage field's options, with a card per focus (kind, items done over items, spec link, gate note) and standalone items beside them; one Agents board row per session issue, marked stale after the threshold (the product document proposes one day; a setting); Needs you, in order: a pending gate (opens the gate dialog), a focus at Review, a stale session. Mirrors out of date are not in the MVP. Starting an attended session from the Dashboard opens an AI tab in Sessions and starts it.

### 5.12 Error handling

- Core functions that can fail for a reason the caller must handle return a `Result` (section 6.4). They throw only for programming errors.
- An IPC handler never lets an exception reach the renderer as a rejected promise with a stack; it returns the `Result`, and the renderer shows the message in the screen's own error area. This matches the existing `{ kind: 'ok' } | { kind: 'failed'; message }` shapes.
- Every screen that runs steps shows which step failed, the message, and a "run again" action; running again repeats nothing, because every step first checks whether it is already done (section 5.8).
- GitHub errors are shown by kind: not signed in and missing scope link to the machine check; unreachable is shown as offline with the cache's age; rate-limited shows when to try again.
- A guard that cannot decide refuses.

### 5.13 Logging

The current app logs with `console` in main and has an in-renderer activity console. **Proposal**: one small logger in `main/space/log.ts` that writes JSON lines to `<userData>/logs/space-<date>.log` and to `console`, with levels `info`, `warn`, `error`, and these events at least: a folder detected and as what; each setup or migration step started, skipped, finished or failed; every `gh` and network `git` command with its arguments and exit code, never its standard output when the command is `gh auth`; every claim granted, refused and released; every gate asked and answered; every write-guard refusal reported by the hook adapter; each cache refresh and its result. Tokens never appear in a log: the session token is replaced by its first four characters.

### 5.14 Security

| Surface | Rule |
|---|---|
| Renderer | `contextIsolation` on, no Node integration, the bridge generated from the contract; unchanged. New handlers validate arguments with zod and resolve paths against roots. |
| Embedded browser tabs | Unchanged isolation. They run in the same app as the dialogs, so a dialog's answer is accepted only over IPC from a Space window's own web contents, checked by `event.sender` id. |
| Local server | As `mcp-host.ts` does today: binds `127.0.0.1` only, never `0.0.0.0` or a name; the port is chosen by the operating system at each launch; one path and one random token per session; a request for an unknown session or with a wrong token is refused. Tools are limited to the four of section 4.3. None of the tools writes a file; the only effects are a dialog and, on the Human Lead's confirmation, a desk record and a GitHub update. No request is granted without the Human Lead's confirmation in the dialog. **Proposal**, each missing from `mcp-host.ts` today and added in M4.3 without changing the helper's behaviour: the token is 32 random bytes from `node:crypto`, made when the session starts, never written anywhere but the session's `mcp.json`, and never used again after the session ends or the app restarts; tokens are compared with `timingSafeEqual`; a request whose `Host` header is not `127.0.0.1:<port>`, or that carries an `Origin` header, is refused, so that a page in an embedded browser tab cannot call the server; request bodies are capped at 1 MB, as `middleman.ts` does. |
| Session files | Settings, hooks, the MCP configuration and the token are outside the Space, in a folder created with mode `0700`, and each file with mode `0600` (**Proposal**). The token is valid for the life of the session; the session's folder is deleted when the session ends. |
| Paths | Every path that comes from the renderer, from a session request, from the manifest or from a v0.8 source goes through `safeJoin` against its base. `safeJoin` resolves symbolic links with `realpath` on the base and on the joined path (for a path that does not exist yet, on its nearest existing parent) and checks containment after resolving, not on the text of the path. The write-guard script applies the same rule in Python (section 5.6). A manifest entry `name` must match `^[A-Za-z0-9._-]+$` and may not be `.` or `..` (**Proposal**). Archive copying refuses a symbolic link that points outside the source. |
| Running `git`, `gh` and `python3` | Argument arrays through `execFile`, never a shell string, and never `exec` or `shell: true`. The Python scripts start `git` with an argument list and `shell=False`. A value that comes from outside (a branch name, a title, a repository name) is always a separate argument and is preceded by `--` where the command supports it. Branch names are checked with `git check-ref-format --branch`. Issue bodies are passed on standard input (`--body-file -`). |
| Starting an engine (Finding 7) | The existing PTY service builds a shell command string for `zsh -i -l -c`. **Proposal**: the only values a 1.0 session adds to that string are absolute paths the companion generated itself and the fixed tool names of section 5.6; no value from the renderer, the manifest, an issue or a session reaches it; every token goes through the existing `quoteForShell`; a headless test in M4.4 checks the command for a `userData` path that contains a space and a single quote. |
| Tests | No automated test reads or writes this project's Lore folder, its Lore repository, or live GitHub, and none writes the repository under test; section 8.1 gives the rules and the code that enforces them. |
| GitHub credentials | Held by `gh`. The companion has none. |
| The source of a migration | Read functions only; git read commands with `--no-optional-locks`; verified unchanged at the end. |

---

## 6. Coding standards

These describe what the code already does. A deviation is marked.

### 6.1 TypeScript

`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `isolatedModules`, ES2022. No `any`; `unknown` plus a type guard or a zod schema at a boundary. The one accepted cast pattern is the existing one in `registrar.ts` and `preload`, where the contract guarantees the types. Every source file under `packages/` is `.ts` or `.tsx` (project contract). Imports use the `.js` extension in the specifier, as everywhere in the code. Types are declared with `type`, not `interface`, as the code does. String-literal unions, not `enum`. Exported functions have explicit return types. `import type` for type-only imports; in the renderer, always for anything from core.

**Deviation that needs the Human Lead.** M1's check scripts and skeleton generators are files in the Lore that must run from a command line. By the ruling at the top of this document they are Python 3 files using the standard library only, under `packages/spec/lore-1.0/`, and the machine check adds `python3` (section 10.1, question 1). The contract "TypeScript everywhere under `packages/`" names `.js`, `.cjs` and `.mjs` files as violations, and its first sentence says every source file under `packages/` is `.ts` or `.tsx`. The ruling reads the scripts as Lore content and not as source files of the packages, as `packages/spec/process/core/tooling/ai-lore.py` already is. Whether the contract should say so is for the Human Lead. No `.py` file is placed under `packages/core` or `packages/app`; the hook adapters of section 5.6 are text held in a `.ts` module for this reason.

### 6.2 Names and files

Files: `kebab-case.ts` in core and main; `PascalCase.tsx` for a React component, `camelCase.ts` for renderer helpers and hooks (`useXtermSession.ts`), as today. Functions and variables `camelCase`; types `PascalCase`; module constants `UPPER_SNAKE_CASE`. One folder per module in core with an `index.ts` that re-exports its public names; tests mirror it as `test/space/<module>.test.ts`. Doc comments (`/** … */`) on every exported name, saying what it is for; the existing code is thoroughly commented and the same is expected. The project's vocabulary is used in names: `space`, `lore`, `desk`, `payload`, `root`, `claim`, `gate`, `reviewedMark`, `humanLead`. New names do not use `cockpit`, which is the v0.8 app's word, except where an existing mechanism requires it (`CockpitApi`, `COCKPIT_E2E`).

### 6.3 Async

Anything that starts a process that can reach the network, or reads more than a desk record, is `async`. Synchronous file reads are accepted for the small JSON files of the desk and for the existing synchronous git readers. No floating promises: a promise is awaited, returned, or prefixed with `void` with a `.catch` that logs, as `mcp-host.ts` does. GitHub writes are sequential, never `Promise.all`. Timers and watchers have a disposer that the context's teardown calls.

### 6.4 Errors and results

The code today returns tagged unions such as `{ kind: 'ok'; … } | { kind: 'failed'; message }` and `T | { error: string }`. **Deviation, small**: 1.0 code uses one generic form of the same idea, so that handlers and tests treat all results alike:

```ts
type Result<T, E = Failure> = { ok: true; value: T } | { ok: false; error: E };
type Failure = { kind: string; message: string };
```

Existing functions keep their shapes.

### 6.5 IPC

One entry per channel in a contract fragment; argument and result types in the fragment's types file under `shared/ipc/space/`; no channel string written anywhere else; handlers registered through the typed `Registrar`; push channels return an unsubscribe function, which React effects call on cleanup. Types that cross IPC are plain data (no functions, no class instances, no `Map`).

### 6.6 Renderer

Function components with explicit `JSX.Element` return types. State shared between components is in the zustand store; a 1.0 slice is a separate store file under `renderer/src/space/` and does not add fields to `store.ts`. Styling follows the existing components: a `style` object with CSS custom properties from `theme.css`; no CSS framework; a new colour is a new token in `theme.css` in both palettes (dark under `:root`, light under `[data-theme="light"]`; the third theme setting, `system`, picks one of the two). Overlays use the shared primitives in `components/overlay/`. Every interactive element a test needs has a `data-testid`. The renderer never reads a file, never runs a command and never imports a value from core.

### 6.7 Biome and the checks before a phase is reported

`npm run lint` (Biome check) passes with no new suppressions. A developer agent may run `npx biome check --write` on the files it changed; it does not reformat files it did not change.

### 6.8 Commits

Commits are made only when the Human Lead's process allows it; a developer agent does not decide that. When commits are made: one per phase, or one per coherent step inside a phase, never mixing two phases. The message leads with what changed for a user of the app, in plain words, and names internal modules only when they are the change, following the existing history ("Show both repos' git branches in the header and move the save-point picker there"). No AI attribution trailer and no generated-with line: the project's memory records this as the Human Lead's standing instruction, and it takes precedence over any default.

---

## 7. Choices made while building

Stage M1's watch item says: where writing a card forces a choice the product document leaves open, record the choice in the card and list it in the focus's journal trail. The same applies to code phases: a developer agent that meets a point this document does not settle takes the default given in section 10 if there is one, otherwise the smallest choice that keeps the phase's tests meaningful, and lists it under "Choices made" in its phase report. It does not edit this document or the focus.

---

## 8. Testing strategy

### 8.1 No test touches the real project, the real Lore or live GitHub

No automated test reads or writes this project's Lore folder (`.ai-lore-ai-lore-companion/`), its Lore repository, any folder under the developer's home other than through `os.tmpdir()`, or live GitHub. A test may read files of the repository under test, for example the template under `packages/spec/lore-1.0`, and never writes them. These rules are this document's **proposal**; they are enforced in code as follows:

- `core/test/support/temp.ts` creates every folder with `mkdtemp` under `os.tmpdir()` and removes it afterwards, as the existing tests do.
- The real `CommandRunner` refuses to run `gh` when `process.env.AI_LORE_ALLOW_LIVE_GITHUB` is not `1`, and tests never set it. Tests use `FakeGitHub` or a scripted runner.
- The real `CommandRunner`, when `NODE_ENV` is `test` or `AI_LORE_TEST=1`, refuses a `cwd` that is not under `os.tmpdir()`. Both paths are compared after `realpath`, because on macOS `os.tmpdir()` is reached through a symbolic link. In the same mode it refuses `git clone`, `git push` and `git fetch` when the address is not a path under `os.tmpdir()`. Core's and the app's `test` scripts do not set either variable today. `core/test/support/temp.ts` and the fixture builders of section 8.3 set `AI_LORE_TEST=1` when they are loaded, every test that uses the real runner gets its folders from them, and the end-to-end launch passes the variable to the app.
- The check scripts and generators are Python, so the tests that run them need `python3` on the machine that runs the tests. When it is missing those tests fail with a message that says so; they are not skipped.
- End-to-end tests start the app with `--user-data-dir=<temp>`, as `launchApp` already does, and with `AI_LORE_FAKE_GITHUB`.
- `git` in tests is the real `git`, against repositories created in temporary folders, with `user.name`, `user.email` and `commit.gpgsign=false` set per repository, and remotes that are bare repositories in temporary folders.

### 8.2 The levels, and the framework at each

| Level | Framework (existing) | Where | What belongs here |
|---|---|---|---|
| Core unit | `node:test` + `node:assert/strict`, compiled by `tsc` | `packages/core/test/space/*.test.ts` | Pure logic: detection rules, card parsing, layer resolution, claim rules, the dashboard model, plan building, porcelain with a sub-path, install projection, gh argument building with a scripted runner. |
| Core integration | same | same folder, files named `*.int.test.ts` | Real folders and real git in temporary folders, `FakeGitHub`: desk store atomic writes, root changes against a mark, baseline points, scaffold then lore-integrity, create-Space steps including the second run, migration plan, apply, second run, verify. The check scripts and generators run as child processes with `python3`. |
| App headless | `node:test` with the `electron` stub | `packages/app/test/headless/space/*.test.ts` | Each 1.0 IPC register module driven through the existing capturing registrar in `harness.ts`; the session server with a real MCP client over HTTP (as `mcp-host.test.ts` does): routing, token, ticket, pending, answer; session file generation; the `DialogBroker`. |
| Component | vitest + jsdom + Testing Library | `packages/app/test/component/space/*.test.tsx` | Each new screen and dialog with a stubbed `window.cockpit`: welcome, machine check rows, setup progress, the plan screen's table, the header's states, a held target disabled in the dialog, the Dashboard from a snapshot, the Changes panel per root, the baseline picker's four kinds. |
| End-to-end | Playwright Electron, serial | `packages/app/test/space-*.spec.ts` | Few tests, one per gate condition that needs the whole app: open and detect, create a Space, Files window review, migration of the fixture, Dashboard from the fake Project, restart and restore. |

Most tests are at the two core levels, because that is where the logic is and they run in seconds without Electron. The end-to-end level is kept small because it needs a build and runs serially.

### 8.3 Fixtures

Built in code in temporary folders, as `test/fixture.ts` builds its project today.

**Finding.** The app's tests cannot import a file from `packages/core/test/`: the app's `tsconfig.test.json` has `rootDir` set to the app's folder and includes only the app's files, and the core package exports only `dist/index.js`. **Proposal**: the three builders below are in `packages/core/src/space/testing/`, exported from core as `FakeGitHub` is, and take the template folder as a parameter. They are used by core's tests, the app's headless tests and the end-to-end tests. The existing end-to-end files import nothing from core, and core is an ES module package; M3.9 checks that a Playwright spec can import it on the Node version in use and reports if it cannot. The contract "Every public `core/` export has a `node:test`" applies to them. `packages/core/test/support/` holds only what core's own tests need. Core's tests run from `dist-test/test/`, so a test finds `packages/spec/lore-1.0` by walking up from `import.meta.url` to the repository root.

- `makeSpaceFixture(opts)`: scaffolds the real template from `packages/spec/lore-1.0` into a temporary folder, runs `git init`, adds a bare remote, optionally adds repositories under `repos/` (each a clone of a temporary bare repository) with a scripted history: an added, a changed, a deleted and a renamed file, some committed and some not.
- `makeV08Fixture(opts)`: a payload repository with a `.ai-lore-<name>/` folder whose `memory/` is its own git repository, with `memory/workspace.yaml` at `core_version: "0.8"`; `status/status.stack.md` with one in-progress focus with three stages, two paused focuses and one done focus under `archive/`; `status/backlog/` with two backlog files; `journal/live/` with two entries, the newer with a handover section; `blueprint/contracts/` with two project contracts and a `core/` folder; `blueprint/mirror/` with one node; `notepad/` with a product document, an image folder, a critique note and one other note; `save-points/`, `tracks/`, `references/`; a `.claude/` binding in the payload repository. Options produce the variants: `coreVersion: '0.7'` with the manifest in the older location, and a source with uncommitted changes.
- `makePlainRepository()`: a git repository with one commit and no Lore.
- Stage M2's gate names "a copy of this project's v0.8 Lore" as a fixture. An automated test may not read the real Lore, so the automated fixture is `makeV08Fixture`, shaped after this project. The check against a real copy is the manual check "Dry run on a copy" in section 8.6.

### 8.4 What must be tested at which level

Unit: every exported function of `core/src/space` has at least one test with concrete inputs; this is the project's existing contract for core's exports. Integration, without exception: anything that writes a file, runs `git`, or calls the `GitHubPort`. End-to-end: only what cannot be shown below it (windows, routing, restore, the Files window's interaction with a real tree and watcher).

Not automated: anything that needs the real Claude Code engine, live GitHub, the real project, or a week of use. Each has a named manual check in section 8.6.

### 8.5 Coverage

No coverage tool is configured today. **Proposal**: measure core with Node's built-in `--experimental-test-coverage` (no new dependency) and report it in each phase report. Expectations: `core/src/space`, 85% of lines and every exported function tested; `app/src/main/space`, every IPC handler and every session-server tool has a headless test for its success and for one refusal; `renderer/src/space`, every screen and dialog has a component test for its main state and one error state. The percentages are reported, not enforced by the build, until the Human Lead decides otherwise.

### 8.6 The focus's gate, condition by condition

| Gate condition | Automated | Manual check |
|---|---|---|
| **Detects** | Core integration: `detectFolder` on the three fixtures plus the v0.7 variant. End-to-end, with detection routing turned on (section 2.4): opening each fixture shows the Space window (M3.9), the not-a-Space screen (M3.9), and the migration screen (M6.6). | — |
| **Migrates** | Core integration on `makeV08Fixture` with `FakeGitHub`: the plan's counts; after apply, the Space opens under `detectFolder`, lore-integrity passes, the fake Project holds the expected issues and sub-issues, every archived file's hash equals its source's, both source repositories have the same head and status as before; a second apply creates no repository, Project or issue; the v0.7 variant is told to upgrade with the reason. End-to-end: the plan screen, confirm, the finished screen. | "Dry run on a copy": the Human Lead copies this project's folder to a temporary place and opens the copy; the plan screen's counts are read against the real tree. No GitHub write happens at the plan screen. "Rehearsal": migrate the copy into a throwaway GitHub repository and Project, inspect, delete them. Both need the Human Lead. |
| **Installs** | Core integration: after create-Space on a fixture, the Lore has the core and default sets; the plugin folder has one skill per resolved verb and process and one copied check per contract with a check; after migration it also has the project's contracts and mirror. | "Skills listed": a real Claude Code session started by the companion in a test Space lists the `/lore:` skills. Needs the real engine. |
| **Guards** | Core integration: the write-guard script, run as a child process against desk records written by the store, refuses `lore/` and `repos/` in Read only with a message naming the mode, allows the Workbench, allows inside the claim, refuses another repository, the Lore and another branch. Core unit: a second session asking for a held repository is refused. Headless: `request_writing` and `request_gate` through a real MCP client produce a ticket, a pending answer, then the answer; the claim and the gate answer are in the desk's files with process, step and answer. Headless: the hook adapter, fed Claude Code's JSON on standard input, exits 2 with the reason, also when started from a working directory that is not the Space. | "Real session is guarded": in a test Space, a real Claude Code session is asked to edit a file under `repos/` in Read only and is refused; asks for Writing; the dialog appears; after confirming, an edit inside the claim succeeds and one outside is refused; a gate is asked and answered. Needs the real engine. |
| **Works** | — | The end-to-end item of M8, done by the Human Lead with a session in the real Space. |
| **Shows** | Core unit: the dashboard model from snapshots, including a snapshot with a sixth Stage value giving a sixth column, a pending gate under Needs you, a stale session. Headless: a session entering Writing creates its issue in `FakeGitHub` and appears in the next snapshot. End-to-end: the Dashboard from the fake Project; with the fake set to unreachable, the cache is shown with its age. | "Live Project": with the real Project, add a Stage value on GitHub and refresh. Needs live GitHub. |
| **Reviews** | Core integration: for a repository with uncommitted, committed-since-mark and renamed files, the changes equal what `git` reports; after a mark, only the uncommitted remain. End-to-end: the Changes panel lists them, Mark as reviewed clears the committed ones, a diff pinned to a session close, and one pinned to a merged pull request served by `FakeGitHub`, do not move the baseline, the selected root, baselines and open documents come back after a restart, the Workbench root says it has no change tracking. | — |
| **The switch** | — | The working week, the merged item with its report, and the v0.8 folder still opening, all in M8 and all the Human Lead's. |
| **Non-goals are recorded** | — | In M8, the Human Lead confirms the list in the Space (issues or a note) against section 1.4. |

### 8.7 Definition of done for a phase

A phase is done when all of the following hold, and the phase report shows the command output for each:

1. `npm run build -w @ai-lore-companion/core` and `npm run typecheck -w @ai-lore-companion/app` pass.
2. `npm run lint` passes.
3. `npm test` passes: core's `node:test` suite, the app's headless suite, the app's component suite. No existing test was deleted or skipped.
4. For a phase that changes main, preload or renderer: `npm run e2e` passes, including the existing `cockpit.spec.ts`.
5. The tests the phase lists in section 9 exist and pass.
6. The report lists the files touched, the choices made under section 7, and any manual check the phase leaves for the Human Lead.
7. Nothing outside the phase's listed files was changed, except as reported.

Before M1 starts, one run of steps 1 to 4 on the unchanged repository records the starting state, so that a failure that exists today is not attributed to a phase. This document's author did not run the suites.

---

## 9. Work breakdown

Each phase is sized for one developer agent, one to three hours. "Parallel" means the phase may run at the same time as the other phases of its stage that are marked parallel, once its own dependencies are done, and that it touches no file they touch. A phase marked "No" does not run at the same time as another phase of the same package; a core phase and an app phase may run at the same time when their dependencies allow. "Human or live" marks a step where the orchestrating session must stop: it needs the Human Lead, the real Claude Code engine, live GitHub, or the real project.

Files that several phases need, and the phase that owns each. A phase that does not own a file does not edit it; it lists the lines it needs added in its report, and the orchestrating session has the owner's agent, or the next phase that is not parallel, add them.

| Shared file | Owner | What others do |
|---|---|---|
| `core/src/index.ts`, `core/src/space/index.ts`, and the empty `index.ts` of every folder under `space/` | M2.1 creates them all. After M2.1, the `index.ts` of a folder belongs to the first phase listed for that folder in section 2.3 | A parallel phase that adds a file to another phase's folder reports the export line; its tests import the file directly |
| `packages/core/package.json`, `packages/app/package.json`, the root `package.json`, `package-lock.json` | No phase adds a dependency without reporting it first. `app/package.json` is edited by M3.9 only (`build.extraResources`) | Report the need |
| `packages/spec/package.json` | M1.1 | — |
| `app/src/shared/ipc/contract.ts`, `app/src/shared/ipc.ts`, `app/src/main/ipc/index.ts`, `app/src/main/ipc/types.ts`, `app/src/main/index.ts`, `app/src/renderer/src/App.tsx` | M3.5, which creates for every feature an empty contract fragment, an empty types file, an empty register module and a placeholder screen component | Fill the feature's own files; report any line needed in the owner's files |
| `lore-1.0/lore/index.md` and each part's `index.md` | M1.1 creates them. Each of M1.2 to M1.6 owns the indexes inside its own part only | M1.7 corrects what is left |
| `core/test/support/*` | M2.1 | Report the need |

All phases also need the Human Lead's confirmation to write into the project at all; that is the methodology's rule and is not repeated per phase. For this run the rulings at the top of this document record that confirmation and the verbs it covers. Developer and tester agents run with the project root as their working directory (Finding 5).

### M1 — the Lore's content (`packages/spec/lore-1.0/`)

| Id | Phase | Depends on | Output and files | Tests | Parallel | Human or live |
|---|---|---|---|---|---|---|
| M1.1 | Tree, `ai_readme.md`, indexes, card shapes | — | The folder tree with every `index.md`; `ai_readme.md`; `lore/space.md` template; the frontmatter keys of the five kinds, written as the corpus entries "card" and "frontmatter" and one example card per kind; the frontmatter subset of section 5.5, stated in the entry "frontmatter"; `gitignore.template`; `packages/spec/package.json` `files` | `core/test/space/lore-template.test.ts`: every folder has an index listing exactly its children; every card's frontmatter parses. The test reads the template in place, writes nothing, and imports nothing from `test/support/`, so M1.1 does not wait for M2.1 | No (first in M1; may run at the same time as M2.1) | No |
| M1.2 | `corpus/core/` | M1.1 | One entry per term the product document defines (its lists under each pillar and "the parts") | Covered by M1.1's test | Yes | No |
| M1.3 | `verbs/core/` and `verbs/default/` | M1.1 | The five authoring verbs; the seven default verbs. `session-orient`, `session-close` and the verbs that enter Writing name the tools of section 4.3 | Covered by M1.1's test | Yes | No |
| M1.4 | `processes/default/` | M1.1 | `specify`, `plan`, `work`, with steps and gates in frontmatter; `processes/core/` empty with its index | Covered by M1.1's test | Yes | No |
| M1.5 | `contracts/core/` and the three check scripts | M1.1; M2.1 (for `test/support/`); the desk file format of sections 3.4 and 4.2. Question 1 of section 10.1 is answered by the ruling: Python 3 | Five cards; `write-guard`, `lore-integrity`, `journal-append-forward` each with a Python 3 check script (standard library only, its own frontmatter parser, no shell when it starts `git`) with the command line and the path rule of section 5.6; `spec-before-breakdown` and `stage-gate` rule only and saying so | `core/test/space/checks.int.test.ts`: each script run with `python3` as a child process, against a temporary Space and desk records written by the test as JSON files in the format of section 4.2, refuses what it should and allows what it should, including a symbolic link from `workbench/` into `lore/`, and a start from a working directory that is not the Space | Yes | No |
| M1.6 | Mirrors and skeleton generators | M1.1; M2.1 (for `test/support/`); question 1 answered by the ruling: Python 3 | `mirrors/publish.md` with the writing rules and a placeholder for sections; the generator for folders and the generator for repositories (from the default branch), both Python 3 with the standard library only, under `mirrors/generators/` | `core/test/space/generators.int.test.ts`: both generators run with `python3` on temporary folders and repositories; the output is the same between two runs | Yes | No |
| M1.7 | Whole-template check | M1.2 to M1.6 | Fixes to indexes and references | The lore-integrity script passes over a copy of the template that the test makes in a temporary folder (M3.3's scaffold does not exist yet) | No | **Yes**: "A fresh Claude Code session orients from `ai_readme.md` and states the processes, verbs and contracts" needs the real engine. The Human Lead also reads the content at the stage gate. |

### M2 — the 1.0 core library (`packages/core/src/space/`)

| Id | Phase | Depends on | Output and files | Tests | Parallel | Human or live |
|---|---|---|---|---|---|---|
| M2.1 | Groundwork | — | `space/index.ts` re-exporting every planned subfolder (each created with an empty `index.ts`); `result.ts`; `exec/` (runner, live-system guard, `GitPort`); `fs/`; `layout/`; `testing/` with `makePlainRepository` (section 8.3); `test/support/` (temp folders, temp git); the export line in `core/src/index.ts` | Unit for `safeJoin`, atomic write, the guard refusing `gh` and a `cwd` outside the temp folder; integration for `GitPort` | No (first) | No |
| M2.2 | Manifest, detection, fixtures | M2.1, M1.1 | `manifest/`, `detect/`, and in `testing/` (which M2.2 owns after M2.1) `makeSpaceFixture` and `makeV08Fixture` | The three fixtures plus the v0.7 variant; malformed manifests | Yes | No |
| M2.3 | The Lore reader | M2.1, M1.1 | `lore/` | Own replaces default by name; a file that takes a core name is reported and not used; unparsable frontmatter reported | Yes | No |
| M2.4 | The desk's records | M2.1 | `desk/` | Atomic write under interruption (a temporary file left behind is ignored); unknown fields kept; corrupt file set aside; owner file | Yes | No |
| M2.5 | Roots and changes per root | M2.2 | `roots/` (`resolveRoots`, `readChangesIn`, `RootTracker`) | Against real git: added, changed, deleted, renamed, against a mark (the test passes the mark's commit; reading a mark from the desk is M2.6); a sub-path root; the Workbench untracked; debounce | No | No |
| M2.6 | Baseline points | M2.4, M2.5 | `baseline/` with a `MergedPullRequestSource` parameter | The four kinds merged and ordered; commits grouped under a session; first-seen as the default; source unreachable | No | No |

M2.2, M2.3 and M2.4 run in parallel after M2.1. M2 can start as soon as M1.1 is done; it does not wait for the rest of M1. M2.1 and M2.4 do not depend on M1 at all.

### M3 — setup and install

| Id | Phase | Depends on | Output and files | Tests | Parallel | Human or live |
|---|---|---|---|---|---|---|
| M3.1 | `GitHubPort`, the `gh` adapter, `FakeGitHub` | M2.1 | `github/` | Adapter: argument arrays and parsing with a scripted runner and recorded JSON; fake: behaves as the port's contract says, including create-then-find and unreachable. Also answers the open point on Project views | Yes | **Live, read-only, optional**: recording real `gh` JSON samples needs a signed-in `gh`; samples can be written by hand from GitHub's documentation instead |
| M3.2 | The machine check | M2.1 | `machine/`: `git`, `gh` signed in with the `project` scope and how to add it, an engine from the registry present and signed in, and `python3` at a 3.x version (the ruling at the top of this document; section 5.8) | Scripted runner for each state of each of the four requirements | Yes | No |
| M3.3 | Step runner, scaffold, create a Space, adopt, open by address | M3.1, M3.2, M3.4, M2.2, M2.4, M2.5, and the automated part of M1.7 (the steps of section 5.8 call the machine check, the install, `FirstSeen` and the roots; the mirror step runs M1.6's generator with `python3`) | `steps/`, `setup/` | Integration with `FakeGitHub`: a pushed repository, a Project with five stages, the scaffolded Lore passing lore-integrity; killed after the repository is created, a second run finishes and creates no second repository or Project | No | No |
| M3.4 | Install into Claude Code | M2.3 | `install/` | Projection from a fixture Lore: one skill per resolved card, own replacing default, the Python check scripts copied unchanged (same hash), `install.json`. The projection writes no hook; hooks are per session and are M4.4's | Yes | No |
| M3.5 | App groundwork | M2.2 | For every feature of section 2.3: an empty contract fragment and types file under `shared/ipc/space/`, an empty register module under `main/space/ipc/`, and a placeholder screen component under `renderer/src/space/`; the fragments spread into `CONTRACT`, the modules added to `MODULES`, the placeholders rendered by `App.tsx`; all new window modes with their types; `main/space/context.ts`, `windows.ts`, `log.ts`; routing by detection in `main/index.ts` behind the switch of section 2.4; `Deps`; the not-a-Space screen; the "Open in the v0.8 cockpit" action | Headless: routing for the three fixtures with the switch on, and today's routing with it off; component: not-a-Space screen. The existing end-to-end suite passes unchanged | No (owns the shared app files) | No |
| M3.6 | Welcome and machine check screens | M3.5, M3.2 | `renderer/src/space/{welcome,machine}`, `main/space/ipc/machine.ts` | Component: each state, check again | Yes (with M3.7) | No |
| M3.7 | Create-a-Space screens | M3.5, M3.3 | `renderer/src/space/setup`, `main/space/ipc/setup.ts` | Component: form validation, progress, failed step and run again | Yes (with M3.6) | No |
| M3.8 | The Space window | M3.5 | Header, rail (Dashboard placeholder, Sessions, Files, Search), Sessions hosting the existing dock workspace | Component: rail; end-to-end: a fixture Space opens, a shell tab runs | No | No |
| M3.9 | Template packaging and end-to-end | M3.6 to M3.8, M3.4 | `template-dir.ts`, `build.extraResources` (the `.py` files of the template are packaged with it); `test/space-setup.spec.ts` | End-to-end, with detection routing on: create a Space with `FakeGitHub`; open a plain repository and get the offer; open a fixture Space and get the Space window | No | **Yes**: "Create a real Space" against live GitHub, and "Skills listed" with the real engine, are manual checks of the M3 gate |

### M4 — Sessions and guards

| Id | Phase | Depends on | Output and files | Tests | Parallel | Human or live |
|---|---|---|---|---|---|---|
| M4.1 | Investigation: what Claude Code enforces | M3.4 | A short written result: `--settings` with hooks and permissions, the hook's input and refusal, `--plugin-dir`, the MCP idle limit, whether sandbox settings can follow a changing claim, that a hook command of the form `python3 "<absolute path with a space>"` runs from any working directory, which `Host` and `Origin` headers the engine's MCP client sends (section 5.14), and whether the allow list of section 5.6 lets the default verbs run | None | Yes (with M4.2) | **Yes**: runs the real engine, in a temporary Space, never in this project |
| M4.2 | Claim rules and the session records | M2.4 | `claims/`; session lifecycle functions in `desk/` | Unit: every rule of section 3.4, including a second session refused a held repository | Yes (with M4.1) | No |
| M4.3 | The session server | M4.2 | `mcp-host.ts` tool parameter; `main/space/session-server/` (broker, tools) | Headless with a real MCP client: token, ticket, pending, answer, unknown ticket; the refusals of section 5.14 (wrong token, unknown session, wrong `Host`, an `Origin` header, a body over the cap); the existing `mcp-host.test.ts` passes unchanged | Yes (with M4.1; it follows M4.2) | No |
| M4.4 | Starting a session | M4.1, M3.4, M4.3, M1.5 | `main/space/sessions/` (files, arguments, the text of the two Python hook adapters), `pty.ts` spawn options, `main/space/ipc/sessions.ts` | Headless: generated files, their modes, and arguments; the command line for a `userData` path with a space and a single quote (section 5.14); an adapter run with `python3` as a child process with Claude Code's JSON, from a working directory that is not the Space, against M1.5's scripts; refusal names the mode; a missing script is refused and named | No | No |
| M4.5 | The two dialogs | M4.3, M3.8 | `renderer/src/space/dialogs`, `main/space/ipc/dialogs.ts` | Component: held target disabled, GitHub unreachable notice, the three gate answers; headless: the answer reaches the broker and the desk | Yes (with M4.6) | No |
| M4.6 | Session header and Skills column | M4.4, M3.8 | `renderer/src/space/{session-header,skills}`, edits in `AiTab.tsx`, `tabKinds.tsx` | Component: header states, Leave Writing, a restored tab stays dormant in a Space window; end-to-end: a terminal tab moved to another group keeps its process in a Space window (section 5.7). M4.6 extends `main/space/ipc/sessions.ts`, which M4.4 created; M4.5 does not touch it | Yes (with M4.5) | No |
| M4.7 | The Agents board on GitHub | M4.2, M3.1, M4.4, M4.5 (it adds calls to the confirm and leave paths those phases wrote) | Session issue created at first Writing with its targets and branch, moved between columns, Done with the handover at close; `developBranch`; failure reported when unreachable. **Proposal**: the functions are in `core/src/space/project/session-issue.ts`, and M4.7 owns `project/index.ts` until M7.1 takes it over; M4.7 and M7.1 do not run at the same time | Headless with `FakeGitHub`: the issue exists on the fake Project with its targets and ends in Done at close; with the fake unreachable the claim is still granted and the answer says the update failed | No | No |
| M4.8 | The gate's integration tests | M4.4 to M4.7 | Tests for every line of the M4 gate | As section 8.6, Guards | No | **Yes**: "Real session is guarded" |

### M5 — the Files window on roots

| Id | Phase | Depends on | Output and files | Tests | Parallel | Human or live |
|---|---|---|---|---|---|---|
| M5.1 | Roots in main | M2.6, M3.8 | `main/space/ipc/roots.ts` and its contract fragment with every root channel the later M5 phases use (list, changes, set baseline, mark reviewed, baseline points, diff, file history), watchers and tracker per root in the context | Headless: list, changes, set baseline, mark reviewed, baseline points with the fake unreachable | No | No |
| M5.2 | The Files window, roots as tabs, the tree | M5.1 | `windows.ts`, `renderer/src/space/files/`; M5.2 owns the window's layout component and creates a placeholder file for the Changes panel, the baseline picker and the editor, which M5.3, M5.4 and M5.5 each replace | Component: tabs with counts, the Workbench notice; end-to-end: Open in Files | No | No |
| M5.3 | Changes panel and Mark as reviewed | M5.2 | Changes panel per root, filter, index-files switch | Component and end-to-end per the M5 gate | Yes (with M5.4, M5.6) | No |
| M5.4 | The baseline picker | M5.2 | Four kinds, commits grouped under their session, merged pull requests omitted with a reason when unreachable | Component | Yes | No |
| M5.5 | Editor and per-file history | M5.3, M5.4 | Diff pinned to a point without moving the baseline | Component; end-to-end: a diff pinned to a session close and one pinned to a merged pull request from `FakeGitHub`, the root's baseline unchanged after each | No | No |
| M5.6 | Search grouped by root | M5.2 | `main/space/ipc/files.ts` search, dialog grouping | Headless; component | Yes | No |
| M5.7 | What is remembered | M5.5 | `ui/` files; restore | End-to-end: restart restores documents, modes, pins, root, baselines | No | No |

### M6 — migration from v0.8

| Id | Phase | Depends on | Output and files | Tests | Parallel | Human or live |
|---|---|---|---|---|---|---|
| M6.1 | The v0.8 reader | M2.2 | `legacy/` | Integration on `makeV08Fixture` and its variants; the source's head and `git status` are the same before and after every read | Yes (it needs only M2.2, so it may run while M3 to M5 are built) | No |
| M6.2 | The plan | M6.1, M3.3 | `migrate/plan.ts` with the full list of steps, and one file per step under `migrate/steps/`, each created with its `describe` and an empty `run`; M6.2 owns `migrate/index.ts` | Counts and destinations for the fixture; nothing written, locally or on the fake | No | No |
| M6.3 | Apply: local steps | M6.2 | The step files of steps 1 to 10 and 12 of section 5.9: archive copy, pointer, contracts, mirror, Workbench, corpus entry | Integration: hashes equal, lore-integrity passes, second run changes nothing | Yes (with M6.4) | No |
| M6.4 | Apply: GitHub steps | M6.2, M3.1 | The step file of step 11 of section 5.9 and the ledger: issues, sub-issues, labels, pacing, markers | Integration with `FakeGitHub`: expected issues, second run creates none, ledger deleted and second run still creates none, a rate-limited answer is waited for | Yes (with M6.3) | No |
| M6.5 | The migration screen | M6.2, M3.5 | `renderer/src/space/migration`, `main/space/ipc/migration.ts`, the older-than-v0.8 state | Component; headless | Yes | No |
| M6.6 | Verify and the gate's tests | M6.3 to M6.5 | `migrate/verify.ts`; `test/space-migration.spec.ts` | As section 8.6, Migrates | No | **Yes**: "Dry run on a copy" and "Rehearsal" |

### M7 — the Dashboard

| Id | Phase | Depends on | Output and files | Tests | Parallel | Human or live |
|---|---|---|---|---|---|---|
| M7.1 | Reading the Project, the cache, the refresh | M3.1, M2.4 | `project/cache.ts`, `readProject` query, `main/space/project-refresh.ts` | Unit: parsing; headless: timer, focus, on demand, one at a time, unreachable keeps the cache | Yes | No |
| M7.2 | The dashboard model | M3.1 (the `ProjectSnapshot` type is declared in `github/` with `readProject`), M2.4 (the `SessionRecord` type) | `project/dashboard-model.ts` | Unit, as section 8.6, Shows | Yes | No |
| M7.3 | Focuses by Stage and the focus sheet | M7.1, M7.2, M3.8 | `renderer/src/space/dashboard`; M7.3 owns the Dashboard's container component | Component | Yes (with M7.4) | No |
| M7.4 | Agents board, Needs you, start a session | M7.1, M7.2, M4.5, M4.7 | Same folder, its own files; M7.4 does not edit the container and reports the lines that mount its parts | Component; headless: a pending gate opens the gate dialog; a session that enters Writing is on the Agents board after the next refresh of the fake Project | Yes (with M7.3) | No |
| M7.5 | Offline and end-to-end | M7.3, M7.4 | `test/space-dashboard.spec.ts` | End-to-end with the fake reachable and unreachable | No | **Yes**: "Live Project" |

M7.1 and M7.2 depend only on M3.1 and M2.4, so they can be built while M5 and M6 are in progress, although the focus orders the stages M5, M6, M7. They do not run at the same time as M4.7, which writes in the same core folder. M7.1 owns `project/index.ts`; M7.2 reports its export line.

### M8 — the switch

The stage has no code of its own. Every step needs the Human Lead or a live system, and the orchestrating session stops before each.

| Id | Step | Needs |
|---|---|---|
| M8.1 | Rehearsal on a copy into a throwaway repository and Project, if not already done in M6.6 | Human Lead, live GitHub |
| M8.2 | Migrate this project into the Space that will be its home | Human Lead, live GitHub, the real project |
| M8.3 | Work one item end to end: removing the v0.8 Claude binding from the companion repository | Human Lead, the real engine, live GitHub |
| M8.4 | Archive the v0.8 tree: a final journal entry pointing at the Space; the old Lore repository set read-only on GitHub | Human Lead |
| M8.5 | Record the non-goals in the Space | Human Lead |
| M8.6 | The working week | Human Lead |
| M8.7 | Close the focus from the 1.0 side | Human Lead (the Done call) |

What M8 finds goes back to the stage that owns it, as the stage file says.

---

## 10. Risks, and questions the documents do not settle

### 10.1 Questions for the Human Lead

Each has a default so that work can proceed; the default is a proposal.

1. **The language and runtime of the check scripts and skeleton generators.** They are files in the Lore, run by the engine's hooks and from a command line. The sources name three things the machine must have: `git`, `gh` and an engine. Options: (a) dependency-free JavaScript modules, run by hooks through the companion's own binary with `ELECTRON_RUN_AS_NODE=1` so that no separate Node is needed, and with `node` on a command line; this needs an exception to the contract "TypeScript everywhere under `packages/`" for Lore content. (b) Python 3 with the standard library only, as v0.8's guard hook and `ai-lore.py` are; this adds `python3` to what the machine must have. **Answered for this run by the ruling at the top of this document: (b).** Sections 5.5, 5.6, 5.8, 6.1, 8 and 9 follow it. The Human Lead can reverse it; reversing it changes M1.5, M1.6, the adapters of M4.4, the fourth row of the machine check in M3.2, and the tests that run the scripts. The architect's draft gave (a) as its default.
2. **Opening a v0.8 project in the cockpit from a 1.0 build before M8** (section 2.4). Default: the action is offered until the switch.
3. **The archive and the Lore repository's `.git` folder.** "Copied as it is" and "byte-identical to the source tree" are read here as: every file of the working tree, without `.git`. Whether files ignored by the source's `.gitignore` (for example `.DS_Store`) are copied is not said. Default: copied, since the comparison is over files on disk.
4. **A source with uncommitted changes.** Default: the plan screen says so and the Human Lead may continue; the working tree is what is copied.
5. **The Stage of the migrated in-progress focus.** v0.8 has `draft`, `paused`, `in progress`, `done`; the Project has Spec, Plan, Build, Review, Done. Default: a choice on the plan screen, preselected to Build.
6. **What a backlog item is.** v0.8 keeps backlog as files, each of which may list several entries. Default: one issue per backlog file, linking to the archived file. With this default this project gives about thirteen issues, close to the stage's "about fifteen".
7. **The project's own verbs.** The gate's Installs line names "this project's own contracts, mirror and verbs". The mapping has no row for verbs, places project processes in the archive only, and this project's `blueprint/verbs/` holds only `core/`. Default: no verb is carried.
8. **The description for the Space's corpus entry.** The v0.8 manifest holds only the project's name. Default: a field on the plan screen that the Human Lead fills.
9. **Where the pointer to the old folder and repositories is written.** Default: `publish/archive/index.md`.
10. **How the Agents board's four columns are represented on the Project**, and the label that marks a session issue (section 3.6).
11. **A write to a path that is neither Lore, payload nor Workbench** (section 5.6). Default: refused.
12. **Whether a second running instance of the app may write desk records** (section 5.4). Default: no.

Questions 13 to 18 were added by the review of this document. The ruling at the top covers questions 2 to 12 only, so the orchestrating session or the Human Lead still has to accept these defaults.

13. **How detection routing and today's routing live side by side until M8** (Finding 6, section 2.4). Default: the environment variable `AI_LORE_SPACE_ROUTING=1` turns detection routing on; without it the app routes as today; the versioning contract is changed by the Human Lead at M8.
14. **Where the text of the Claude Code hook adapters is kept** (section 5.6). Default: a constant in a TypeScript module of `main/space/sessions/`, written out per session. Alternative: a static `.py` file shipped with the template.
15. **How Read only is enforced for file edits** (section 5.6). Stage M4 says deny-writes settings as the helper has; the product document lets a Read only session write the Workbench. Default: the file-writing tools stay available and the write-guard hook refuses by path.
16. **How `contracts.spec.md`, which holds five contracts in one file, is carried** (section 5.9, step 6). Default: one card per source file, so it becomes one card; the three `*.contract.md` files become one card each.
17. **Whether leaving Writing is refused while the Lore fails lore-integrity** (section 5.6). The product document says the session "must fix it before leaving Writing". Default: not refused in the MVP; the failure is reported to the session by the after-write hook.
18. **Whether the contract "TypeScript everywhere under `packages/`" should name Lore content under `packages/spec` as outside its scope** (section 6.1). Default: the contract is left as it is for this run and the Python files are placed only under `packages/spec/lore-1.0/`.

### 10.2 Risks

| Risk | Effect | What the design does |
|---|---|---|
| Shell commands are limited by permission rules that match by prefix | A session can write outside its claim through the shell | Stated in the UI and in the write-guard card; M4.1 investigates the sandbox settings; the allow list is short and everything else asks |
| The facts about Claude Code in sections 4.3, 5.5 and 5.6 come from its documentation as read on 2026-09-18, not from a test | A flag or a limit may behave differently | M4.1 runs before M4.4 depends on them; the `DialogBroker`, the install projection and the session files are each behind one module |
| `python3` is missing or is not a 3.x version on the Human Lead's machine or on a colleague's | Every hook refuses, so no session can write any file with the engine's file-writing tools | The machine check tests for it; the adapter's refusal names the cause; the ruling is reversible (question 1) |
| A shell command that gets past the permission rules writes a desk record | A claim or a gate answer that the Human Lead did not give | Stated in sections 5.4 and 5.6; M4.1 investigates the sandbox settings, which could deny writes to the data folder |
| A hook that cannot find its script stops every write (Finding 5) | Agents, or sessions, are stopped for a reason unrelated to the rule | Absolute paths in every generated hook; the adapter names the missing script; a headless test runs the adapter from another working directory; agents run from the project root |
| Project views may not be creatable through the API | Setup cannot create the three views | M3.1 checks; fallbacks in section 5.3; the M3 gate does not require views |
| A development build and an installed build share `userData` | Two instances grant the same target, or an older build drops fields | New files only; unknown fields kept; the owner file |
| The Space folder is moved | The desk's records, marks and UI state are not found | Accepted for the MVP; stated in section 3.1; a change of key rule is confined to `layout/` |
| The existing components take a two-value scope | More renderer work in M5 than "reuse" suggests | Finding 2; M5 phases sized for it; variants instead of edits to v0.8 components |
| GitHub limits on content creation | A large migration is slowed or refused | Sequential, paced, resumable by markers and ledger, warning above 400 issues |
| The existing suites' state was not checked for this document | A failure that exists today is blamed on a phase | The starting-state run in section 8.7 |
| Node's coverage flag is experimental | The numbers may change between Node versions | Reported, not enforced |
| M1 is prose the Human Lead reads sentence by sentence | Rework late in the stage | M1.1 first and small; the Human Lead can read M1.1 before M1.2 to M1.6 are written |

### 10.3 What this document did not do

It did not run the tests, the build or the app. It did not call GitHub. It did not read the design mock-ups beyond what the product document says about them. It read the consultant's report in the critique note only for the Human Lead's decisions at its head.
