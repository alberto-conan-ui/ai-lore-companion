# First-run onboarding — technical design and phase specifications

Written 2026-09-19 by the architect of the unattended run, for stage M9 "Onboarding and the first session" of the focus `mvp-ai-lore-1-0`. Status: not reviewed by the Human Lead.

Inputs, in order of authority:

1. `onboarding-product.md` and its section 10 (CTO rulings): what the flow does.
2. `onboarding-ux.md` and its CTO rulings: how the screens look and read.
3. `onboarding-plan-diagnosis.md`: the cause of the slow plan and the fixes, all accepted, and the verdict to keep the uncommitted `missingIsNull` change in `packages/core/src/space/github/gh-cli.ts`.
4. `.ai-lore-ai-lore-companion/memory/notepad/mvp-manual-check-feedback.note.md`: the Human Lead's eight findings.
5. `mvp-architecture.md`: the architecture, the coding standards (section 6), the testing strategy (section 8) and the definition of done for a phase (section 8.7). Every phase of this document follows them unless a phase says otherwise.

Part A is the design. Part B lists the decisions this document makes where the inputs differ or are silent. Part C is one specification per phase. A developer builds one phase from Part C, reading Part A for the types and names it refers to.

---

## Part A — Design

### A.1 What changes, in one list

| Area | Change | Phase |
|---|---|---|
| GitHub calls in core | The missing-field fixtures model GitHub's real answer; the port gains `branchHeads` and `listSpaceRepositories`; `git ls-remote` is no longer used; `git clone` and `git push` have time limits and never prompt | M9.1 |
| Setup plan in core | Lookups are cached for one plan or run, including "not found" and failures; a failed lookup stops the plan; the two GitHub lookups run at the same time; the plan reports each check as it runs; the plan says whether the Space is complete; the report carries the view settings with links; a local check of an existing Space for the form | M9.2 |
| Engines and machine check in core | The engine catalog; sign-in checks for Codex CLI and OpenCode; the machine check reports every catalog engine with an installed state and a signed-in state, the GitHub account and its organisations, and whether Homebrew and npm are present; the `engine` requirement is Claude Code; the setup commands and the device-code reader; the `spaces.folder` setting | M9.3 |
| Main: engines and machine report | `engines.json` is merged with the catalog once and catalog engines cannot be removed; the machine report carries the Spaces folder, the set-up readiness, the commands and the owners; the Spaces folder channels | M9.4 |
| Main: command panel and routing | Running a setup command in a PTY of the window; the one-time code and the exit pushed to the renderer; the launch opens Set up this computer when it is not ready; the Space window can open Set up this computer; "Space from a repository" from the welcome screen | M9.5 |
| Main: setup channels | A time limit per `gh` call and a log line per `gh` and network `git` call; plan progress pushed; a time limit on the plan; the Location from the setting; the owners; the existing-Space check while typing; choosing the repository folder; the list of Spaces of an owner; opening a complete Space; the last owner remembered; the form kept after an interrupted run | M9.6 |
| Main: session engine | The engine of a Space session is chosen by readiness; readiness checks that the engine is installed and signed in; the pick is remembered per Space; each refusal has a fix | M9.7 |
| Renderer: set up and welcome | Shared styles and parts (command panel, status row, disclosure, step indicator); the Set up this computer screen; the welcome screen | M9.8 |
| Renderer: creating a Space | Three forms with plain labels and the What will be created block; the checking list; the confirmation; the run with state words; the result screens | M9.9 |
| Renderer: first session | The engine start control on the Dashboard and in Sessions; the fixes; the Settings sheet in 1.0 windows with the Spaces section; catalog engines without Remove | M9.10 |
| End to end | The end-to-end suite updated and extended; the full verification | M9.11 |

### A.2 Data flow

```
launch ──► host.launch(null) ──► space-welcome { checkOnLaunch: true }
                                   │ renderer: spaceMachineCheck({ fresh: false })
                                   │   main: checkMachineOfApp(runner with login PATH, engines merged with the catalog)
                                   │         + Spaces folder setting + setUpReadiness + commands + owners (cached)
                                   ▼
                     report.setUp.ready === false ──► spaceNavigate({ to: 'machine-check' })
                                   │
Set up this computer ──(button)──► spaceCommandRun({ commandId }) ──► PTY: $SHELL -i -l -c "<command line>"
        ▲                                   │ onData ──► terminal:data (xterm in the command panel)
        │                                   │           ──► one-time code found ──► space:command-code
        │                                   └ exit ────► space:command-exit ──► renderer asks spaceMachineCheck({ fresh: true })
        └──────────────── Continue (ready) ──► welcome ──► setup window (create | open | from-repository)
                                                              │ spaceSetupValidate ──► problems + existing-Space preview
                                                              │ spaceSetupPlan ──► core plan with onCheck ──► space:setup-plan-progress
                                                              │                 ◄── plan (complete?, names, token)
                                                              │ spaceSetupRun(token) ──► space:setup-progress
                                                              ▼
                                               result ──► spaceSetupOpenSpace ──► Space window { justCreated: true } on the Dashboard
                                                              │ spaceSessionEngines ──► options, engine, refusal with fix
                                                              ▼
                                               Start a Claude Code session ──► spaceSessionStart(engineId)
```

### A.3 The engine catalog (core)

New folder `packages/core/src/space/engines/` with `catalog.ts`, `merge.ts` and `index.ts`, exported from `packages/core/src/space/index.ts`.

```ts
/** The engines the companion knows. The order is the order of every list. */
export type EngineCatalogId = 'claude-code' | 'codex' | 'antigravity' | 'opencode';

/** How the companion asks an engine whether it is signed in. */
export type EngineSignInCheck =
  | { kind: 'claude-auth-status' }                       // `claude auth status --json`, field `loggedIn`
  | { kind: 'exit-code'; args: readonly string[] }       // exit 0 = signed in
  | { kind: 'opencode-auth-list' }                       // at least one provider listed = signed in
  | { kind: 'none' };                                    // the state is "Not checked"

export type EngineCatalogEntry = {
  catalogId: EngineCatalogId;
  /** The id the entry has in `engines.json` and on IPC. */
  engineId: string;
  name: string;
  maker: string | null;
  binary: string;
  /** The macOS install command, run by `$SHELL -i -l -c`. */
  installCommand: string;
  /** A program the install command needs, or null. */
  installNeeds: 'npm' | null;
  signInCommand: string;
  signInCheck: EngineSignInCheck;
  /** Whether the companion can run a guarded Space session with it. */
  guardedSessions: boolean;
  /** Whether Set up this computer is not ready without it. */
  required: boolean;
  /** One line shown under the row, or null. */
  note: string | null;
  /** The maker's page. */
  page: string;
};
```

`ENGINE_CATALOG` holds exactly these four entries, in this order. The commands are the product document's, checked on the makers' pages on 2026-09-19.

| catalogId | engineId | name | maker | binary | installCommand | installNeeds | signInCommand | signInCheck | guarded | required | note | page |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `claude-code` | `default.claude` | Claude Code | Anthropic | `claude` | `curl -fsSL https://claude.ai/install.sh \| bash` | null | `claude auth login` | `claude-auth-status` | true | true | null | `https://code.claude.com/docs/en/setup` |
| `codex` | `default.codex` | Codex CLI | OpenAI | `codex` | `npm install -g @openai/codex` | `npm` | `codex login` | `exit-code`, args `['login', 'status']` | false | false | null | `https://learn.chatgpt.com/docs/codex/cli` |
| `antigravity` | `default.antigravity` | Antigravity CLI | Google | `agy` | `curl -fsSL https://antigravity.google/cli/install.sh \| bash` | null | `agy` | `none` | false | false | null | `https://antigravity.google/docs/cli/install` |
| `opencode` | `default.opencode` | OpenCode | null | `opencode` | `curl -fsSL https://opencode.ai/install \| bash` | null | `opencode auth login` | `opencode-auth-list` | false | false | `Also runs DeepSeek models: choose DeepSeek when signing in.` | `https://opencode.ai/docs` |

The id `default.claude` is the id the app already gives Claude, so a v0.8 project's `lastPicked` keeps working. Gemini CLI is not in the catalog; an existing `default.gemini` entry is kept as a hand-added engine.

Functions of `catalog.ts`:

- `catalogEntryById(engineId: string): EngineCatalogEntry | null` — by `engineId`.
- `catalogEntryFor(engine: EngineEntry): EngineCatalogEntry | null` — by `engine.id` first; otherwise `null`. (A hand-added entry is not treated as a catalog engine after the merge; see below.)
- `isCatalogEngineId(engineId: string): boolean`.
- `canRunGuardedSession(engine: EngineEntry): boolean` — true when `catalogEntryFor(engine)?.guardedSessions === true`, or when `isClaudeEngine(engine)` (a hand-added Claude Code with other arguments).

`merge.ts`:

```ts
/** The engine list with the catalog entries first, and whether it differs from `stored`. */
export function mergeEnginesWithCatalog(stored: readonly EngineEntry[]): { engines: EngineEntry[]; changed: boolean };
```

Rules, in this order:

1. The result starts with one entry per catalog entry, in catalog order: `{ id: engineId, name, binary }`.
2. Each stored entry, in stored order:
   - its `id` is a catalog `engineId`: it is merged into that catalog entry;
   - otherwise, `basename(binary)` equals a catalog `binary` (`.exe` removed, lower case) and that catalog entry has not taken a stored entry yet: it is merged into that catalog entry (this is the Human Lead's removed-and-re-added Claude);
   - otherwise it is appended after the catalog entries as a hand-added engine, unchanged.
3. Merging keeps the stored `args` and `helperModel`, and keeps the stored `binary` when it is an absolute path (a pointed install, which the end-to-end tests use); the `id` and `name` are the catalog's.
4. `changed` is true when the result, written as JSON, differs from `stored` written as JSON.

### A.4 The machine check (core)

Changes in `packages/core/src/space/machine/`.

`types.ts` additions:

```ts
export type EngineInstallState =
  | { kind: 'installed'; version: string | null }
  | { kind: 'missing' }
  | { kind: 'undetermined'; reason: string };

/** `EngineSignInState` gains `{ kind: 'not-checked' }`: the engine has no sign-in check. */
export type EngineSignInState =
  | { kind: 'signed-in' }
  | { kind: 'not-signed-in' }
  | { kind: 'not-checked' }
  | { kind: 'undetermined'; reason: string };

/** EngineCheck gains these fields (the existing fields stay). */
export type EngineCheck = {
  engineId: string; name: string; binary: string;
  state: MachineCheckState; guidance: string | null; command: string | null;   // existing
  catalogId: EngineCatalogId | null;
  maker: string | null;
  required: boolean;
  guardedSessions: boolean;
  installed: EngineInstallState;
  /** `not-checked` also when the engine is not installed. */
  signIn: EngineSignInState;
  installCommand: string | null;
  installNeeds: 'npm' | null;
  signInCommand: string | null;
  note: string | null;
  page: string | null;
};

/** MachineCheck gains two fields. */
export type MachineCheck = {
  requirements: MachineRequirementCheck[];   // existing, still git, gh, engine, python3
  engines: EngineCheck[];                    // existing, one per engine of the list given, in its order
  ready: boolean;                            // existing
  github: { account: string | null; organisations: string[] };
  tools: { brew: boolean; npm: boolean };
};
```

Rules:

- `installed` comes from `<binary> --version` exactly as `versionState` reads it today (no lowest version). `not-found` gives `missing`.
- `signIn` is asked only when `installed.kind === 'installed'`; otherwise it is `not-checked`.
- Sign-in by `signInCheck` of the catalog entry (`probeEngineSignIn` in `engine-sign-in.ts`):
  - `claude-auth-status`: today's probe. A hand-added engine for which `isClaudeEngine` is true is probed the same way.
  - `exit-code`: run `binary` with `args`; exit 0 is `signed-in`; any other exit code with no `failure` is `not-signed-in`; a `failure` is `undetermined` with the reason.
  - `opencode-auth-list`: run `binary auth list`; remove ANSI sequences (`/\x1b\[[0-9;?]*[A-Za-z]/g`); when the text matches `/(\d+)\s+credentials?\b/i`, a number above 0 is `signed-in` and 0 is `not-signed-in`; otherwise, when at least one line matches `/^\s*[●•]\s+\S/`, `signed-in`; otherwise `undetermined` with the reason "`opencode auth list` gave an answer that was not understood". The parser is `parseOpencodeAuthList(stdout: string): boolean | null`, exported for its tests.
  - `none`, and any engine that is neither in the catalog nor Claude Code: `not-checked`.
- `state` of an engine (kept for existing readers): `missing` when not installed, `undetermined` when the install state is undetermined, `not-signed-in` when `signIn` is `not-signed-in`, otherwise `fine` with the version. A sign-in that is `undetermined` or `not-checked` does not make the state other than `fine`.
- The `engine` requirement (`engineRequirement`) is the `EngineCheck` whose `catalogId` is `claude-code`. When the list has none (a caller that passes other engines), today's rule applies unchanged.
- `github.account` is the account `parseGhAuthStatus` read (`reading.account`) when `gh` is signed in, else `null`. `github.organisations` is read only when signed in: `gh api user/orgs --paginate --jq .[].login`, one login per line, trimmed, empty lines dropped, sorted as GitHub returns them; any failure gives `[]`. `checkGh` keeps its signature; a new `checkGitHub(runner, options)` returns `{ requirement, account, organisations }` and `checkMachine` uses it.
- `tools.brew` and `tools.npm`: `brew --version` and `npm --version` through the probe; `true` unless the result's `failure` is `not-found`.
- Everything runs in parallel as today; no new timeout.

New file `set-up.ts`:

```ts
export type SetUpItemId = 'git' | 'python3' | 'gh' | 'github' | 'claude-code' | 'spaces-folder';
export type SetUpReadiness = { ready: boolean; left: { id: SetUpItemId; text: string }[] };
/** Whether Set up this computer is ready. `spacesFolder` is the setting's value when it names an existing folder, else null. */
export function setUpReadiness(check: MachineCheck, spacesFolder: string | null): SetUpReadiness;
```

`left`, in this order, with these exact texts:

| Condition | id | text |
|---|---|---|
| git `missing` | git | `install Git` |
| git `too-old` | git | `update Git` |
| git `undetermined` | git | `check Git` |
| python3 `missing` / `too-old` / `undetermined` | python3 | `install Python 3` / `update Python 3` / `check Python 3` |
| gh `missing` / `too-old` | gh | `install the GitHub CLI` / `update the GitHub CLI` |
| gh `not-signed-in` | github | `sign in to GitHub` |
| gh `missing-scope` | github | `give GitHub access to Projects` |
| gh `undetermined` | github | `check the GitHub sign-in` |
| Claude Code not installed | claude-code | `install Claude Code` |
| Claude Code install state undetermined | claude-code | `check Claude Code` |
| Claude Code `not-signed-in` | claude-code | `sign in to Claude Code` |
| `spacesFolder === null` | spaces-folder | `choose a Spaces folder` |

`ready` is `left.length === 0`.

New file `commands.ts`, the commands Set up this computer and the fixes may run:

```ts
export type SetupCommandId =
  | 'install-command-line-tools' | 'install-gh' | 'update-gh'
  | 'github-sign-in' | 'github-add-project-scope'
  | `engine-install:${EngineCatalogId}` | `engine-sign-in:${EngineCatalogId}`;
export const GH_WEB_SIGN_IN_COMMAND =
  'gh auth login --hostname github.com --web --clipboard --git-protocol https --scopes project && gh auth setup-git';
/** Every command id with its command line. */
export function setupCommands(): { id: SetupCommandId; commandLine: string }[];
/** The command line of `id`, or null when it is not one of `setupCommands()`. */
export function setupCommandLine(id: string): string | null;
/** The GitHub one-time code in `text` (ANSI sequences removed), or null. */
export function parseDeviceCode(text: string): string | null;
```

| id | command line |
|---|---|
| `install-command-line-tools` | `xcode-select --install` |
| `install-gh` | `brew install gh` |
| `update-gh` | `brew upgrade gh` |
| `github-sign-in` | `GH_WEB_SIGN_IN_COMMAND` |
| `github-add-project-scope` | `GH_ADD_SCOPE_COMMAND` (unchanged: `gh auth refresh --hostname github.com --scopes project`) |
| `engine-install:<catalogId>` | the catalog entry's `installCommand` |
| `engine-sign-in:<catalogId>` | the catalog entry's `signInCommand` |

`parseDeviceCode` matches `/one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i` and returns the code in upper case.

### A.5 The Spaces folder setting

`SETTINGS_REGISTRY` in `packages/core/src/settings/settings.ts` gains one entry, after `workspace.restoreLayout`:

```ts
{ key: 'spaces.folder', label: 'Spaces folder', section: 'Spaces', type: 'string', tier: 'global', default: '' }
```

The empty string means "not set". The value is an absolute folder path. It is written only by main (M9.4), never from a path the renderer sends. Main reads it with `resolveSetting(def, loadGlobalSettings(userDataDir), null)` and treats it as set only when it is an absolute path of an existing folder.

The first value is proposed, not written (CTO ruling 4): main's `proposeSpacesFolder(recents, home)` gives the parent folder of the newest recent Space when there is one, otherwise `<home>/Spaces`. The Human Lead confirms it on Set up this computer with Use this folder, or chooses another with Choose….

### A.6 GitHub calls: time limits, caching, logging

- **Per call.** The app builds its gh port with `createGhCliGitHub(runner, { timeoutMs: GH_CALL_TIMEOUT_MS })`, `GH_CALL_TIMEOUT_MS = 20_000` (in `main/space/github-service.ts`). Core's default stays 60 seconds.
- **git network calls.** `GitPort.clone` runs with `timeoutMs: GIT_CLONE_TIMEOUT_MS` (600 000) and `GitPort.push` with `GIT_PUSH_TIMEOUT_MS` (120 000), both with `env: GIT_NETWORK_ENV = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }`, so git never waits for a password.
- **No `git ls-remote`.** `repositoryIsOwn` in `setup/steps.ts` reads the branch heads through the port (`branchHeads`), which is a GraphQL query through `gh`: same sign-in, no keychain.
- **One plan, one lookup.** `lookupRepository` and `lookupProject` cache their whole result, `null` and failures included, for the life of one context (one plan or one run). `refuseForeignMatches` caches its result, success or failure, and runs the two lookups at the same time with `Promise.all` (they are reads).
- **A failed lookup stops the plan.** `planCreate` returns the failure of `refuseForeignMatches` whatever its kind.
- **The whole plan** has a time limit in main, `PLAN_TIME_LIMIT_MS = 60_000`.
- **Log.** Every `gh` call gives one log line `github-call` with `name` (for `gh api graphql`, the name of the query constant, from core's `graphqlOperationName`; otherwise the first two arguments that are not options), `ms`, `code` and `outcome` (`ok`, `failed`, or the `failure` kind). Every network `git` call (`clone`, `push`, `fetch`) gives one line `git-network-call` with `subcommand`, `ms`, `code`, `outcome`. Output is never logged.

### A.7 Progress of the plan

Core (M9.2) reports each check of a plan through an optional callback:

```ts
export type SetupCheckId = 'folder' | 'repository' | 'project' | 'steps';
export type SetupCheckProgress = { checkId: SetupCheckId; state: 'running' | 'done' | 'failed'; text: string };
export type SetupPlanOptions = { onCheck?: (progress: SetupCheckProgress) => void };
```

`planCreateSpace(input, deps, options?)`, `planAdoptRepository(input, deps, options?)` and `planOpenSpaceByAddress(input, deps, options?)` take it. The texts are written by core and shown as they are:

| checkId | running | done | failed |
|---|---|---|---|
| folder | `Checking the folder <spaceRoot>` | `The folder <spaceRoot> does not exist yet` / `The folder <spaceRoot> exists and is empty` / `The folder <spaceRoot> holds this Space from an earlier run` | the failure's message |
| repository (create, adopt) | `Looking for the repository <owner/name> on GitHub` | `The repository <owner/name> does not exist yet` / `The repository <owner/name> exists and belongs to this Space` | the failure's message |
| project (create, adopt) | `Looking for a Project named <name>` | `No Project named <name> yet` / `The Project <name> exists and belongs to this Space` | the failure's message |
| steps | `Checking which steps are already done` | `<n> of <total> steps are already done` | the failure's message |

Main pushes each one to the window as `space:setup-plan-progress` with a `planId` (M9.6). The renderer shows the list with a mark per line and the seconds elapsed on the running line (M9.9).

### A.8 The command panel

A button of Set up this computer (and of the setup result, and of the Space window's start control) runs one command from `setupCommands()`:

1. The renderer mounts `CommandPanel` with a `commandId`. The panel's `useXtermSession` `spawn` callback calls `spaceCommandRun({ commandId })`, which returns the PTY id.
2. Main (M9.5) checks the window's mode (`machine-check`, `setup` or `space`), looks the id up with `setupCommandLine`, and spawns `$SHELL -i -l -c <command line>` in the window's PTY service. A window of a Space uses the PTY service it already has; a window that shows no folder gets one rooted at the home folder from `SpaceHost.commandTerminal(window)`.
3. The existing terminal channels carry the output and the keystrokes, so the Human Lead sees every line and answers every question.
4. Main reads the output as it comes: when `parseDeviceCode` finds a code, it pushes `space:command-code` once for that PTY.
5. When the command ends, main pushes `space:command-exit` with the exit code. The renderer asks the machine check again (`fresh: true`) on Set up this computer, or the engine choice again in a Space window.

The renderer never sends a command line; it sends an id from a fixed list. Nothing runs without a click. The command line is shown on the screen next to its button before the click.

### A.9 Choosing the engine of a Space session

Main (M9.7) answers `spaceSessionEngines({})` with:

```ts
export type SpaceEngineFixKind = 'set-up-claude-code' | 'sign-in' | 'set-up-python3' | 'reinstall-lore' | 'edit-engine';
export type SpaceEngineFix = {
  kind: SpaceEngineFixKind;
  label: string;                  // the button's text
  commandId: string | null;       // for 'sign-in'
  commandLine: string | null;     // shown beside the button, for 'sign-in'
  section: 'tools' | 'engines' | null;   // Set up this computer opens at this section
};
export type SpaceEngineOption = {
  engineId: string;
  name: string;
  canStart: boolean;
  reason: string | null;          // null when canStart
  fix: SpaceEngineFix | null;
};
export type SpaceEngineChoice = {
  options: SpaceEngineOption[];   // every engine of the list, in list order (catalog first)
  engineId: string | null;        // the engine the start control uses; null when none can start
  buttonName: string;             // the name on the button: the chosen engine's, else the first guarded catalog engine's
  refusal: { message: string; fix: SpaceEngineFix | null } | null;   // set when engineId is null
};
```

Rules:

1. For an engine that cannot run a guarded session (`canRunGuardedSession` false): `canStart: false`, `reason: 'guarded Space sessions are not available for this engine yet'`, `fix: null`. Readiness is not run for it.
2. For every other engine, readiness runs (A.10). Ready: `canStart: true`. Refused: `canStart: false`, `reason` from the table below, `fix` from the table below.
3. `engineId`: the engine remembered for this Space (`session-engine` concern, M9.7) when its option can start; otherwise the first option that can start; otherwise `null`.
4. `refusal` (only when `engineId` is null): the readiness failure of the first guarded catalog engine (Claude Code): its message and its fix.

| Readiness failure kind | reason in the menu | fix kind | fix label |
|---|---|---|---|
| `engine-not-found`, `engine-not-installed` | `not installed` | set-up-claude-code, section `engines` | `Set up Claude Code` |
| `engine-not-signed-in` | `not signed in` | sign-in, command `engine-sign-in:claude-code` | `Sign in to Claude Code` |
| `python3-missing` | `python3 3.8 or later was not found` | set-up-python3, section `tools` | `Set up python3` |
| `not-installed`, `install-record-unreadable`, `plugin-missing`, `check-missing`, `check-altered` | `the Lore is not installed for it in this Space` | reinstall-lore | `Install the Lore again` |
| `engine-not-supported` with an option that changes permissions | `its arguments change the permissions of a session` | edit-engine | `Edit the engine` |
| any other kind | the failure's message | none | — |

The fix of a hand-added Claude Code engine that is not signed in uses the same catalog command.

### A.10 Session readiness, extended

`SpaceSessions.readiness(engineId)` (in `main/space/sessions/service.ts`) checks, in this order: the engine is in the list and may run a guarded session (today's `checkSessionEngine`); **new:** the engine is installed and not signed out; `python3`; the install and its checks (today). The new check uses a part `probeEngine(engine)` of `SpaceSessionParts`, whose default is `probeEngineOfApp` from `main/space/e2e-machine.ts` (M9.4): core's `checkEngine` with the login shell's `PATH`, or, in an end-to-end run with the fake GitHub, an answer "installed, signed in" without running anything.

| Probe result | Readiness |
|---|---|
| installed `missing` | `{ kind: 'engine-not-installed', message: 'No AI session was started: <name> is not installed.' }` |
| installed `undetermined` | passes (the start reports it if the engine cannot start) |
| signIn `not-signed-in` | `{ kind: 'engine-not-signed-in', message: 'No AI session was started: <name> is installed and not signed in.' }` |
| signIn `signed-in`, `not-checked`, `undetermined` | passes |

### A.11 IPC additions, by fragment

All channels follow section 5.1 and 6.5 of `mvp-architecture.md`: one object argument validated with zod in main, results `{ ok: true; value } | { ok: false; error }`.

| Fragment (file under `shared/ipc/space/`) | Channel | Phase |
|---|---|---|
| `machine.contract.ts` | `spaceSpacesFolderUse: invoke<[arg: Record<string, never>], SpaceSpacesFolderResult>('space:spaces-folder-use')` | M9.4 |
| `machine.contract.ts` | `spaceSpacesFolderChoose: invoke<[arg: Record<string, never>], SpaceSpacesFolderResult>('space:spaces-folder-choose')` | M9.4 |
| `commands.contract.ts` (new) | `spaceCommandRun: invoke<[arg: SpaceCommandRunArg], SpaceCommandRunResult>('space:command-run')` | M9.5 |
| `commands.contract.ts` | `onSpaceCommandCode: push<SpaceCommandCode>('space:command-code')` | M9.5 |
| `commands.contract.ts` | `onSpaceCommandExit: push<SpaceCommandExit>('space:command-exit')` | M9.5 |
| `setup.contract.ts` | `onSpaceSetupPlanProgress: push<SpaceSetupPlanProgress>('space:setup-plan-progress')` | M9.6 |
| `setup.contract.ts` | `spaceSetupChooseSource: invoke<[arg: Record<string, never>], SpaceSetupChooseSourceResult>('space:setup-choose-source')` | M9.6 |
| `setup.contract.ts` | `spaceSetupListSpaces: invoke<[arg: { owner: string }], SpaceSetupListSpacesResult>('space:setup-list-spaces')` | M9.6 |
| `setup.contract.ts` | `spaceSetupOpenExisting: invoke<[arg: Record<string, never>], SpaceWindowResult>('space:setup-open-existing')` | M9.6 |
| `sessions.contract.ts` | `spaceSessionEngines: invoke<[arg: Record<string, never>], SpaceSessionEnginesResult>('space:session-engines')` | M9.7 |
| `sessions.contract.ts` | `spaceSessionEnginePick: invoke<[arg: { engineId: string }], SpaceSessionEnginesResult>('space:session-engine-pick')` | M9.7 |
| `sessions.contract.ts` | `spaceSessionReinstall: invoke<[arg: Record<string, never>], SpaceSessionEnginesResult>('space:session-reinstall')` | M9.7 |

Changed payloads and arguments (types in the same files): `MachineCheckReport` (M9.4), `SpaceWindowInitPayload` and `SpaceNavigateArg` and `SetupStart` (M9.5), `SpaceSetupState`, `SpaceSetupValidateResult`, `SpaceSetupInterrupted`, `SpaceSetupGitHubNames` (M9.6), `SpaceSessionFailure` kinds (M9.7).

### A.12 Screens, components and test ids

The renderer follows `onboarding-ux.md` for layout, tokens and type scale, with the copy fixed in each phase of Part C. New shared parts live in `packages/app/src/renderer/src/space/common/` and new style objects in `packages/app/src/renderer/src/space/styles.ts`, both owned by M9.8:

| Name | File | Purpose |
|---|---|---|
| `cardStyle`, `rowCardStyle`, `stateTagStyle(kind)`, `fieldLabelStyle`, `hintStyle`, `inputStyle`, `resultLineStyle`, `disclosureStyle`, `stepIndicatorStyle`, `bannerStyle(kind)` | `styles.ts` | The style objects listed in the UX document's visual notes, with the tokens given there |
| `CommandPanel` | `common/CommandPanel.tsx` | The terminal panel of A.8 |
| `StatusRow` | `common/StatusRow.tsx` | Name, tag, purpose line, state (mark and word), one action, an optional command line and note |
| `Disclosure` | `common/Disclosure.tsx` | A button that shows or hides its children, with `aria-expanded` |
| `StepIndicator` | `common/StepIndicator.tsx` | `1 Details · 2 Confirm · 3 Create`, the current step bright |

`stateTagStyle(kind)` takes `'ready' | 'action' | 'failed' | 'muted' | 'new' | 'reused'`: ready uses `--color-success-fg`, action `--color-warn-fg`, failed `--color-danger-fg`, muted `--color-text-muted`, new the neutral pill `--color-neutral-pill`, reused the amber tag tokens `--color-amber-tag-bg`, `--color-amber-tag-border`, `--color-amber-tag-fg`. `bannerStyle(kind)` takes `'warn' | 'danger' | 'info'`: warn uses `--color-warn-banner-bg` and `--color-warn-banner-border`, danger `--color-danger-box-bg` and `--color-danger-box-border`, info `--color-shell-deep` and `--color-border`.

### A.13 Testing

The rules of `mvp-architecture.md` section 8 apply: no test reaches live GitHub, the real project, the real Lore, or runs a real install or sign-in command. Core logic is tested with `node:test` and scripted runners; main with the headless harness (`packages/app/test/headless/space/space-harness.ts`) and fake PTY services; screens with vitest and a stubbed `window.cockpit`, mocking `components/useXtermSession.js` as `dashboard-agents.test.tsx` does. The end-to-end suite runs with the fake GitHub and the fake machine answers of `main/space/e2e-machine.ts`; a test never clicks Use this folder (it would create a folder in the real home) and always answers the folder dialog with a temporary folder.

Manual checks that need the real engines, live GitHub or a clean Mac are listed in M9.11 and are the Human Lead's.

---

## Part B — Decisions this document makes

Each is reversible by the CTO or the Human Lead.

1. **Title and copy.** Where the two documents give different words for the same thing, this document uses the UX document's (it governs how the screens read) and keeps the product document's content. The setup screen is titled "Set up this computer"; the welcome entries are "New Space", "Space from GitHub", "Space from a repository on this computer". The sections of the setup screen are the product document's four, in its order.
2. **Fixes run in place.** "Sign in to Claude Code" in the Space window, and the GitHub fixes on the setup result ("Fix and run again"), run their command in a command panel on the same screen, not in a Sessions terminal tab and not by opening Set up this computer. The Space window's other fixes ("Set up Claude Code", "Set up python3") open Set up this computer in a new window, because a Space window does not change screen.
3. **The engine menu** is a `▾` beside the start control in Sessions and on the Dashboard, not on the dock header's `+ AI`. The dock's `+ AI` starts the chosen engine. The v0.8 project window is unchanged; its AI tab's own engine list now holds the catalog engines, which meets acceptance item 24.
4. **Default name of a Space made from a repository** is `<repository name>-space`, not the repository's name. Core refuses a Space whose repository would be the adopted repository itself (`owner/name` equal), which is the usual case when the Space and the repository have the same owner. This departs from the CTO's UX ruling and is listed for the CTO.
5. **"Complete"** means every step of the plan is done except the two steps that run on every run by design: "Check the machine" and "Set up the Project" (`isDone` is always false for both). The run's result says when only these ran: "Nothing was left to do. The Project's fields, labels and views were checked again."
6. **The check while typing** is local: it runs the `isDone` of the steps that read only the disk and git (the folder, the corpus entry, the clones, the mirrors, the first commit and push, the install, the first-seen records). The plan confirms with GitHub.
7. **Not in this stage:** a half-made Space listed in Recent Spaces with "Not finished" (a failed setup never opened the Space, so it has no recents entry; typing the same name on the form finds it); the current action inside a running step ("Pushing to GitHub"): the running step shows its title and the seconds elapsed.
8. **Where the setting is kept.** The Spaces folder is a registry setting in `settings.json`, as the product document says. This departs from rule 4 of section 2.4 of `mvp-architecture.md` ("no 1.0 field in settings.json"). The risk that rule guards against is an older build rewriting the file; every build's `parseSettingsFile` keeps any primitive value under `values`, so the value survives.
9. **Time limits** (CTO ruling 7): 20 seconds per `gh` call (the diagnosis measured 0.4 to 0.6 seconds per call; the product proposed 30); 60 seconds for a whole plan; 10 minutes for a `git clone` and 2 minutes for a `git push`. After 20 seconds of a plan the screen says "GitHub is slow to answer. You can keep waiting or cancel."
10. **Claude Code's sign-in, when it cannot be checked**, does not block: the row shows "Could not check" with the reason, the page can be ready, and a session can start. Only "not signed in" blocks.
11. **The list of Spaces on GitHub** (Space from GitHub form) is one GraphQL query of the owner's first 100 repositories by last push, keeping those whose default branch holds `lore/space.md`. Older repositories are reached with the address field.
12. **The Spaces folder path on the setup screen is not editable text.** The Human Lead confirms the proposal with Use this folder or picks another with Choose…; the renderer never sends a path.
13. **The organisations** are those `gh api user/orgs` returns; an organisation that restricts OAuth apps may be missing, and the owner field says so ("Not listed? Your organisation may need to allow access for the GitHub CLI.").
14. **The `missingIsNull` change** is kept as it is. Accepting only a `NOT_FOUND` at the `stage` path of `READ_PROJECT_QUERY` (the diagnosis's optional follow-up) is not done in this stage.
15. **The launch rule** is checked in the renderer of the welcome window the launch opens: the payload carries `checkOnLaunch: true`, the screen shows "Checking this computer…" while the check runs, and moves to Set up this computer when the result is not ready. Going Back to the welcome screen does not move again.

---

## Part C — Phases

### How to read a phase

Each phase lists its files and the exact changes. "Create" means a new file; "Edit" means an existing file. Names, types, copy and test ids given here are fixed; anything a phase does not fix is the developer's smallest choice under section 7 of `mvp-architecture.md`, listed under "Choices made" in the phase report.

Every phase ends with the definition of done of section 8.7 of `mvp-architecture.md`. The commands, from the repository root, with `<id>` the phase id in lower case (`m9-1`):

```
npm run build -w @ai-lore-companion/core
npm run typecheck -w @ai-lore-companion/app
npm run lint
AI_LORE_CORE_TEST_OUT=.test-runs/<id>/dist-test npm test -w @ai-lore-companion/core
AI_LORE_APP_TEST_OUT=.test-runs/<id>/dist-test npm run test:headless -w @ai-lore-companion/app
npm run test:component -w @ai-lore-companion/app
npm run e2e                      # phases that change main, preload or renderer
```

The baseline failures recorded at the head of `mvp-architecture.md` still apply. From M9.5 on, the end-to-end tests `space-setup.spec.ts` and `space-window.spec.ts` are expected to fail where they drive the welcome, setup and Sessions screens that this stage changes; a phase lists those failures in its report and M9.11 repairs them. Any other end-to-end failure is the phase's own.

Developer agents run with the project root as their working directory, write files only with the Write and Edit tools, and make no commit.

### Order and parallel groups

| Group | Phases | Runs after |
|---|---|---|
| 1 (core) | M9.1 and M9.3 in parallel; M9.2 after M9.1 (both edit `setup/steps.ts`), in parallel with M9.3 | — |
| 2 (main) | M9.4 and M9.5 in parallel | M9.3 (both); M9.1 is not needed by either |
| 3 (main) | M9.6 and M9.7 in parallel | M9.6: M9.1, M9.2, M9.4, M9.5. M9.7: M9.4 |
| 4 (renderer) | M9.8 | M9.4, M9.5 |
| 5 (renderer) | M9.9 and M9.10 in parallel | M9.9: M9.6, M9.8. M9.10: M9.5, M9.7, M9.8 |
| 6 | M9.11 | all |

Files shared across phases, and their owner in this stage. A phase that needs a line in a file it does not own reports the line; the next phase that is not parallel with the owner adds it.

| File | Owner |
|---|---|
| `packages/core/src/space/index.ts` | M9.3 (adds `export * from './engines/index.js'`) |
| `packages/core/src/space/github/index.ts` | M9.1 |
| `packages/core/src/space/setup/index.ts` | M9.2 |
| `packages/core/src/space/machine/index.ts` | M9.3 |
| `packages/core/src/space/setup/steps.ts` | M9.1, then M9.2 |
| `packages/app/src/main/space/github-service.ts` | M9.1 (two lines), then M9.6 |
| `packages/app/src/main/space/e2e-machine.ts` | M9.4 |
| `packages/app/src/shared/ipc/space/windows.types.ts`, `main/space/host.ts`, `main/space/windows.ts`, `main/space/routing.ts` | M9.5 |
| `packages/app/src/shared/ipc/contract.ts`, `packages/app/src/shared/ipc.ts`, `packages/app/src/main/space/ipc/index.ts` | M9.5 (one line each for the new commands fragment) |
| `packages/app/src/renderer/src/space/styles.ts`, `renderer/src/space/common/*` | M9.8 |
| `packages/app/src/renderer/src/space/SpaceSurface.tsx`, `renderer/src/components/SettingsSheet.tsx` | M9.10 |

---

### M9.1 — GitHub calls in core: the missing-field answer, branch heads and Space repositories through gh, bounded git network calls

**Goal.** Keep and own the uncommitted `missingIsNull` change; make the test fixtures model a missing Project field as GitHub does; replace `git ls-remote` with a query through `gh`; add the query that lists an owner's Spaces; give `git clone` and `git push` a time limit and no prompt; give main a name for each GraphQL query it logs.

**Depends on.** Nothing in this stage. Parallel with M9.3.

**Files and changes.**

1. `packages/core/src/space/github/gh-cli.ts` (edit; the working tree already holds the `missingIsNull` change at `PROJECT_FIELD_QUERY` and `READ_PROJECT_QUERY`, keep it as it is):
   - Add to the port object:
     - `async branchHeads(fullName)`: `splitRepositoryName`; `graphql(Q.BRANCH_HEADS_QUERY, parts, { missingIsNull: true })`; `repository` null gives `ok(null)`; otherwise `ok(list of refs.nodes[].target.oid, strings only)`.
     - `async listSpaceRepositories(owner)`: `graphql(Q.OWNER_SPACE_REPOSITORIES_QUERY, { login: owner }, { missingIsNull: true })`; `repositoryOwner` null gives `err(notFound(\`the account ${owner}\`))`; otherwise the nodes whose `manifest` is not null, each parsed with `parseRepository`, in the order GitHub gives.
   - Export `graphqlOperationName(input: string): string | null`: parse `input` as JSON; when its `query` is a string equal to the value of an exported constant of `queries.ts`, return that constant's name (for example `REPOSITORY_QUERY`); otherwise `null`. Build the lookup once from `Object.entries(Q)`.
2. `packages/core/src/space/github/queries.ts` (edit): add

   ```ts
   /** The commits of a repository's branches, at most 100. */
   export const BRANCH_HEADS_QUERY = `query($owner: String!, $name: String!) {
     repository(owner: $owner, name: $name) {
       refs(refPrefix: "refs/heads/", first: 100) { nodes { target { oid } } }
     }
   }`;

   /** An owner's repositories, newest push first, each with its Space manifest when it has one. */
   export const OWNER_SPACE_REPOSITORIES_QUERY = `query($login: String!) {
     repositoryOwner(login: $login) {
       repositories(first: 100, orderBy: { field: PUSHED_AT, direction: DESC }) {
         nodes { ${REPOSITORY_FIELDS} manifest: object(expression: "HEAD:lore/space.md") { id } }
       }
     }
   }`;
   ```
3. `packages/core/src/space/github/port.ts` (edit): add to `GitHubPort`, with doc comments:

   ```ts
   /** The commits the repository's branches point at; `null` when GitHub has no such repository. */
   branchHeads(fullName: string): Promise<Result<string[] | null, GitHubError>>;
   /** The owner's repositories that hold a Space manifest (`lore/space.md`) on their default branch, at most 100. */
   listSpaceRepositories(owner: string): Promise<Result<RepositoryInfo[], GitHubError>>;
   ```
4. `packages/core/src/space/github/fake.ts` (edit): implement both, honouring the unreachable switch and recording the call as the other methods do.
   - `branchHeads`: unknown repository gives `ok(null)`; otherwise run `git --git-dir <info.cloneUrl> for-each-ref --format=%(objectname) refs/heads` with the fake's runner (`cwd: state.reposDir`), one commit per line.
   - `listSpaceRepositories`: the repositories whose `fullName` starts with `<owner>/` and for which `git --git-dir <cloneUrl> cat-file -e HEAD:lore/space.md` exits 0, newest created first.
5. `packages/app/src/main/space/github-service.ts` (edit): add `branchHeads: answer` and `listSpaceRepositories: answer` to `unreachableGitHub`.
6. `packages/core/src/space/setup/steps.ts` (edit): `remoteHeads` is removed. `repositoryIsOwn` gets the heads from `ctx.deps.github.branchHeads(repository.fullName)`; a failure returns `gitHubFail(error)`; `null` is read as no heads.
7. `packages/core/src/space/exec/git-port.ts` (edit):
   - `RunGitOptions` gains `env?: Record<string, string>`, passed to `runner.run`.
   - Export `GIT_NETWORK_ENV = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } as const`, `GIT_CLONE_TIMEOUT_MS = 600_000`, `GIT_PUSH_TIMEOUT_MS = 120_000`.
   - `clone` and `push` run with `env: { ...GIT_NETWORK_ENV }` and their time limit (extend the internal `simple` helper with an options argument).
8. `packages/core/src/space/github/index.ts` and `packages/core/src/space/exec/index.ts` (edit): export the new names.
9. `packages/core/src/space/exec/guard.ts`: leave the `ls-remote` rules in place (other callers may exist later); no change.

**Test fixtures (edit).**

- `packages/core/test/space/github-samples.ts`: `FIELD_MISSING_BODY` becomes `{ data: { node: { field: null } }, errors: [{ type: 'NOT_FOUND', path: ['node', 'field'], message: "Could not resolve to a ProjectV2Field with the name Stage." }] }`. Add `BRANCH_HEADS_BODY`, `BRANCH_HEADS_EMPTY_BODY`, `OWNER_SPACE_REPOSITORIES_BODY` (two repositories, one with `manifest: { id: 'X' }`, one with `manifest: null`).
- `packages/core/test/space/github.test.ts`: every use of `FIELD_MISSING_BODY` is given with `{ code: 1 }` (the `gql` helper's option), as `gh` exits 1 on that answer.
- `packages/core/test/space/github-simulated-gh.ts`: `PROJECT_FIELD_QUERY` with no such field answers `{ data: { node: { field: null } }, errors: [{ type: 'NOT_FOUND', path: ['node', 'field'], message: ... }] }` (the `printed` helper then gives exit 1); `READ_PROJECT_QUERY` with no Stage field answers `stage: null` plus a `NOT_FOUND` error at `['node', 'stage']`. Add answers for `BRANCH_HEADS_QUERY` and `OWNER_SPACE_REPOSITORIES_QUERY` through the fake's new methods.
- `packages/core/test/space/github-contract.ts`: add contract cases run against both the fake and the simulated gh: `branchHeads` of a missing repository is `null`; of a new repository `[]`; after a commit is pushed to its clone address, one head equal to that commit; `listSpaceRepositories` returns a repository only after a commit with `lore/space.md` is pushed.

**Tests to add (core).**

- `github.test.ts`: "ensureSingleSelectField creates a field that GitHub reports as NOT_FOUND with exit 1"; "readProject reads a Project with no Stage field when GitHub reports NOT_FOUND with exit 1"; "an answer with a NOT_FOUND error and another error kind is a failure"; `branchHeads` argument building and parsing; `listSpaceRepositories` keeps only nodes with a manifest; `graphqlOperationName` returns `REPOSITORY_QUERY` for its request and `null` for other text.
- `setup.int.test.ts`: the plan and the run of "create" start no `git ls-remote` (record the scripted or real runner's calls and assert none has `ls-remote`); a repository that exists with commits that are not the Space's is still refused with `repository-taken`.
- `git-port.int.test.ts`: `clone` and `push` pass `GIT_TERMINAL_PROMPT=0` and `GCM_INTERACTIVE=never` and their time limits to the runner (a recording runner wrapped around the real one).

**Verify.** The commands of "How to read a phase", without `npm run e2e` (the app changes only `unreachableGitHub`, covered by the headless suite).

**Out of scope.** Caching and progress of the plan (M9.2); the app's time limit and logging (M9.6); accepting a `NOT_FOUND` only at the `stage` path.

---

### M9.2 — The setup plan in core: cached lookups, a failed lookup stops the plan, check progress, "complete", view links, and the local check of an existing Space

**Goal.** A plan asks GitHub at most once per lookup, stops at a failed lookup, reports each check as it runs, and says whether the Space is complete; the report carries the view settings with their links; a local check tells the form whether a folder holds a complete or half-made Space.

**Depends on.** M9.1. Parallel with M9.3.

**Files and changes.**

1. `packages/core/src/space/setup/types.ts` (edit):
   - Add `SetupCheckId`, `SetupCheckProgress`, `SetupPlanOptions` of A.7.
   - `SetupPlan` gains `complete: boolean`, `repository: RepositoryInfo | null`, `project: ProjectInfo | null`, `alreadyDone: string[]` (titles of the steps found done, in order, excluding `ALWAYS_RUN_STEP_IDS`), `leftToDo: string[]` (titles of the steps not done, in order, excluding `ALWAYS_RUN_STEP_IDS`).
   - Add `export type SetupViewSetting = { view: string; setting: string; url: string | null };` and `SetupReport.viewSettings: SetupViewSetting[]`; `SetupFailure.viewSettings: SetupViewSetting[]` (what was gathered before the stop, as `byHand` is).
   - Add `export type ExistingSpaceState = 'absent' | 'empty' | 'other-content' | 'incomplete' | 'complete';` and `export type ExistingSpace = { spaceRoot: string; state: ExistingSpaceState; message: string | null };`.
2. `packages/core/src/space/setup/steps.ts` (edit):
   - Export `ALWAYS_RUN_STEP_IDS: readonly string[] = ['machine-check', 'project-layout']`.
   - `SetupContext` gains `lookups: { repository?: Result<RepositoryInfo | null, StepError>; project?: Result<ProjectInfo | null, StepError> }`, `foreign?: Result<void, StepError & { stepId: 'space-repository' | 'project' }>`, `viewSettings: SetupViewSetting[]`, `onCheck?: (progress: SetupCheckProgress) => void`. `CreateSpaceContext.foreignChecked` is removed (replaced by `foreign`).
   - `lookupRepository`: returns `ctx.found.repository` when set; otherwise `ctx.lookups.repository` when set; otherwise asks GitHub once, stores the whole result (value or failure) in `ctx.lookups.repository`, and sets `ctx.found.repository` on a found value. `lookupProject` the same with `project`. `createRepository` and `createProject` in the steps also set `ctx.lookups.*` to `ok(created)`.
   - `refuseForeignMatches(ctx)`: returns `ctx.foreign` when set. Otherwise reports `repository` and `project` as `running`, runs `lookupRepository` and `lookupProject` with `Promise.all`, then checks ownership (repository first, then Project) as today; reports each check `done` with its text or `failed` with the message; stores the result in `ctx.foreign` with `stepId` `space-repository` for a repository failure and `project` for a Project failure; returns it. The check texts are A.7's.
   - `projectLayoutStep.run`: for each view of `SETUP_VIEWS`, push to `ctx.viewSettings` (cleared at the start of the run, as `byHand` is): for a board view with `columnField`, `{ view: spec.name, setting: \`Set "Column by" to the field "${spec.columnField}".\`, url }`; for `ITEMS_VIEW`, `{ view: ITEMS_VIEW, setting: 'Set "Group by" to "Parent issue".', url }`; `url` is `\`${project.url}/views/${view.number}\`` when `ensureProjectView` returned a view, else `null`. `byHand` stays as it is.
3. `packages/core/src/space/setup/flows.ts` (edit):
   - `prepareCreate` and `prepareOpen` take `options: SetupPlanOptions = {}`; put `onCheck` on the context; report `folder` `running` before `inspectSetupTarget` and `done` (text by target state) or `failed` after it. Initialise `lookups: {}`, `viewSettings: []`.
   - `planSteps` is wrapped in `plan()`: report `steps` `running`, then `done` with `<n> of <total> steps are already done` (n counts all done steps), or `failed`.
   - `planCreate`: any failure of `refuseForeignMatches` stops the plan with `stepsFailure(ctx, { ...failure, stepId: failure.stepId, title: <that step's title>, completed: [], skipped: [] })`.
   - `plan()` fills `complete` (every planned step whose id is not in `ALWAYS_RUN_STEP_IDS` has `done: true`), `repository: ctx.found.repository`, `project: ctx.found.project`, `alreadyDone` and `leftToDo`.
   - `run()` fills `viewSettings: [...ctx.viewSettings]`; `stepsFailure` fills `viewSettings` too.
   - `planCreateSpace`, `planAdoptRepository`, `planOpenSpaceByAddress` take `options: SetupPlanOptions = {}` as a third argument and pass it on. The run functions are unchanged in signature.
   - Add:

     ```ts
     /**
      * What a folder holds for the form, without asking GitHub: nothing, an empty folder,
      * something else, or this Space, complete or not by the steps that read only the disk and git.
      */
     export async function inspectExistingSpace(
       target: { flow: SetupFlow; spaceRoot: string; name?: string; repository: string },
       deps: SetupDeps,
     ): Promise<ExistingSpace>;
     ```

     Rules: `inspectSetupTarget(spaceRoot, { name, repository })`; `absent` and `empty` map to the same state with `message: null`; its failure maps to `other-content` with the failure's message; `half-made` builds the context as `prepareCreate` or `prepareOpen` do, without validating the form and without any GitHub call (`owner` and `name` from `repository` and `target.name`, `repositories` from the manifest's repositories as `{ name, github }`, `description: ''`, `private: true`), takes the steps of `createSpaceSteps` or `openSpaceSteps` whose id is one of `scaffold`, `corpus-entry`, `first-commit`, `install`, `first-seen`, `clone-space`, `workbench`, or starts with `clone:` or `mirror:`, and asks each `isDone`. All true: `complete`; otherwise `incomplete`. An exception from an `isDone` counts as not done.
4. `packages/core/src/space/setup/index.ts` (edit): export the new types, `ALWAYS_RUN_STEP_IDS` and `inspectExistingSpace`.

**Tests to add (core).**

- `setup.test.ts` (with `FakeGitHub` and a counting wrapper around it):
  - a plan of a new Space calls `findRepository` once and `findProject` once (today: more);
  - with the fake set unreachable, the plan fails with kind `github-unreachable` and `stepId` `space-repository`, and `findRepository` was called once;
  - `onCheck` receives, in order, folder running, folder done, repository running and project running, repository done, project done, steps running, steps done; the texts equal A.7's for a new Space named `alpha` of owner `octo`;
  - a plan of a Space created by a full run has `complete: true`, `leftToDo: []`; a plan after deleting the install folder has `complete: false` and `leftToDo` equal to `['Install into Claude Code']`.
- `setup.int.test.ts`:
  - after a full run, `report.viewSettings` has three entries whose `url` ends with `/views/<number>` of the fake's views;
  - `inspectExistingSpace` gives `absent` for a missing folder, `empty` for an empty one, `other-content` for a folder with a file, `complete` after a full run, `incomplete` after removing the Space's corpus entry file.

**Verify.** As M9.1.

**Out of scope.** Pushing progress to the window and the time limit on the plan (M9.6).

---

### M9.3 — The engine catalog, the machine check reshaped, the setup commands, the Spaces folder setting

**Goal.** Core knows the four engines, checks each for installed and signed in, reports the GitHub account and its organisations and whether Homebrew and npm are present, says what is left to set up, knows the commands the setup screen may run, and declares the Spaces folder setting.

**Depends on.** Nothing in this stage. Parallel with M9.1 and M9.2.

**Files and changes.**

1. Create `packages/core/src/space/engines/catalog.ts`, `merge.ts`, `index.ts` exactly as A.3.
2. Edit `packages/core/src/space/index.ts`: add `export * from './engines/index.js';`.
3. Edit `packages/core/src/space/machine/types.ts`, `engine-sign-in.ts`, `machine-check.ts` as A.4:
   - `probeEngineSignIn(engine, run)` dispatches on `catalogEntryFor(engine)?.signInCheck`, with the Claude rule for a hand-added Claude Code, and returns `not-checked` for any other engine (today it returns `undetermined` with "does not know how to ask").
   - `checkEngine` fills the new `EngineCheck` fields from the catalog entry (`null` and `false` for a hand-added engine except `guardedSessions`, which is `isClaudeEngine(engine)`).
   - `checkGitHub` and the `github` and `tools` fields of `checkMachine`.
   - `engineRequirement`: the Claude Code catalog engine's check when present.
4. Create `packages/core/src/space/machine/set-up.ts` (`setUpReadiness`, A.4 table) and `packages/core/src/space/machine/commands.ts` (`SetupCommandId`, `GH_WEB_SIGN_IN_COMMAND`, `setupCommands`, `setupCommandLine`, `parseDeviceCode`, A.4). Export `parseOpencodeAuthList` from `engine-sign-in.ts`.
5. Edit `packages/core/src/space/machine/index.ts`: export every new name.
6. Edit `packages/core/src/settings/settings.ts`: the registry entry of A.5.

**Tests to add (core).**

- `engines.test.ts` (new, `packages/core/test/space/engines.test.ts`): the catalog has four entries in the order of A.3 with the ids and commands of the table; `mergeEnginesWithCatalog`:
  - `[]` gives the four catalog entries and `changed: true`;
  - the Human Lead's list `[default.gemini (gemini), user.1 "Claude" (claude), user.2 "agy" (agy)]` gives `default.claude`, `default.codex`, `default.antigravity` (taking `user.2`), `default.opencode`, then `default.gemini`; `user.1` and `user.2` are gone; args of `user.1` are kept on `default.claude`;
  - a stored `{ id: 'e2e.claude', binary: '/tmp/x/bin/claude' }` becomes `default.claude` with that absolute binary;
  - a second stored `claude` entry stays a hand-added entry;
  - a list already merged gives `changed: false`.
- `machine.test.ts` (edit and extend): with a scripted runner,
  - Claude Code installed and `loggedIn: true`, the other three `not-found`: `engines` has four entries, Claude Code `installed.kind === 'installed'`, `signIn.kind === 'signed-in'`, the others `missing` and `not-checked`; the `engine` requirement is `fine`;
  - Claude Code missing and Codex installed and signed in: the `engine` requirement is `missing`;
  - `codex login status` exit 1 gives `not-signed-in`; exit 0 `signed-in`; a timeout `undetermined`;
  - `parseOpencodeAuthList` on `"┌  Credentials ~/.local/share/opencode/auth.json\n│\n●  Anthropic oauth\n│\n└  1 credentials\n"` is true, on `"└  0 credentials\n"` false, on `""` null, with ANSI colour codes around the text still true;
  - a hand-added `gemini` engine is `not-checked` when installed;
  - `github.account` is the account of the `gh auth status` text; `organisations` are the lines of `gh api user/orgs`; a failing orgs call gives `[]`; not signed in gives `account: null` and no orgs call;
  - `tools.brew` false when `brew --version` is `not-found`;
  - existing tests that expected `undetermined` for a non-Claude engine now expect `not-checked` and state `fine`.
- `set-up.test.ts` (new): each row of the A.4 table, and `ready: true` when all are fine and the folder is given.
- `commands.test.ts` (new): `setupCommandLine` for each id of the table, `null` for `rm -rf /` and for `engine-install:gemini`; `parseDeviceCode` on `"! First copy your one-time code: 1A2B-3C4D\n"` and on the same text wrapped in ANSI colour codes.
- `packages/core/test/settings.test.ts` (existing): `validateRegistry(SETTINGS_REGISTRY)` is empty and `spaces.folder` resolves to `''` by default.

**Verify.** As M9.1. Also run `npm run typecheck -w @ai-lore-companion/app`: the new `EngineCheck` fields and the changed `EngineSignInState` must not break main or the renderer (the renderer reads `EngineCheck` in `RequirementRow.tsx`; if a type error appears there, add the smallest fix and list it).

**Out of scope.** Loading `engines.json` (M9.4); running a command (M9.5).

---

### M9.4 — Main: the engine list from the catalog, the machine report with the Spaces folder, the owners and the commands

**Goal.** The app's engine list always holds the catalog engines first, merged once with the Human Lead's `engines.json`; the machine report tells the screens everything Set up this computer shows; the Spaces folder is written from a click.

**Depends on.** M9.3. Parallel with M9.5.

**Files and changes.**

1. `packages/app/src/main/engines.ts` (edit; a v0.8 file, edited for this stage):
   - Remove `DEFAULT_ENGINES`, `binaryResolves`, `shellQuote`, `enginesStore` and the `catalog-store` import.
   - `loadEngines(userDataDir)`: read `engines.json` with `readJsonFile`; take `engines` with `parseEngineEntries`; `mergeEnginesWithCatalog`; when `changed` is true or the file has a `removedDefaults` field, write `{ engines }` with `writeJsonFileAtomic(..., { pretty: true })` (this drops `removedDefaults`); return the merged list.
   - `saveEngines(userDataDir, list)`: `mergeEnginesWithCatalog(list)` and write `{ engines }`. A catalog entry missing from `list` therefore comes back.
   - The per-project functions stay as they are.
2. `packages/app/src/main/space/e2e-machine.ts` (edit):
   - Remove `FAKE_MACHINE_ENGINE`. In a fake machine run the engine list given to `checkMachine` is the app's list (catalog first).
   - `fakeMachineRunner` answers, before handing a command to the real runner: a binary whose basename is `claude`: `--version` → `2.1.276 (Claude Code)\n`, `auth status --json` → `{"loggedIn":true}`; basenames `codex`, `agy`, `opencode`: `{ code: -1, stdout: '', stderr: '<bin> was not found', failure: 'not-found' }`; `brew --version` → `Homebrew 4.6.0\n`; `npm --version` → the `not-found` answer; `gh api user/orgs …` → exit 0 with empty output. Every other `gh` command as today.
   - Remove the `signInProbe` override in `checkMachineOfApp` (the fake runner answers the real probes).
   - Export `probeEngineOfApp(runner: CommandRunner, engine: EngineEntry, options: MachineCheckOptions, env = process.env, packaged = isPackagedApp()): Promise<EngineCheck>`: in a fake machine run, an `EngineCheck` with `installed: { kind: 'installed', version: '1.0.0' }`, `signIn: { kind: 'signed-in' }`, built with the same fields as `checkEngine` would give; otherwise core's `checkEngine(runner, engine, options)`.
   - Export `readGitHubOwnersOfApp(runner, options, env = process.env, packaged = isPackagedApp()): Promise<{ account: string | null; organisations: string[] }>`: core's `checkGitHub` through `fakeMachineRunner` in a fake machine run, else through `runner`; returns its account and organisations.
3. Create `packages/app/src/main/space/spaces-folder.ts`:

   ```ts
   export const SPACES_FOLDER_KEY = 'spaces.folder';
   /** The setting's value when it is an absolute path of an existing folder; else null. */
   export function readSpacesFolder(userDataDir: string): string | null;
   /** The folder to propose: the parent of the newest recent Space, else <home>/Spaces. */
   export function proposeSpacesFolder(recents: readonly RecentSpace[], home: string): string;
   /** Create `folder` (recursive) and save it as the setting. */
   export function useSpacesFolder(userDataDir: string, folder: string): Result<string>;
   ```

   `useSpacesFolder` refuses a path that is not absolute, creates it with `mkdirSync(folder, { recursive: true })`, checks it is a folder, saves it with `saveGlobalSetting(userDataDir, SPACES_FOLDER_KEY, folder)`, and returns it.
4. Create `packages/app/src/main/space/github-owners.ts`: a module-level cache `let known: { account: string | null; organisations: string[] } | null`; `rememberGitHubOwners(value)`, `knownGitHubOwners()`.
5. `packages/app/src/shared/ipc/space/machine.types.ts` (edit):

   ```ts
   export type SpacesFolderState = { value: string | null; proposed: string };
   export type MachineCheckReport = {
     check: MachineCheck; checkedAt: number; pathSource: MachinePathSource;   // existing
     spacesFolder: SpacesFolderState;
     setUp: SetUpReadiness;
     /** Every command the screens may run, by id, with its command line. */
     commands: Record<string, string>;
   };
   export type SpaceSpacesFolderResult =
     | { ok: true; value: { folder: string } }
     | { ok: false; error: { kind: 'invalid-argument' | 'not-allowed-here' | 'cancelled' | 'not-a-folder' | 'failed'; message: string } };
   /** The ids of the catalog engines. Mirrors core's ENGINE_CATALOG; a headless test checks it. */
   export const CATALOG_ENGINE_IDS = ['default.claude', 'default.codex', 'default.antigravity', 'default.opencode'] as const;
   ```

   Re-export `SetUpReadiness`, `SetUpItemId`, `EngineInstallState`, `EngineSignInState` from core as types.
6. `packages/app/src/shared/ipc/space/machine.contract.ts` (edit): the two channels of A.11.
7. `packages/app/src/main/space/ipc/machine.ts` (edit):
   - The report: after `checkMachineOfApp`, `spacesFolder = { value: readSpacesFolder(userDataDir), proposed: proposeSpacesFolder(loadRecentSpaces(userDataDir), homedir()) }`, `setUp = setUpReadiness(check, spacesFolder.value)`, `commands = Object.fromEntries(setupCommands().map((c) => [c.id, c.commandLine]))`; then `rememberGitHubOwners(check.github)`. The `machine-checked` log line gains `setUpReady`.
   - `spaceSpacesFolderUse`: from any 1.0 window (`deps.space.windowFor(event)`); computes the proposal as above, `useSpacesFolder`, `deps.broadcastSettings()`, answers the folder. The renderer sends no path.
   - `spaceSpacesFolderChoose`: from any 1.0 window, or from a cockpit window (`deps.contextFor(event) !== undefined`); the folder dialog (title `Choose the folder new Spaces are created in`, properties `openDirectory`, `createDirectory`), parented on the window the event came from; cancelled gives `cancelled`; then `useSpacesFolder`, `deps.broadcastSettings()`.
   - A part `pickFolder` in `SpaceMachineParts` replaces the dialog in tests, as `setup.ts` does.
8. `packages/app/src/main/ipc/engines.ts`: no change needed (it calls `saveEngines` and `loadEngines`); check the `enginesSave` path returns the merged list.

**Tests to add (app headless).**

- `engines-catalog.test.ts` (new, `packages/app/test/headless/space/`): `loadEngines` on a temporary `userData` with the Human Lead's list of finding 8 (`default.gemini` first, a user-added Claude, `agy`, `removedDefaults: ['default.claude']`) returns Claude Code first and once, writes the file once without `removedDefaults`, and a second load does not write; `saveEngines` of a list without `default.codex` gives it back.
- `machine-ipc.test.ts` (extend): the report has `spacesFolder.proposed` equal to the parent of the newest recent Space written in the temporary `userData`, and `<home>/Spaces` without recents; `setUp.left` holds `spaces-folder` until `spaceSpacesFolderUse` is called (with `homedir` replaced so the folder is created under the temporary folder); `spaceSpacesFolderChoose` with a stubbed `pickFolder` saves the folder and a second report has `spacesFolder.value` set and no `spaces-folder` item; `commands['github-sign-in']` equals `GH_WEB_SIGN_IN_COMMAND`; `CATALOG_ENGINE_IDS` equals core's `ENGINE_CATALOG.map((e) => e.engineId)`.
- `e2e-machine.test.ts` (edit): the fake run reports Claude Code installed and signed in, the other catalog engines not installed, `tools.brew` true, `github.account` the fake's account; `probeEngineOfApp` in a fake run answers installed and signed in without calling the runner.

To make `homedir` replaceable, `SpaceMachineParts` gains `home: () => string` (default `os.homedir`).

**Verify.** All commands of "How to read a phase", `npm run e2e` included.

**Out of scope.** The command channels (M9.5); screens (M9.8).

---

### M9.5 — Main: the command panel and screen routing

**Goal.** A button of a 1.0 screen can run one setup command in a PTY of its window, with the one-time code and the exit pushed back; the launch welcome window knows to check the machine; a Space window can open Set up this computer at a section; the welcome screen can start "Space from a repository on this computer"; a Space opened from setup opens on the Dashboard.

**Depends on.** M9.3. Parallel with M9.4.

**Files and changes.**

1. `packages/app/src/main/pty.ts` (edit; allowed by section 2.4 of `mvp-architecture.md` for spawn options):
   - `PtySpawnOpts` gains `command?: string` ("A shell command line run as `$SHELL -i -l -c <command>` instead of a plain shell. Only command lines that are constants of core or main reach it: the setup commands of `setupCommands()`.") and `onData?: (data: string) => void`.
   - `onExit` becomes `(exitCode: number) => void`; the PTY's `onExit` passes `exitCode` from node-pty's event.
   - `spawn(engine, opts)`: when `opts.command` is set and `engine` is not, `args = ['-i', '-l', '-c', opts.command]`. `onData` is called after the service's own `onData`.
2. `packages/app/src/shared/ipc/space/windows.types.ts` (edit):
   - `SetupStart` gains `| { kind: 'from-repository' }` ("A Space about a repository chosen on the form, from the welcome screen.").
   - `export type MachineSection = 'tools' | 'github' | 'engines' | 'spaces-folder';`
   - `SpaceWindowInitPayload`: `space-welcome` gains `checkOnLaunch?: boolean`; `machine-check` gains `section?: MachineSection`; `space` gains `justCreated?: boolean`.
   - `SpaceNavigateArg`: `{ to: 'machine-check'; section?: MachineSection }`; the setup start union gains `'from-repository'`.
3. `packages/app/src/main/space/host.ts` (edit):
   - `launch(null)` shows the welcome screen with `checkOnLaunch: true` (extend `welcomeInit` and `openWelcome` with an options argument `{ checkOnLaunch?: boolean }`). Other ways to the welcome screen send no flag.
   - `navigate` with `to: 'machine-check'`: from `space` or `space-files`, find a window of mode `machine-check` (add `findByMode(mode)` to `windows.ts`) and show it again with the section and bring it to the front, or create a window and show `{ mode: 'machine-check', section }` in it (`'after-load'`); from a window that shows no folder, as today with the section.
   - `navigate` with `start: 'from-repository'`: `start = { kind: 'from-repository' }`, from windows that show no folder only.
   - `openFolder(window, folder, opts?: { justCreated?: boolean })`: pass `justCreated` into the `space` payload (`routing.ts` `windowInitFor(detected, opts)`).
   - `commandTerminal(window: SpaceWindowLike): PtyService | undefined`: for a window of a Space, `contexts.forWindow(window.id)?.ptyService`; for a window that shows no folder, the service `bindings.attachTerminal(window, homedir())` gave on the first call, kept in a map by window id. `showScreen` and `windowClosed` call `bindings.detachWindow(window.id)` for a window in that map and remove it. Add `commandTerminal` to `SpaceHost` with a doc comment.
4. `packages/app/src/main/space/routing.ts` (edit): `windowInitFor(detected, opts?)` as above.
5. Create `packages/app/src/shared/ipc/space/commands.types.ts`:

   ```ts
   export type SpaceCommandRunArg = { commandId: string };
   export type SpaceCommandFailure = {
     kind: 'invalid-argument' | 'not-a-space-window' | 'not-allowed-here' | 'unknown-command' | 'no-terminal';
     message: string;
   };
   export type SpaceCommandRunResult =
     | { ok: true; value: { ptyId: string; commandId: string; commandLine: string } }
     | { ok: false; error: SpaceCommandFailure };
   export type SpaceCommandCode = { ptyId: string; code: string };
   export type SpaceCommandExit = { ptyId: string; commandId: string; exitCode: number };
   ```
6. Create `packages/app/src/shared/ipc/space/commands.contract.ts` with `SPACE_COMMANDS_CONTRACT` (the three channels of A.11). Edit `shared/ipc/contract.ts` (spread it into `CONTRACT` after `SPACE_MACHINE_CONTRACT`) and `shared/ipc.ts` (`export * from './ipc/space/commands.types.js';`).
7. Create `packages/app/src/main/space/ipc/commands.ts` exporting `createSpaceCommandsRegister(parts?)` and `registerSpaceCommands`; add it to `SPACE_MODULES` in `main/space/ipc/index.ts`.
   - `spaceCommandRun`: argument `z.strictObject({ commandId: z.string().min(1).max(100) })`; the window must be a 1.0 window of mode `machine-check`, `setup` or `space` (else `not-allowed-here`, "Commands run from Set up this computer, from the setup screens and from a Space window."); `setupCommandLine(commandId)` null gives `unknown-command`; `deps.space.commandTerminal(window)` undefined gives `no-terminal`.
   - Spawn with `pty.spawn(undefined, { command: commandLine, onData, onExit })`. `onData` keeps the last 4096 characters of output for this PTY and, until a code was pushed, pushes `onSpaceCommandCode` with `parseDeviceCode(buffer)` when it is not null. `onExit(exitCode)` pushes `onSpaceCommandExit` to the window when it is not destroyed.
   - Log `setup-command-started` with `commandId` (never the output) and `setup-command-ended` with `commandId` and `exitCode`.
   - `parts.spawn(window, deps)` returns the PTY service, so a headless test gives a fake one.

**Tests to add (app headless).**

- `commands-ipc.test.ts` (new): refused from a `space-welcome` window; `unknown-command` for `rm -rf /`; from a `machine-check` window with a fake PTY service, `spawn` receives `{ command: GH_WEB_SIGN_IN_COMMAND }` for `github-sign-in`; data `"! First copy your one-time code: 1A2B-3C4D\r\n"` pushes one `space:command-code` with `1A2B-3C4D`, and the same text again pushes nothing; exit code 1 pushes `space:command-exit` with 1.
- `host.test.ts` (extend): `launch(null)` shows `space-welcome` with `checkOnLaunch: true`; `navigate({ to: 'space-welcome' })` does not; `navigate({ to: 'machine-check', section: 'engines' })` from a `space` window creates a second window showing `{ mode: 'machine-check', section: 'engines' }` and a second call reuses it; `navigate({ to: 'setup', start: 'from-repository' })` from the welcome window shows `{ mode: 'setup', start: { kind: 'from-repository' } }`; `commandTerminal` on a `machine-check` window attaches one terminal and `showScreen` to the welcome screen detaches it.
- `pty` (headless, existing tests of `pty.ts` if any; otherwise a new `pty-command.test.ts` with node-pty mocked through the electron stub pattern): the args are `['-i', '-l', '-c', <command>]` and `onExit` receives the exit code.

**Verify.** All commands, `npm run e2e` included.

**Out of scope.** The screens that use these channels (M9.8 to M9.10).

---

### M9.6 — Main: the setup channels

**Goal.** The setup screens get: a time limit and a log line per GitHub call, the plan's checks as they run, a time limit on the plan, the Location from the setting, the owners, the existing-Space check while typing, the repository folder chosen on the form, the list of Spaces of an owner, opening an existing Space, the last owner, and the form after an interrupted run.

**Depends on.** M9.1, M9.2, M9.4, M9.5. Parallel with M9.7.

**Files and changes.**

1. `packages/app/src/main/space/github-service.ts` (edit): `GH_CALL_TIMEOUT_MS = 20_000` (exported); `createAppGitHubPort` builds `createGhCliGitHub(withCommandLog(runner, log, 'gh'), { timeoutMs: GH_CALL_TIMEOUT_MS })`.
2. Create `packages/app/src/main/space/command-log.ts`:

   ```ts
   /** `runner`, with one log line per `gh` call (`which: 'gh'`) or per network `git` call (`which: 'git-network'`). */
   export function withCommandLog(runner: CommandRunner, log: SpaceLog | undefined, which: 'gh' | 'git-network'): CommandRunner;
   ```

   Events and fields as A.6. `name` for `gh api graphql` is `graphqlOperationName(opts.input ?? '') ?? 'graphql'`. Network git subcommands: `clone`, `push`, `fetch`. The time is measured with `performance.now()` and rounded to whole milliseconds.
3. `packages/app/src/shared/ipc/space/setup.types.ts` (edit):

   ```ts
   export type SpaceSetupPlanProgress = { planId: number } & SetupCheckProgress;
   export type SpaceSetupOwners = { account: string | null; organisations: string[]; defaultOwner: string | null };
   export type SpaceSetupTargetPreview = ExistingSpace;           // from core, as a type
   export type SpaceSetupSource = { sourceDir: string; originUrl: string | null; github: string | null; name: string };
   ```

   - `SpaceSetupState` gains `owners: SpaceSetupOwners`, `spacesFolder: string | null`, `source: SpaceSetupSource | null` (replaces the use of `sourceDir` and `originUrl` for the `from-repository` start; the two old fields stay filled for `about-repository`).
   - `SpaceSetupInterrupted` gains `form: SpaceSetupForm`.
   - `SpaceSetupValidateResult` value gains `target: SpaceSetupTargetPreview | null`.
   - `SpaceSetupGitHubNames` gains `repositoryUrl: string | null` and `projectUrl: string | null`.
   - `SpaceSetupFailure` gains `viewSettings: SetupViewSetting[]`.
   - Results: `SpaceSetupChooseSourceResult = SpaceSetupResult<SpaceSetupSource>`, `SpaceSetupListSpacesResult = SpaceSetupResult<{ repositories: { fullName: string; url: string; private: boolean }[] }>`.
   - The failure kind list in the doc comment gains `plan-timeout`, `not-a-repository`, `no-origin`, `unknown-owner`.
4. `packages/app/src/shared/ipc/space/setup.contract.ts` (edit): the four channels of A.11.
5. `packages/app/src/main/space/ipc/setup.ts` (edit):
   - `DEFAULT_PARTS.runner` wraps the runner with `withCommandLog(…, deps.space.log, 'git-network')`.
   - New parts: `spacesFolder: (deps) => readSpacesFolder(userDataDir)`, `owners: (deps, runner) => knownGitHubOwners() ?? readGitHubOwnersOfApp(runner, { platform })` (remember the answer with `rememberGitHubOwners`), `planTimeLimitMs: PLAN_TIME_LIMIT_MS` (60 000, exported), `defaultsFile` path `<userData>/spaces/setup-defaults.json`.
   - `WindowSetup` gains `source: SpaceSetupSource | null`, `preview: ExistingSpace | null`, `completeRoot: string | null`, `planId: number`.
   - When a window's setup is first held, `parentDir` is the Spaces folder when it is set (`spacesFolder(deps)`).
   - `spaceSetupState`: fills `owners` (`defaultOwner`: the `owner` of `setup-defaults.json` when it is the account or one of the organisations, else the account), `spacesFolder`, `source`, and `interrupted` with its form.
   - `spaceSetupChooseSource` (only for the `from-repository` start, else `not-allowed-here`): folder dialog titled `Choose the folder of the repository`; the folder must be a git working tree's top folder (`createGitPort(runner).topLevel`) else `not-a-repository` ("<folder> is not a git repository."); its `origin` must be set else `no-origin` ("<folder> has no remote named origin. Push it to GitHub first."); store and answer `{ sourceDir, originUrl: redactCredentials(origin), github: parseGitHubAddress(origin)?.fullName ?? null, name: basename(sourceDir) }`. Setting a source drops `planned`.
   - `coreInput` takes the source folder from `who.setup.source?.sourceDir` for `from-repository`, else from the start as today. `flowOfStart({ kind: 'from-repository' })` is `adopt`.
   - `spaceSetupValidate`: after the problems, when the form gives a Space folder (`spaceRootOf`), `target = await inspectExistingSpace({ flow, spaceRoot, name, repository }, setupDeps)` (for open, `name` is undefined and `repository` is the parsed address's full name; for create and adopt, `repository` is `owner/name`; no target when the owner or name is empty); keep it in `who.setup.preview`. This call reads the disk and git only.
   - `spaceSetupPlan`: `who.setup.planId += 1`; pass `{ onCheck: (p) => window.webContents.send(onSpaceSetupPlanProgress.channel, { planId, ...p }) }` to the plan; race the plan with a timer of `planTimeLimitMs`: on the timer, answer `plan-timeout` with `The check "<text of the last running check>" did not answer within 60 seconds. Nothing was created.` (or `GitHub did not answer within 60 seconds. Nothing was created.` when no check was running) and log `setup-plan-timeout`. When the plan answers `complete: true`, set `who.setup.completeRoot = plan.spaceRoot`. `gitHubNames` fills `repositoryUrl` and `projectUrl` from `plan.repository?.url` and `plan.project?.url`.
   - `spaceSetupListSpaces`: the owner must be the account or one of the organisations of `owners` (else `unknown-owner`); answer `github.listSpaceRepositories(owner)` mapped to `{ fullName, url, private }`; a GitHub failure gives its kind and message.
   - `spaceSetupOpenExisting`: when `who.setup.preview` is `complete` or `incomplete`, `deps.space.openFolder(window, preview.spaceRoot)`; else `not-allowed-here`.
   - `spaceSetupOpenSpace`: also accepted when `who.setup.completeRoot` is set (open it); open with `{ justCreated: true }` when a run of this window reached its end.
   - After a run of `create` or `adopt` reaches its end, write `setup-defaults.json` as `{ "version": 1, "owner": <owner> }` with core's `writeFileAtomicSync`, keeping unknown fields of an existing file.
   - When a run ends because its window closed, `interrupted` keeps `form` (the form of the planned input).
   - `fromCore` fills `viewSettings`.

**Tests to add (app headless, `setup-ipc.test.ts`).**

- a new window's `spaceSetupState` has `parentDir` equal to the Spaces folder set in the temporary `userData`, and `owners.account` equal to the fake's account;
- `spaceSetupPlan` pushes `space:setup-plan-progress` events in the order of M9.2's test, each with the same `planId`;
- with a plan part that never resolves and `planTimeLimitMs: 50`, the answer is `plan-timeout` with the sentence naming the last running check;
- `spaceSetupValidate` for the name of a Space created by an earlier run in the same folder answers `target.state === 'complete'`, and `spaceSetupOpenExisting` then opens that folder (the host's `openFolder` stub receives it);
- a plan with `complete: true` lets `spaceSetupOpenSpace` open its folder;
- `spaceSetupChooseSource` refuses a folder that is not a repository and a repository without origin, and answers `name` and `github` for a temporary repository whose origin is `https://github.com/octo/tool.git`;
- `spaceSetupListSpaces` refuses an owner that is not known and lists the fake's repository that has `lore/space.md`;
- after a finished create run, a new window's `defaultOwner` is the owner used;
- `withCommandLog` (new `command-log.test.ts`): one `github-call` line with `name: 'REPOSITORY_QUERY'`, a number `ms` and `outcome: 'ok'`; a timeout gives `outcome: 'timeout'`; git `status` gives no line and git `push` one `git-network-call` line.

**Verify.** All commands, `npm run e2e` included.

**Out of scope.** The screens (M9.9).

---

### M9.7 — Main: the engine of a Space session

**Goal.** A Space session's engine is chosen by readiness, not by the order of `engines.json`; readiness checks that the engine is installed and signed in; every refusal carries a fix; the pick is remembered per Space.

**Depends on.** M9.4. Parallel with M9.6.

**Files and changes.**

1. `packages/app/src/main/space/sessions/preflight.ts` (edit): `SessionStartFailureKind` gains `engine-not-installed` and `engine-not-signed-in`. `checkSessionEngine` uses `canRunGuardedSession(engine)` in place of `isClaudeEngine(engine)`; its messages are unchanged.
2. `packages/app/src/main/space/sessions/service.ts` (edit): `SpaceSessionParts` gains `probeEngine: (engine: EngineEntry) => Promise<EngineCheck>`; `readiness` runs it after `checkSessionEngine` and refuses as A.10.
3. `packages/app/src/main/space/ipc/sessions.ts` (edit): `appParts` gives `probeEngine: async (engine) => probeEngineOfApp(deps.space.runner, engine, { platform: process.platform, env: <login PATH when read> })`.
4. Create `packages/app/src/main/space/sessions/engine-choice.ts`:

   ```ts
   /** The engine choice of A.9 for `context`. `remembered` is the engine id of the `session-engine` concern, or null. */
   export async function engineChoice(
     engines: readonly EngineEntry[],
     readiness: (engineId: string) => Promise<SessionReadiness>,
     remembered: string | null,
   ): Promise<SpaceEngineChoice>;
   /** The fix of a readiness failure (the table of A.9), or null. */
   export function fixFor(failure: SessionStartFailure, engine: EngineEntry | null): SpaceEngineFix | null;
   ```

   `fixFor` fills `commandLine` of the sign-in fix with `setupCommandLine('engine-sign-in:claude-code')`. An `engine-not-supported` failure whose message names an option (the `guardChangingEngineOption` case) is `edit-engine`; the other `engine-not-supported` case never reaches `fixFor`, because rule 1 of A.9 handles it.
5. `packages/app/src/main/space/ui-store.ts` (edit): `UI_FILES` gains `'session-engine': 'session-engine.json'`; `UI_SCHEMAS['session-engine'] = z.looseObject({ version, engineId: z.string().min(1).max(256).nullable() })`. It is not added to `UI_SAVE_SCHEMAS`: only main writes it.
6. `packages/app/src/shared/ipc/space/sessions.types.ts` (edit): the types of A.9; `SpaceSessionEnginesResult = { ok: true; value: SpaceEngineChoice } | { ok: false; error: SpaceSessionFailure }`; `SpaceSessionFailure.kind` gains `engine-not-installed`, `engine-not-signed-in`, `reinstall-failed`.
7. `packages/app/src/shared/ipc/space/sessions.contract.ts` (edit): the three channels of A.11.
8. `packages/app/src/main/space/ipc/sessions.ts` (edit): handlers, each only from a `space` window (`spaceWindowContext`):
   - `spaceSessionEngines`: `engineChoice(loadEngines(userDataDir), (id) => sessions.readiness(id), remembered)` where `remembered` is `context.service(spaceUi).read('session-engine').state?.engineId` when a string, else null.
   - `spaceSessionEnginePick({ engineId })`: when the engine's option can start, `spaceUi.save('session-engine', { version: 1, engineId })`; answers the new choice (with the picked engine as `engineId` when it can start). A pick of an engine that cannot start changes nothing and answers the choice.
   - `spaceSessionReinstall({})`: `readLore(context.root)` then `installClaudeCode(lore, context.desk.install)`; a failure gives `reinstall-failed` with its message; then answers the choice. Log `lore-reinstalled`.
   - `spaceSessionStart`: after a successful start, save the engine as the remembered one (same call as the pick).

**Tests to add (app headless).**

- `engine-choice.test.ts` (new): with a readiness stub:
  - the list of finding 8 (Gemini first) chooses `default.claude`, and Gemini's option has the reason `guarded Space sessions are not available for this engine yet`;
  - a remembered engine that can start is chosen; a remembered engine that cannot start is not;
  - Claude refused with `engine-not-signed-in` gives `engineId: null`, `refusal.fix.kind === 'sign-in'`, `fix.commandId === 'engine-sign-in:claude-code'`, `buttonName: 'Claude Code'`;
  - each row of the A.9 table maps to its fix.
- `sessions.test.ts` (extend): readiness refuses `engine-not-installed` when the probe says missing and `engine-not-signed-in` when it says not signed in, and passes when the sign-in is `undetermined`; `spaceSessionEnginePick` writes `ui/session-engine.json`; `spaceSessionEngines` from a Files window is refused.

**Verify.** All commands, `npm run e2e` included.

**Out of scope.** The start control and the Settings sheet (M9.10).

---

### M9.8 — Renderer: shared parts, Set up this computer, the welcome screen

**Goal.** The setup screen of the product document (four sections, a button per fix, the command panel, ready or what is left) and the welcome screen that states the setup in one line and moves to setup at launch when it is not ready.

**Depends on.** M9.4, M9.5.

**Files and changes.**

1. `packages/app/src/renderer/src/space/styles.ts` (edit): add the style objects of A.12. Existing exports stay.
2. Create `renderer/src/space/common/CommandPanel.tsx`:

   ```ts
   type Props = {
     commandId: string;
     commandLine: string;
     /** Called once when the command's exit is pushed. */
     onExit: (exitCode: number) => void;
     onClose: () => void;
   };
   ```

   It renders a card (`data-testid="command-panel"`) with a header line `Running: <commandLine>` in monospace (`command-panel-command`) and, after the exit, `Finished.` for exit 0 or `Ended with exit code <n>.` (`command-panel-status`, attribute `data-state` `running` or `exited`); a `Close` button (`command-panel-close`); the xterm host (height 14rem) from `useXtermSession({ active: true, spawn, killOnUnmount: true, exitMessage: '[the command ended]' })`, where `spawn` calls `window.cockpit.spaceCommandRun({ commandId })` and keeps the returned `ptyId`, or shows the failure's message in `errorAreaStyle` and returns `null`. It listens to `onSpaceCommandExit` and `onSpaceCommandCode` for its `ptyId`. When a code arrives it shows, above the terminal (`command-panel-code`): `First copy your one-time code:`, the code in 1.4rem monospace, selectable, a `Copy code` button (`command-panel-copy-code`, `navigator.clipboard.writeText`), and `Paste this code on the GitHub page that opened in your browser. It is already on the clipboard.`
3. Create `common/StatusRow.tsx` (props: `testId`, `name`, `tag` (`'Required' | 'Optional' | string | null`), `purpose`, `stateWord`, `stateKind` for `stateTagStyle`, `detail` (muted text, e.g. a version), `action` (`{ label, onClick, disabled?, title? } | null`), `commandLine` (shown as `Runs: <command line>` in monospace under the row, or null), `note` (string or null)). Test ids inside: `<testId>`, `<testId>-state`, `<testId>-action`, `<testId>-command`, `<testId>-note`.
4. Create `common/Disclosure.tsx` (props `label`, `testId`, `defaultOpen`, children) and `common/StepIndicator.tsx` (prop `current: 1 | 2 | 3`, test id `step-indicator`, text `1 Details · 2 Confirm · 3 Create`).
5. Rewrite `renderer/src/space/machine/MachineCheckScreen.tsx` (exported name and `init` prop kept). Remove `RequirementRow.tsx`; create `machine/machineText.ts` (the words below), `machine/ToolsSection.tsx`, `machine/GitHubSection.tsx`, `machine/EnginesSection.tsx`, `machine/SpacesFolderSection.tsx`. `useMachineCheck.ts` keeps its API and also asks again (`fresh: true`) when the window regains focus (`window.addEventListener('focus', …)`), at most once every 3 seconds.

   The screen (`data-testid="machine-check"`, column `46rem`):
   - Title `Set up this computer`. Sentence: `AI-Lore uses these tools on this computer. Items marked Required must be ready before you create a Space. A button runs its command in the panel at the bottom of this page, where you see what it prints and answer its questions.` A secondary `Back` top right (`machine-check-back`) → `spaceNavigate({ to: 'space-welcome' })`.
   - While the first report is not there: `Checking this computer…` (`machine-check-overall`).
   - Four sections in this order, each a `section` with an `h2` and a test id: `machine-section-tools` (heading `Tools`), `machine-section-github` (`GitHub`), `machine-section-engines` (`AI engines`), `machine-section-spaces-folder` (`Spaces folder`). A section whose items are all fine is collapsed to one line with a `Show` button (`<section id>-toggle`); the first section that is not fine is open; `init.section`, when given, is open and scrolled into view.
   - Collapsed lines: `✓ Tools — Git <v>, Python 3 <v>, GitHub CLI <v>`; `✓ GitHub — signed in as <account>, with access to Projects`; `✓ AI engines — Claude Code can run Space sessions`; `✓ Spaces folder — <path>`.
   - Tools rows (`StatusRow`, test ids `machine-row-git`, `machine-row-python3`, `machine-row-gh`):
     | Row | Tag | Purpose |
     |---|---|---|
     | Git | Required | `Keeps the history of your Spaces.` |
     | Python 3 | Required | `Runs the check that protects your files during AI sessions.` |
     | GitHub CLI | Required | `Lets AI-Lore create repositories and Projects on GitHub.` |

     State words from the requirement: `fine` → `Ready` with the version as detail; `missing` → `Not installed`; `too-old` → `Too old: <version> is installed and <minimum> or later is needed`; `undetermined` → `Could not check` with the reason as note. Actions: Git or Python 3 missing → `Install`, command `install-command-line-tools`, note `Opens Apple's installer for the command line developer tools. It installs Git and Python 3 together.`; Git or Python 3 too old → `Open the download page` (`urlOpenExternal` with `https://git-scm.com/downloads` or `https://www.python.org/downloads/`). GitHub CLI missing with `tools.brew` → `Install`, command `install-gh`; too old with `tools.brew` → `Update`, command `update-gh`; missing or too old without Homebrew → `Open the download page` (`https://cli.github.com`), note `Homebrew was not found, so the GitHub CLI is installed from its download page.`
   - GitHub row (`machine-row-github`), from the `gh` requirement and `check.github`:
     | gh state | Text | Action |
     |---|---|---|
     | `missing`, `too-old` | `Install the GitHub CLI first (Tools, above).` | none |
     | `not-signed-in` | `Sign in to GitHub in your browser. AI-Lore never sees your password or token; the GitHub CLI keeps them.` | `Sign in with GitHub`, command `github-sign-in` |
     | `missing-scope` | `Signed in as <account>. GitHub Projects need one more permission.` | `Allow access to Projects`, command `github-add-project-scope` |
     | `fine` | `Signed in as <account>, with access to Projects.` and a second line `Organisations: <a>, <b>.` or `No organisations.` | `Use another account…`, command `github-sign-in` (secondary style) |
     | `undetermined` | `Could not check the GitHub sign-in: <reason>` | `Check again` |
   - AI engines: header line (`machine-engines-overall`) `✓ Ready — Claude Code can run Space sessions` when the `engine` requirement is fine, else `! Needs Claude Code`. One row per `check.engines` entry (`machine-row-engine-<engineId>`): name, maker in muted text, tag `Required — runs the AI sessions in a Space` for `required`, `Optional` for a catalog engine that is not required, `Added in Settings` for a hand-added engine; two state cells (`machine-row-engine-<engineId>-installed`, `…-signed-in`): `Installed <version>` / `Not installed` / `Could not check`, and `Signed in` / `Not signed in` / `Not checked` (muted) / `Could not check`. Action: not installed with `installNeeds === 'npm'` and `!tools.npm` → `Open the download page` (`https://nodejs.org/en/download`), note `Needs Node.js, which was not found.`; not installed otherwise → `Install`, command `engine-install:<catalogId>`; installed and `not-signed-in` → `Sign in`, command `engine-sign-in:<catalogId>`; hand-added engines have no action. Under each optional catalog row: `Installed and ready for AI tabs outside Spaces. Guarded Space sessions run on Claude Code only, for now.`; the OpenCode row also shows its catalog note.
   - Spaces folder (`machine-row-spaces-folder`): sentence `New Spaces are created in this folder. You can choose another folder for any one Space.`; the path in monospace (`machine-spaces-folder-path`): the value when set, else the proposal; not set: primary `Use this folder` (`machine-spaces-folder-use`) → `spaceSpacesFolderUse({})`, secondary `Choose…` (`machine-spaces-folder-choose`) → `spaceSpacesFolderChoose({})`; set: `✓` and `Choose…`. After either call, ask the check again.
   - Command buttons: pressing one sets the screen's single active command `{ commandId, commandLine: report.commands[commandId] }` and mounts `CommandPanel` at the bottom of the column; while a command is active every other command button is disabled with the title `Wait for the command in the panel to end, or close the panel.` On exit, ask the check again (`fresh: true`); the panel stays until Close.
   - Bottom: when `report.setUp.ready`, `This computer is ready.` in `--color-success-fg` (`machine-check-overall`, `data-ready="true"`) and primary `Continue` (`machine-check-continue`) → `spaceNavigate({ to: 'space-welcome' })`; otherwise `Continue` disabled with `aria-describedby` on `Left to do: <texts joined by ", ">.` (`machine-check-left`, `data-ready="false"` on `machine-check-overall`). A text button `Check all again` (`machine-check-again`).
   - The PATH note (`machine-check-path-source`) only when some tool or Claude Code is not installed: `Searched the folders of your login shell's PATH.` or, for `app-environment`, `The login shell's PATH could not be read, so the search used the app's own PATH.`
6. Rewrite `renderer/src/space/welcome/SpaceWelcomeScreen.tsx` and `SetupEntries.tsx` (exported names kept):
   - Title `AI-Lore`. When `init.checkOnLaunch` and the first report says `setUp.ready === false`, call `spaceNavigate({ to: 'machine-check' })` once. While that first check runs, the status card shows `Checking this computer…`.
   - Not ready (and not moving): a card at the top (`space-welcome-setup-card`): heading `Set up this computer`, sentence `AI-Lore needs Git, Python 3, a GitHub sign-in, Claude Code and a Spaces folder before it can create a Space. <n> of 5 are ready.` (n = 5 minus the number of distinct item groups in `left`, counting `gh` and `github` as one), primary `Continue setup` (`space-welcome-continue-setup`).
   - Recent Spaces first when there are any (list as today, test ids kept).
   - `Start` section with three entry cards (`space-welcome-create`, `space-welcome-open-address`, `space-welcome-from-repository`): `New Space` — `Creates a Space on GitHub and in a folder on this computer.`; `Space from GitHub` — `Copies an existing Space from GitHub to this computer.`; `Space from a repository on this computer` — `Creates a new Space that includes a repository you already have. The repository's folder is left as it is.` They navigate to `setup` with `new`, `from-address`, `from-repository`. While not ready they carry `aria-disabled="true"` and the line `Finish setting up this computer first.` with a link-style `Continue setup`. On a first launch without recents, `New Space` uses the primary style.
   - Ready: at the bottom, `space-welcome-machine-status` (`data-ready` as today): `✓ This computer is set up: GitHub <account>, Claude Code signed in, Spaces in <folder with the home folder written as ~>.` and a link-style `Change…` (`space-welcome-change-setup`) → `spaceNavigate({ to: 'machine-check' })`.
   - A secondary text button at the bottom `Open a folder…` (`space-welcome-open`, as today).

**Tests to add (component).**

- `machine-check.test.tsx` (rewrite): one test per row state of each table above with a stubbed report; a command button mounts the panel with `Runs:` text shown before the click and calls `spaceCommandRun` with its id; other command buttons are disabled while it is active; an exit push calls `spaceMachineCheck` with `fresh: true`; `Use this folder` calls `spaceSpacesFolderUse`; ready shows `Continue` enabled; not ready lists the left items in order; the engines section lists four catalog engines with the right tags when the report has them; `init.section = 'engines'` opens that section.
- `space-welcome.test.tsx` (rewrite): `checkOnLaunch` with a not-ready report calls `spaceNavigate({ to: 'machine-check' })` once, without the flag it does not; the ready line names the account, Claude Code and the folder with `~`; the three entries navigate with their starts; not ready they are `aria-disabled`.
- `command-panel.test.tsx` (new): with `useXtermSession` mocked, the panel shows the command line, shows the code and copies it, and shows `Ended with exit code 2.` after an exit push for its PTY and ignores another PTY's push.

**Verify.** All commands, `npm run e2e` included (expected failures in `space-setup.spec.ts` are reported, see "How to read a phase").

**Out of scope.** The setup forms (M9.9); the Settings sheet (M9.10).

---

### M9.9 — Renderer: the three forms, the checking list, the confirmation, the run and the result

**Goal.** The setup screens of the product document: three forms with plain labels and a live What will be created block; the plan's checks as a list with time; a short confirmation with the full plan behind a disclosure; state words in the run; three results; "Already done" in place of "skipped", also in the migration screens.

**Depends on.** M9.6, M9.8. Parallel with M9.10.

**Files and changes** (all under `packages/app/src/renderer/src/space/setup/` unless named).

1. `useSetupFlow.ts` (edit):
   - `SetupStage` gains `checking` (replaces `planning`), `complete` (the plan found the Space complete).
   - State gains `checks: SpaceSetupPlanProgress[]` (the latest per `checkId`, in first-seen order, cleared when a plan is asked; pushes with a `planId` lower than the highest seen are dropped), `checkStartedAt: number | null`, `owners`, `source`, `target: SpaceSetupTargetPreview | null` (from each validate answer), `spaceList: { fullName: string; url: string; private: boolean }[] | null`.
   - `fields.owner` starts at `owners.defaultOwner`; for `adopt` with a `from-repository` source, `fields.name` becomes `<source.name>-space` when the name is empty; `interrupted.form` fills the fields once on load.
   - `chooseSource()` → `spaceSetupChooseSource({})`; `listSpaces(owner)` → `spaceSetupListSpaces({ owner })`; `openExisting()` → `spaceSetupOpenExisting({})`; `cancelCheck()` returns to `form` and ignores the pending answer; `fixAndRetry(commandId)` sets an active command (the result screen mounts `CommandPanel`), and on exit 0 calls `showPlan()` again with the same fields.
   - Validation is asked on every change of a field (debounced as today), so `target` follows the name.
2. `SetupScreen.tsx` (rewrite, exported name kept): `StepIndicator` (1 on the form and while checking, 2 on the confirmation, 3 while running and on the result); titles `New Space`, `Space from GitHub`, `Space from a repository on this computer`; sentence under the title for create: `A Space is a GitHub repository with a Project, and a folder on this computer.`; open: `Copies a Space that already exists on GitHub into a folder on this computer.`; adopt: `A new Space whose repositories include one you already have on this computer.` The interrupted notice (`setup-interrupted`): `Creating <folder name> stopped when its window closed. The form is filled in again; Continue finishes it.`
3. `SetupForm.tsx` (rewrite). Labels, in order, per flow; every input has a `label` element and a test id `setup-field-<name>`:
   - Create: `Name` (hint `Also the name of the folder, the repository and the Project.`), `Description (optional)` (placeholder `What this Space is for.`), `GitHub owner` (a `select`: first option `<account> (you)`, then each organisation; hint `Signed in as <account> · Not listed? Your organisation may need to allow access for the GitHub CLI.`), `Visibility` (two radio options `Private` — `Only you and people you add can see it.`, `Public` — `Anyone can see it.`; `Private` checked by default; test ids `setup-field-private-true` and `setup-field-private-false`), `Location` (the parent folder in monospace, `setup-location`, and `Change…` → `chooseFolder`; hint `For this Space only; the Spaces folder in Settings stays as it is.`), and the disclosure `Add repositories (optional)` holding today's repository rows with labels `GitHub address` (placeholder `owner/name or https://github.com/owner/name`) and `Name in the Space (optional)`, `Add another`, `Remove`, and the line `You can add repositories later.`
   - Space from a repository: first the repository card (`setup-source`): before a folder is chosen, `Repository folder` with `Choose…` (`setup-choose-source`); after, `Repository: <folder>`, `On GitHub: <github or "no GitHub address">`, `The new Space gets its own copy from GitHub. This folder is not changed.` For the `about-repository` start the card shows the folder main gave, without `Choose…`. Then the create fields without the repositories disclosure, and a disclosure `More options` with `GitHub address` and `Name in the Space`.
   - Space from GitHub: `GitHub owner` (select as above; changing it calls `listSpaces`), `Space on GitHub` (a `select` of `spaceList` entries shown as `owner/name` with `(private)` when private, plus a last option `Another address…` that shows the text field `Address` with placeholder `owner/name or https://github.com/owner/name`), `Location`, and the disclosure `Use a different folder name` with `Folder name`.
   - Problems: under their field in `--color-danger-fg`; problems of no shown field under `Fix these before continuing:` with the plain label: `name` → `Name`, `description` → `Description`, `owner` → `GitHub owner`, `parentDir` → `Location`, `sourceDir` → `Repository folder`, `github` → `GitHub address`, `repositoryName` → `Name in the Space`, `address` → `Space on GitHub`, `folderName` → `Folder name`, `repositories[...]` → `Repositories`. No internal field name appears on screen.
   - The block `What will be created` (`setup-will-create`), always visible, updated on every change:
     - create/adopt, no name yet: `Enter a name to see what will be created.`
     - create/adopt: `Folder: <parent>/<name>` then, by `target.state`: `absent` — `a new folder.`; `empty` — `an empty folder that will be used.`; `incomplete` — `<folder> holds this Space from an earlier run.` (in `--color-warn-fg`); `complete` — `<folder> holds this Space, and it is complete.`; `other-content` — `A folder named <name> already exists in <parent> and is not this Space. Choose another name or location.` (in `--color-danger-fg`). Then `On GitHub: the <private|public> repository <owner>/<name> and a Project named <name>.` Then `Installed for Claude Code, so AI sessions can start as soon as the Space opens.` For adopt also: `The repository is cloned into <parent>/<name>/repos/<repository name>. The folder you chose, <source folder>, is not changed.`
     - open: `Folder: <parent>/<folder name>` with the same target words, then `The Space's repositories are cloned into repos/ after you confirm them.`
   - Actions: `Continue` (`setup-continue`, primary) → `showPlan`; disabled while the name is empty (create, adopt), the address is empty (open), or the target is `other-content`. With target `incomplete`, `Continue` reads `Finish setting it up` and a secondary `Open it` (`setup-open-existing`) is shown; with target `complete`, the primary is `Open it` (`setup-open-existing`) and there is no Continue. Secondary `Back` (`setup-to-welcome`) → welcome. Hint beside: `Nothing is created before you confirm.`
4. Create `SetupChecking.tsx`, shown under the form (form disabled) while the stage is `checking` (`setup-checking`): heading `Checking before anything is created` and the elapsed time `m:ss` on the right; one line per check (`setup-check-<checkId>`, `data-state`): marks `…` running (with its own seconds after 1 s), `✓` done, `✗` failed; the running line inside `aria-live="polite"`. After 20 s: `GitHub is slow to answer. You can keep waiting or cancel.` A `Cancel` button (`setup-check-cancel`) → `cancelCheck`. A plan failure keeps the list and shows the failure's message, the line `Nothing was created.`, and `Try again` (`setup-check-retry`, asks the plan again) and `Back` (form). For `repository-taken` or `project-taken` the button is `Choose another name` (form with Name focused).
5. `SetupPlanView.tsx` (rewrite as the confirmation, exported name kept; `setup-plan` root test id kept):
   - Heading (focused when shown, `setup-confirm-question`): create/adopt `Create the Space <name>?`; open `Copy the Space <owner/name> to this computer?`; half-made (plan `target === 'half-made'`) `Finish the Space <name>?`.
   - Half-made banner (`bannerStyle('warn')`, `setup-confirm-half-made`): `This Space was started before and not finished. Left to do: <plan.leftToDo joined by ", ">.`
   - A card of rows (`setup-confirm-folder`, `setup-confirm-repository`, `setup-confirm-project`), each with a tag `New` or `Already exists, will be used` (`stateTagStyle('new' | 'reused')`): `Folder <root>`; `GitHub repository <owner/name> · Private|Public`; `GitHub Project <name>, with its fields, labels and three views`. For open only the folder row and `The Space repository <owner/name>` without tag.
   - Then `The Space is installed for Claude Code.` and `Nothing has been created yet.` At most eight lines above the buttons.
   - Buttons: primary `Create the Space` / `Copy the Space to this computer` / `Finish the Space` (`setup-confirm`, focused), secondary `Back` (`setup-back`).
   - Disclosure `Show every step` (`setup-show-every-step`): the view names and labels, and each step with `Already done` or `Will run` and its lines written as sentences: `what`, then ` From <from>.`, ` To <to>.`, ` <count> in all.` when present.
6. When the plan answers `complete: true`, the stage is `complete` and the screen shows (`setup-complete`): `The Space <name> already exists and is complete.`, `Folder: <root>`, links `Repository: <owner/name> ↗` and `Project: <name> ↗` (from `repositoryUrl`, `projectUrl`, opened with `urlOpenExternal`), and primary `Open the Space` (`setup-open-space`).
7. `SetupProgressView.tsx` (rewrite, exported name kept):
   - Running (`setup-running`): title `Creating <name>`; the current step in 1rem: `<title>…` with elapsed `m:ss` (`setup-current-step`); the list (`li` with `data-testid="setup-step-<stepId>"` and `data-state` the internal state, kept for the end-to-end tests) with the words and marks: waiting `·` `Waiting`, checking `…` `Checking`, running `…` `Running`, done `✓` `Done`, skipped `✓` `Already done` (in `--color-text-secondary`), failed `✗` `Failed`. `Stop` (`setup-stop`) with `Stops after the current step. What is done is kept.`
   - Finished (`setup-finished`): heading `The Space <name> is ready.` (focused); `Folder: <root> · Repository: <owner/name> ↗ · Project: <name> ↗`; when the run skipped steps: `The Space <name> had been started before. This run finished it: <titles of report.completed excluding ALWAYS_RUN ids>.`, or, when only always-run steps ran, `Nothing was left to do. The Project's fields, labels and views were checked again.`; primary `Open the Space` (`setup-open-space`, focused). Below, when `viewSettings` is not empty, a card (`setup-by-hand`) `Three settings to make on GitHub (two minutes, can wait)` with, per setting, `In the view <view>: <setting>` and `Open this view` (`setup-by-hand-open-<index>`, `urlOpenExternal(url)`; hidden when `url` is null), and the line `GitHub does not allow apps to change these view settings. They do not block opening the Space.` Open by address keeps today's repositories-to-clone block, titled `Repositories of this Space`, with each row `<name> · <github>` and the button `Copy the ticked repositories`.
   - Failed (`setup-failed`): heading `The Space <name> was not finished.`; `Stopped at: <title> — <message>`; `What was done is kept. Running again finishes the rest and does not repeat what is done.`; the failed step row expanded. Buttons: for kind `github-missing-scope` primary `Fix and run again` → `fixAndRetry('github-add-project-scope')`; `github-not-signed-in` → `fixAndRetry('github-sign-in')`; `machine-not-ready` → `Fix and run again` → `spaceNavigate({ to: 'machine-check' })`; other kinds primary `Run again` (today's). Secondary `Back to the welcome screen`. The command panel mounts here during a fix.
   - Stopped: as today with the words `Stopped before <title>. What was done is kept. Running again continues from there.`
8. The migration screens (words only): `migration/MigrationProgressView.tsx` shows `Already done` with `✓` in `--color-text-secondary` for `skipped` (keep `data-state`); `migration/MigrationPlanView.tsx` replaces ` — done already, skipped` with ` — Already done`; `MigrationPlanView.tsx` line 26 and `MigrationScreen.tsx` line 66 replace "skipped" with "not repeated".

**Tests to add (component, `setup.test.tsx` rewritten and extended).**

- no element's text contains `parentDir`, `folderName`, `sourceDir`, `repositoryName`, `github —`, or `skipped`;
- the owner select lists `<account> (you)` then the organisations, and has no text input;
- typing a name updates `setup-will-create` with the full path and "a new folder."; a `complete` target shows `Open it` and no Continue; an `incomplete` target shows `Finish setting it up` and `Open it`; `other-content` disables Continue;
- plan progress pushes render the check lines with their marks; a push with an older `planId` is ignored; after 20 s of fake time the slow line shows; Cancel returns to the form;
- the confirmation has the question, three rows with the right tags, at most eight text lines before the buttons (count the rendered block elements), and the full plan only after `Show every step`;
- the run shows `Already done` for a skipped step and `data-state="skipped"`;
- the finished screen's first line is `The Space <name> is ready.` and `Open the Space` has focus; each view setting has an `Open this view` that calls `urlOpenExternal` with its URL;
- a failure of kind `github-missing-scope` offers `Fix and run again`, mounts the command panel with `github-add-project-scope`, and an exit 0 asks the plan again;
- `from-repository`: `Choose…` calls `spaceSetupChooseSource`, the name becomes `<name>-space`, and the card says the folder is not changed;
- the plan answering `complete: true` shows `already exists and is complete` and `Open the Space`.
- `migration.test.tsx` (edit): the skipped step reads `Already done`.

**Verify.** All commands, `npm run e2e` included (expected failures reported).

**Out of scope.** The engine control (M9.10); the end-to-end changes (M9.11).

---

### M9.10 — Renderer: the engine start control, the Dashboard and Sessions, and Settings in 1.0 windows

**Goal.** The Space window names the engine it starts, never starts one that cannot run, offers the fix for every refusal, lists the other engines with their reason, and opens on the Dashboard after setup; Settings is reachable from 1.0 windows with the Spaces section; catalog engines cannot be removed.

**Depends on.** M9.5, M9.7, M9.8. Parallel with M9.9.

**Files and changes.**

1. Create `renderer/src/space/window/useEngineChoice.ts`: `{ choice: SpaceEngineChoice | null; error: string | null; refresh(): void; pick(engineId: string): void; reinstall(): void }`. It asks `spaceSessionEngines({})` on mount, on window focus, on `onEnginesChanged`, and on `refresh()`.
2. Create `renderer/src/space/window/EngineStartControl.tsx`:

   ```ts
   type Props = {
     choice: SpaceEngineChoice | null;
     onStart: (engineId: string) => void;
     onPick: (engineId: string) => void;
     onReinstall: () => void;
     onRefresh: () => void;
     /** Dashboard: the menu is shown only when two or more engines can start. Sessions: always. */
     menu: 'when-several' | 'always';
     buttonTestId: string;   // 'dashboard-start-session' on the Dashboard, 'new-ai' in Sessions
     noteTestId: string;     // 'dashboard-start-session-note' on the Dashboard, 'space-sessions-ai-note' in Sessions
     menuTestId: string;     // 'dashboard-start-menu' / 'space-sessions-engine-menu'
   };
   ```

   - The button: `Start a <buttonName> session`, primary style, disabled when `choice === null` or `choice.engineId === null`; click → `onStart(engineId)` and the text `Starting <name>…` until the parent reports the tab.
   - The menu button `▾` (`aria-label="Choose the engine"`) opens a `PopoverShell` (from `components/overlay/`) listing every option (`<menuTestId>-option-<engineId>`): a startable option is a button that calls `onPick`; another is `aria-disabled="true"` and reachable by keyboard, with the text `<name> — <reason>` and, when it has a fix, a link-style button (`<menuTestId>-fix-<engineId>`) with the fix label.
   - The note (`noteTestId`): ready: `Starts <name> in this Space's folder, in Read only. Writing needs your confirmation.`; not ready: `refusal.message`; `choice === null`: `Checking whether an AI session can start in this Space.`
   - When `engineId === null`, a card under the note (`<buttonTestId>-refusal`): heading `No AI session can start yet`, the fix button (`<buttonTestId>-fix`) with the fix label.
   - Fix actions: `sign-in` mounts `CommandPanel` with the fix's command under the control and calls `onRefresh` on exit; `set-up-claude-code` → `spaceNavigate({ to: 'machine-check', section: 'engines' })`; `set-up-python3` → `spaceNavigate({ to: 'machine-check', section: 'tools' })`; `reinstall-lore` → `onReinstall`; `edit-engine` → `useSpaceSettings.getState().open('engines')`. The fix's command line is shown as `Runs: <command line>` before the click.
3. `renderer/src/space/dashboard/StartSession.tsx` (rewrite, exported name kept): uses `useEngineChoice` and `EngineStartControl` with `menu: 'when-several'` and the Dashboard test ids; `onStart` → `startAiSession(engineId)`; `onPick` → `pick`. When the window's init has `justCreated`, the line `The Space is ready. Start a session to begin work; it starts in Read only.` (`dashboard-just-created`) above the control. The flag travels as props: `SpaceWindow.tsx` renders `<Dashboard justCreated={init.justCreated === true} />`, `Dashboard.tsx` gains the prop `justCreated?: boolean` and renders `<StartSession justCreated={justCreated === true} />`.
4. `renderer/src/space/window/SpaceSessions.tsx` (edit): replace the readiness logic (`readyEngineId`, `checkReadiness`, `aiReason` from `spaceSessionReadiness`) with `useEngineChoice`: `lastEngineId` of `newTabCtx` is `choice.engineId`; `aiUnavailableReason` is `choice.refusal?.message` when `engineId` is null, or `AI_READINESS_CHECKING` while `choice` is null. After a failed start, `refresh()`. The empty view: heading `Sessions`, then `EngineStartControl` with `menu: 'always'` and the Sessions test ids (`onStart` adds the AI tab with that engine, as `onNewAi` does), then `Other tabs:` with the two secondary buttons `Terminal` (`new-shell`) and `Web page` (`new-browser`; use the test id `NEW_TAB_BUTTONS` gives the browser kind today). With tabs open, the note line at the top becomes the same control in a compact row. `AI_NO_ENGINE` and `AI_SESSIONS_GUARDED` are no longer used; remove them if nothing else imports them.
5. `renderer/src/space/window/SpaceWindow.tsx` (edit): when `init.justCreated`, call `showScreen('dashboard')` once in a mount effect, so the window opens on the Dashboard; otherwise the store's initial screen, Sessions, stays. `Dashboard.tsx` (edit) takes and passes the `justCreated` prop as item 3 says.
6. Create `renderer/src/space/SpaceSettings.tsx`: a zustand store `useSpaceSettings` with `{ section: SettingsSheetSection | undefined; open(section?: SettingsSheetSection): void; close(): void }` and a component `SpaceSettings` that listens to `window.cockpit.onSettingsOpen` and renders `SettingsSheetModal` while open. Edit `SpaceSurface.tsx` to render `<SpaceSettings />` beside every screen.
7. `renderer/src/components/SettingsSheet.tsx` (edit; a v0.8 component, additive changes):
   - `SettingsSheetSection` gains `'spaces'`; `SPACES_SECTION = 'Spaces'` selected for it.
   - A row whose `def.key === 'spaces.folder'` renders `SpacesFolderControl` in place of the text input: the path in monospace or `Not set`, and `Choose…` (`setting-spaces.folder-choose`) → `spaceSpacesFolderChoose({})`; a refusal's message is shown under it; `cancelled` shows nothing.
   - `EnginesSection`: a row whose id is in `CATALOG_ENGINE_IDS` has no Remove button and shows `Listed by AI-Lore; it cannot be removed.` in muted text.

**Tests to add (component).**

- `engine-start-control.test.tsx` (new): the button names the engine; with two startable options and `menu: 'when-several'` the menu shows, with one it does not; `menu: 'always'` shows Codex CLI `aria-disabled` with `Codex CLI — guarded Space sessions are not available for this engine yet`; a `sign-in` refusal shows `No AI session can start yet`, `Sign in to Claude Code` and `Runs: claude auth login`, and clicking mounts the command panel; `set-up-claude-code` calls `spaceNavigate` with section `engines`; picking calls `onPick`.
- `dashboard.test.tsx` (edit): the start button reads `Start a Claude Code session` for a stubbed choice; `justCreated` shows the ready line.
- `space-window.test.tsx` / `space-ai-session.test.tsx` (edit): `+ AI` in the dock uses `choice.engineId`; with `engineId: null` it is disabled with the refusal as its title; the window opens on the Dashboard when `justCreated`.
- `settings-sheet-spaces.test.tsx` (new): the Spaces section shows the folder and `Choose…` calls `spaceSpacesFolderChoose`; the Engines section has no Remove for `default.claude` and has one for a hand-added engine.

**Verify.** All commands, `npm run e2e` included (expected failures in `space-window.spec.ts` reported).

**Out of scope.** Any change to the v0.8 cockpit's `+ AI` button or its dock header.

---

### M9.11 — End to end and verification

**Goal.** The end-to-end suite passes with the new screens, the new flow is covered end to end with the fake GitHub, and the stage's gate is checked item by item, automated or listed for the Human Lead.

**Depends on.** M9.1 to M9.10.

**Files and changes.**

1. `packages/app/test/space-setup.spec.ts` (edit):
   - Test "create a Space with the fake GitHub through the screens, and open it": launch without a folder; expect `machine-check` (the launch moved there because the Spaces folder is not set); `answerFolderDialog(app, parentDir)`; click `machine-spaces-folder-choose`; expect `machine-check-overall` `data-ready="true"`; click `machine-check-continue`; expect `space-welcome` and `space-welcome-machine-status` `data-ready="true"`; click `space-welcome-create`; fill `setup-field-name` and `setup-field-description`; expect `setup-field-owner` to have the value `fake-human` and no text input for the owner; expect `setup-location` to read `parentDir`; expect `setup-will-create` to contain `<parentDir>/e2e-created` and `a new folder.`; click `setup-continue`; expect `setup-check-repository` then `setup-plan`; expect `setup-confirm-question` `Create the Space e2e-created?`; click `setup-confirm`; expect `setup-finished` with the heading `The Space e2e-created is ready.`; expect no step row text `skipped`; expect `setup-by-hand` with three `Open this view` buttons; the fake GitHub's state checks stay as today; click `setup-open-space`; expect the Space window on the Dashboard with `dashboard-start-session` reading `Start a Claude Code session` (do not click it).
   - New test "a second launch with the Spaces folder set opens the welcome screen": seed `settings.json` in `userData` with `{"schemaVersion":1,"values":{"spaces.folder":"<parentDir>"},"ignores":[]}`; launch; expect `space-welcome` and no `machine-check` within 10 seconds.
   - New test "a complete Space of the same name is found while typing": after the first test's steps in the same app (or a seeded Space created with core's fixture in `parentDir` whose manifest names `fake-human/e2e-created`), open New Space, type the name, expect `setup-open-existing` and no `setup-continue`.
   - New test "Set up this computer with GitHub signed out": seed the fake signed out; launch; expect `machine-row-github` with `Sign in with GitHub` and `Runs: gh auth login --hostname github.com --web --clipboard --git-protocol https --scopes project && gh auth setup-git`; do not click it.
   - The plain-repository test: `setup-about-folder` is now `setup-source`.
2. `packages/app/test/space-window.spec.ts` (edit): the empty view's `new-ai` is the start control's button; `space-sessions-ai-note` still matches `/^No AI session/`; add: the `space-sessions-engine-menu` lists `Codex CLI` with `aria-disabled="true"` and the reason text.
3. `packages/app/test/space-dashboard.spec.ts` (edit if needed): the stand-in `claude` entry is merged into `default.claude` by the catalog merge; `removedDefaults` in the seeded file is dropped by the app; the `startSession` helper keeps `dashboard-start-session`.
4. Any other selector broken by M9.8 to M9.10 in the end-to-end suite, repaired to the new test ids; no test deleted or skipped.

**Verification to run and report.**

```
npm run build -w @ai-lore-companion/core
npm run typecheck -w @ai-lore-companion/app
npm run lint
npm test
npm run e2e
```

Then a table in the phase report, one row per acceptance item of section 8 of `onboarding-product.md` (items 1 to 25), with: automated by which test, or manual, and for manual items the steps below.

**Manual checks left for the Human Lead** (need live GitHub, the real engines, or a clean account; use a second macOS user, or `GH_CONFIG_DIR` set to an empty folder and the app's user data folder moved aside):

- Items 1 to 4: sign-in through the browser, the one-time code on the page and on the clipboard, the row turning fine by itself, the scope fix, and `git push` of a private repository without a password after `gh auth setup-git`.
- Items 5 to 8: install and sign in of a real engine from the page (Claude Code at least); the page ready with the optional engines missing.
- Item 9: Use this folder with the proposed folder (on this machine the proposal is `~/volatile`, the parent of the most recent Space).
- Items 14 and 19: a plan against live GitHub in under ten seconds for a new name, the `github-call` log lines with their times, and a revoked `project` scope fixed from the result screen.
- Items 21, 22 and 25: a real Claude Code session from a new Space; the Human Lead's own `engines.json` (Gemini first) leading to Claude Code; Claude Code signed out, then signed in from the Space window.
- Item 24: Codex CLI, Antigravity CLI or OpenCode started in a v0.8 project window's AI tab once installed.

**Out of scope.** Changes to screens or behaviour; a failure found here that belongs to an earlier phase goes back to that phase's owner file, fixed here only when it is a selector or a test.
