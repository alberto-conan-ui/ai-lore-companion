import type {
  Altitude,
  AppEntry,
  ChainError,
  ChainResult,
  ChangeEntry,
  ChangeScope,
  Commitment,
  EngineEntry,
  IgnoreRule,
  MemoryFrontmatter,
  MemorySections,
  Posture,
  SettingDef,
  SettingValue,
  SettingsFile,
  TreeNode,
  WriteTier,
} from '@ai-lore-companion/core';

export type { ChangeScope };

/**
 * Type-only ChainResult discriminator that does not require importing
 * `@ai-lore-companion/core`'s runtime module — used by the renderer, which
 * cannot bundle core's Node-native dependencies.
 */
export function isChainErrorPayload(chain: ChainResult): chain is ChainError {
  return 'error' in chain;
}

export const IPC = {
  /** Main → renderer: the window's mode — welcome or cockpit — sent once on load. */
  WindowInit: 'cockpit:window-init',
  /** Main → renderer: full chain result (sent once on renderer ready). */
  Chain: 'cockpit:chain',
  /**
   * Main → renderer: changes snapshot for one repo against its current
   * baseline. Pushed on launch (both sides) and whenever the debounced
   * [changes tracker](../../../core/src/changes/tracker.ts) sees the snapshot
   * move. The channel keeps its v0.5-era constant string for backwards
   * compatibility with stored layouts.
   */
  Changes: 'cockpit:git-status',
  /**
   * Renderer → main: flip the baseline for one scope. The changes tracker
   * re-reads immediately and pushes the resulting snapshot via `Changes`.
   */
  SetBaseline: 'cockpit:set-baseline',
  /**
   * Main → renderer: recent commits for one repo, newest first, with
   * save-point badges attached where a SHA matches a `lore_commit` /
   * `payload_commit` in the save-points ledger. Pushed on launch and on
   * every changes-tracker tick (commits move HEAD, which the tracker sees).
   */
  CommitList: 'cockpit:commit-list',
  /**
   * Renderer → main: read the unified-diff text for one path against one
   * baseline. Used by the Changes panel's inline preview.
   */
  DiffText: 'cockpit:diff-text',

  /** Main → renderer: per-side root trees (sent once after Restore). */
  TreeInit: 'cockpit:tree-init',
  /** Main → renderer: refreshed children for a directory whose contents changed. */
  TreeUpdate: 'cockpit:tree-update',

  // (The v0.5 *Dismiss* / *Dismiss all* channels were removed in v0.6 Phase A.
  // Drift now persists until the file is committed via the AI session's
  // ack / save-point verbs, or reverted via git. The companion never
  // dismisses rows behind git's back.)
  /**
   * Renderer → main: open a file's diff against the latest save-point in the
   * configured external diff app. The diff app is the catalog's `role: 'diff'`
   * entry; when absent the result kind is `'no-cli'` so the renderer can
   * prompt the user to add one.
   */
  OpenDiff: 'cockpit:open-diff',
  /**
   * Renderer → main: replace the global Apps catalog. The renderer sends the
   * full list — same shape as the catalog editor renders. Returns the new
   * settings snapshot.
   */
  AppsSave: 'cockpit:apps-save',
  /**
   * Renderer → main: invoke a catalog app on a path. Dispatches to `open -a`
   * (`kind: 'app'`) or `spawn(cli, argv)` (`kind: 'cli'` non-diff). Diff
   * invocations go through `IPC.OpenDiff`, not here.
   */
  AppsInvoke: 'cockpit:apps-invoke',
  /** Renderer → main: open a path in the OS default application. */
  OpenPath: 'cockpit:open-path',
  /**
   * Renderer → main: reveal a path in Finder. For a folder, opens the folder
   * in Finder; for a file, opens the parent folder with the file highlighted.
   */
  RevealInFinder: 'cockpit:reveal-in-finder',
  /** Renderer → main: read a directory's children on demand. */
  TreeExpand: 'cockpit:tree-expand',
  /** Renderer → main: recursively search file names under the given directories. */
  FileSearch: 'cockpit:file-search',
  /** Renderer → main: open a project — a given folder, or prompt a folder dialog. */
  OpenProject: 'cockpit:open-project',
  /** Renderer → main: re-run AI-Lore detection on this window's folder. */
  Reload: 'cockpit:reload',
  /** Renderer → main: open a URL in the OS default browser. */
  OpenExternal: 'cockpit:open-external',

  /** Renderer → main: spawn a terminal PTY; resolves to its id. */
  TerminalSpawn: 'terminal:spawn',
  /**
   * Renderer → main: spawn a terminal PTY running a specific engine binary
   * (the AI tab's Start button). The engine command and argv are passed
   * through a login shell so PATH resolves the binary by name. Resolves to
   * the PTY id, same as `TerminalSpawn`.
   */
  TerminalSpawnEngine: 'terminal:spawn-engine',
  /** Renderer → main: keystrokes for a terminal. */
  TerminalInput: 'terminal:input',
  /** Renderer → main: resize a terminal. */
  TerminalResize: 'terminal:resize',
  /** Renderer → main: kill a terminal. */
  TerminalKill: 'terminal:kill',
  /** Main → renderer: output bytes from a terminal. */
  TerminalData: 'terminal:data',
  /** Main → renderer: a terminal's shell exited on its own. */
  TerminalExit: 'terminal:exit',
  /** Main → renderer: a terminal's foreground status — idle/running + command. */
  TerminalStatus: 'terminal:status',

  /** Renderer → main: create the `WebContentsView` for a browser tab. */
  BrowserCreate: 'browser:create',
  /** Renderer → main: destroy a browser tab's view (the tab was closed). */
  BrowserDestroy: 'browser:destroy',
  /** Renderer → main: show or hide a browser tab's view. */
  BrowserSetVisible: 'browser:set-visible',
  /** Renderer → main: position a browser tab's view within the window. */
  BrowserSetBounds: 'browser:set-bounds',
  /** Renderer → main: load a URL (or search) in a browser tab. */
  BrowserNavigate: 'browser:navigate',
  /** Renderer → main: browser tab back. */
  BrowserGoBack: 'browser:go-back',
  /** Renderer → main: browser tab forward. */
  BrowserGoForward: 'browser:go-forward',
  /** Renderer → main: reload a browser tab. */
  BrowserReload: 'browser:reload',
  /** Renderer → main: switch a browser tab's profile. */
  BrowserSetProfile: 'browser:set-profile',
  /** Renderer → main: hide / restore every browser view in the window so a DOM overlay can sit on top. */
  BrowserSuppressAll: 'browser:suppress-all',
  /** Main → renderer: a browser tab's state — url, nav availability, profile. */
  BrowserState: 'browser:state',
  /** Renderer → main: the current URL of a browser tab — for the layout snapshot. */
  BrowserGetUrl: 'browser:get-url',

  /** Renderer → main: list configured app-launch shortcuts. */
  /** Main → renderer: a `terminal` shortcut fired — spawn a tab + run the command. */
  ShortcutOpenTerminal: 'shortcut:open-terminal',
  ShortcutsList: 'shortcuts:list',
  /** Renderer → main: run a shortcut by id on this window's target folder. */
  ShortcutsRun: 'shortcuts:run',
  /** Renderer → main: show the native app picker; resolves to an app path. */
  ShortcutsPickApp: 'shortcuts:pick-app',
  /** Renderer → main: add a shortcut; resolves to the updated list. */
  ShortcutsAdd: 'shortcuts:add',
  /** Renderer → main: remove a shortcut by id; resolves to the updated list. */
  ShortcutsRemove: 'shortcuts:remove',
  /** Main → renderer: the configured shortcut list changed. */
  ShortcutsChanged: 'shortcuts:changed',

  /** Renderer → main: the window's settings snapshot — registry, resolved values, raw tiers. */
  SettingsGet: 'settings:get',
  /** Renderer → main: write a setting into a tier; resolves to the fresh snapshot. */
  SettingsSet: 'settings:set',
  /** Main → renderer: the settings changed — a fresh snapshot for this window. */
  SettingsChanged: 'settings:changed',
  /** Renderer → main: replace a tier's ignore rules; resolves to the fresh snapshot. */
  SettingsSetIgnores: 'settings:set-ignores',
  /** Main → renderer: the macOS App menu's Settings… item (or ⌘,) was triggered. */
  SettingsOpen: 'settings:open',
  /** Main → renderer: the user fired `⌘+N` (1..9) — select the Nth cockpit
   *  tab in the left panel and focus its tree. Payload is the 1-based index. */
  SelectCockpitTab: 'cockpit:select-tab',
  /** Main → renderer: the user fired `⌘+F` — focus the global file search. */
  FocusGlobalSearch: 'cockpit:focus-search',

  /**
   * Renderer → main: update one field of the AI-Lore conversational register
   * — posture, altitude, or commitment — by writing the value to the active
   * project's `status.index.md` frontmatter. Triggers an immediate
   * `IPC.Chain` re-broadcast so the header reflects the new value without
   * waiting for the 5-second poll.
   */
  SetRegister: 'cockpit:set-register',

  /**
   * Renderer → main: read a focus or AT-node Memory file and return its
   * parsed frontmatter + body sections — the in-app focus view's data
   * source. The path is validated to live inside this window's project.
   */
  FocusRead: 'cockpit:focus-read',

  /** Renderer → main: list configured AI engines. */
  EnginesList: 'engines:list',
  /** Renderer → main: replace the global engines list. */
  EnginesSave: 'engines:save',
  /** Main → renderer: the configured engines list changed. */
  EnginesChanged: 'engines:changed',
  /**
   * Renderer → main: read the engine id last picked in this window's project,
   * or `null` if none. Used to preselect the AI tab's engine dropdown.
   */
  EngineLastGet: 'engines:last-get',
  /** Renderer → main: persist the engine id picked in this window's project. */
  EngineLastSet: 'engines:last-set',
  /** Renderer → main: read the persisted prompts-column width for this
   *  project's AI tabs (Phase C), or `null` when none has been set. */
  AiPromptsWidthGet: 'engines:prompts-width-get',
  /** Renderer → main: persist the prompts-column width for this project. */
  AiPromptsWidthSet: 'engines:prompts-width-set',
  /** Renderer → main: read the prompts catalog (verbs vendored under
   *  `<lore>/process/verbs/`) for this window's project. */
  PromptsList: 'prompts:list',
  /** Main → renderer: the prompts catalog changed (a verb file was
   *  added/edited/removed under `<lore>/process/verbs/`). The renderer
   *  re-fetches via `PromptsList`. */
  PromptsChanged: 'prompts:changed',
} as const;

export type ChainPayload = ChainResult;
/** Per-scope drift snapshot pushed from main. */
export type ChangesPayload = {
  scope: ChangeScope;
  entries: ChangeEntry[];
  /** The baseline these entries were read against — `'HEAD'` or a commit SHA.
   *  The renderer mirrors it into `baselineByScope` so the dropdown stays in
   *  sync with the main-side tracker (which seeds to the latest save-point). */
  baseline: string;
};

/** One entry in the per-scope baseline dropdown. `savePoint` is set when the
 *  commit's SHA matches a save-point ledger entry — the dropdown shows a
 *  badge + the save-point's title in that case. */
export type CommitListEntry = {
  /** Full 40-char SHA. */
  sha: string;
  /** Commit subject (first line of the message). */
  subject: string;
  /** Save-point match when present. */
  savePoint?: { title: string };
};

/** Per-scope commit-list snapshot pushed from main. */
export type CommitListPayload = { scope: ChangeScope; commits: CommitListEntry[] };

/** Renderer → main: flip a scope's baseline. */
export type SetBaselineArg = { scope: ChangeScope; baseline: string };

/** Renderer → main: read unified-diff text for one path against one baseline. */
export type DiffTextArg = { scope: ChangeScope; baseline: string; relPath: string };

/** Result of an `IPC.DiffText` invoke. */
export type DiffTextResult =
  | { kind: 'ok'; text: string }
  | { kind: 'failed'; message: string };

/** A project folder the user has opened — an entry in the recents list. */
export type RecentProject = { path: string; openedAt: number };

/** Why the window is in altered mode — drives the banner copy. */
export type AlteredReason =
  | { kind: 'not-ai-lore' }
  | { kind: 'version-too-old'; currentVersion: string | null; minimumVersion: string };

/**
 * Main → renderer, once per window on load: what the window is. A welcome
 * window carries the recents list; an altered window carries the folder path
 * and a `reason` for its disclaimer banner — either "not an AI-Lore project"
 * or "the project is too old, upgrade required".
 */
export type WindowInitPayload =
  | { mode: 'welcome'; recents: RecentProject[] }
  | { mode: 'cockpit' }
  | { mode: 'altered'; folder: string; reason: AlteredReason };

/** Per-side root trees, each populated one level deep. */
export type TreeInitPayload = {
  payload: TreeNode;
  lore: TreeNode;
  /**
   * v0.8 Phase B — Publishing-shape projects carry a third tree, rooted at
   * `<project>/publish/`. Absent for default-shape projects.
   */
  publish?: TreeNode;
};
/** Refreshed children for `path` on the given side. */
export type TreeUpdatePayload = { scope: ChangeScope; path: string; children: TreeNode[] };
/** Argument to a `tree-expand` request. */
export type TreeExpandArg = { scope: ChangeScope; path: string };

/** A global file-search request — absolute directories to walk, and the query. */
export type FileSearchArg = { dirs: string[]; query: string };
/** One file matched by a search — its base name and absolute path. */
export type FileSearchHit = { name: string; path: string };

/** Keystrokes (or pasted text) bound for a terminal's PTY. */
export type TerminalInputArg = { id: string; data: string };
/** A terminal resize request, in character cells. */
export type TerminalResizeArg = { id: string; cols: number; rows: number };
/** Output bytes streamed from a terminal's PTY. */
export type TerminalDataPayload = { id: string; data: string };
/** A terminal whose shell process exited. */
export type TerminalExitPayload = { id: string };

/** A terminal's foreground state: its shell is idle, or it is running a task. */
export type TerminalForegroundStatus = 'idle' | 'running';
/**
 * Main → renderer: a terminal's foreground status. `command` is the full
 * command line of the running task while `running`, and `''` while `idle`.
 */
export type TerminalStatusPayload = {
  id: string;
  status: TerminalForegroundStatus;
  command: string;
};

/** Pixel bounds for the browser companion view, in window content coordinates. */
export type BrowserBounds = { x: number; y: number; width: number; height: number };

/** The named, session-isolated browser profiles the companion offers. */
export const BROWSER_PROFILES = ['Default', 'Work', 'Personal'] as const;
export type BrowserProfile = (typeof BROWSER_PROFILES)[number];

/** Main → renderer: a browser tab's current state, for its toolbar. */
export type BrowserStatePayload = {
  tabId: string;
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  profile: BrowserProfile;
};

/** What an app-launch shortcut opens: a folder in an app, a URL in Chrome,
 *  or a terminal tab running a command. */
export type ShortcutTarget = 'project' | 'lore' | 'url' | 'terminal';

/**
 * A configured shortcut. `project` / `lore` targets carry `app` (a macOS app
 * path passed to `open -a` on the folder); a `url` target carries `url`,
 * opened in Chrome; a `terminal` target carries `command`, run in a new
 * terminal tab. `iconUrl` is set by main when the shortcut has an extractable
 * icon (data URL of the `.app`'s icon) — absent otherwise.
 */
export type Shortcut = {
  id: string;
  label: string;
  target: ShortcutTarget;
  app?: string;
  url?: string;
  command?: string;
  iconUrl?: string;
};

/** The fields needed to create a shortcut; `main` assigns the id. */
export type ShortcutInput = {
  label: string;
  target: ShortcutTarget;
  app?: string;
  url?: string;
  command?: string;
};

/** Push payload for a `terminal` shortcut: open a new terminal tab and run `command`. */
export type ShortcutTerminalPayload = { label: string; command: string };

/**
 * A window's view of the settings store: the registry to render, the resolved
 * value for every setting, and the raw per-tier files so the UI can show what
 * each tier overrides. `project` is null for a window with no AI-Lore project.
 */
export type SettingsSnapshot = {
  registry: readonly SettingDef[];
  resolved: Record<string, SettingValue>;
  global: SettingsFile;
  project: SettingsFile | null;
  /** The built-in ignore rules, beneath the global and per-project tiers. */
  defaultIgnores: readonly IgnoreRule[];
};

/** A write to the settings store — a value for one key in one tier. */
export type SettingsSetArg = { tier: WriteTier; key: string; value: SettingValue };

/** A write to a tier's ignore rules — the complete replacement list. */
export type SettingsSetIgnoresArg = { tier: WriteTier; rules: IgnoreRule[] };

/**
 * One field of the AI-Lore conversational register. `posture` lives on
 * `status.index.md` at the top level; `altitude` and `commitment` live
 * nested under `dials:`.
 */
export type SetRegisterArg =
  | { field: 'posture'; value: Posture }
  | { field: 'altitude'; value: Altitude }
  | { field: 'commitment'; value: Commitment };

/**
 * The renderer's request for a Memory file's parsed contents. The absolute
 * `path` must live inside the requesting window's project — main rejects
 * anything else with an `error` result.
 */
export type FocusReadArg = { path: string };

/**
 * Main's response to `IPC.FocusRead`. The `frontmatter` is the typed
 * frontmatter union from core; `sections` is the body's H2 sections keyed
 * by label (e.g. "Gate", "Vision", "Context"). On any failure the result
 * carries `error` instead.
 */
export type FocusReadResult =
  | {
      path: string;
      frontmatter: MemoryFrontmatter | null;
      sections: MemorySections;
    }
  | { error: string };

export function isFocusReadError(result: FocusReadResult): result is { error: string } {
  return 'error' in result;
}

/** The renderer's request to open a file's diff against a baseline. */
export type OpenDiffArg = {
  scope: ChangeScope;
  /** Path relative to the Payload project root — the same shape change entries carry. */
  relPath: string;
  /**
   * The commit to diff against. `'HEAD'` falls back to the latest save-point
   * when the panel has not picked a non-HEAD baseline yet — `HEAD` materialised
   * vs working tree is a no-op diff that wastes the user's external app.
   */
  baseline: string;
};

/**
 * Main's response to `IPC.OpenDiff`. The `ok` case fired the configured CLI;
 * the others explain why the diff did not open and let the renderer act
 * (fall back to OS-default for `no-cli`, surface a toast for the rest).
 */
export type OpenDiffResult =
  /** The configured external diff CLI was spawned. */
  | { kind: 'ok'; cli: string }
  /** No external CLI configured in Settings — renderer may fall back to OS open. */
  | { kind: 'no-cli' }
  /** No save-point recorded — there is no baseline to diff against. */
  | { kind: 'no-save-point' }
  /** Something failed materialising the baseline or spawning the CLI. */
  | { kind: 'failed'; message: string };

/** The renderer's request to invoke a catalog app on a node path. */
export type AppsInvokeArg = {
  /** The `AppEntry.id` to invoke. */
  appId: string;
  /** Absolute path to the file or folder the app should open. */
  path: string;
};

/** Main's response to `AppsInvoke`. */
export type AppsInvokeResult =
  | { kind: 'ok' }
  | { kind: 'not-found' }
  | { kind: 'failed'; message: string };

/**
 * Renderer → main: spawn a PTY running an AI engine (the AI tab's Start
 * button). The engine binary may be a bare name (resolved on the user's
 * login-shell PATH at spawn) or an absolute path.
 */
export type TerminalSpawnEngineArg = {
  /** Engine binary — bare name or absolute path. */
  binary: string;
  /** Optional argv passed after the binary. */
  args?: string[];
};

/** One verb in the prompts catalog (Phase D). Surfaces in the AI tab's left
 *  column; a click writes `${slash}\n` to the running engine's stdin. */
export type PromptEntry = {
  /** Filename stem of the verb — e.g. `orient`, `save-point`. */
  name: string;
  /** Slash form injected on click — `/ai-lore-<name>`. */
  slash: string;
  /** One-line description from `verbs.index.md`; empty when missing. */
  description: string;
  /** From `verbs.index.md`'s Kind column; `unknown` when the table is absent
   *  or this verb is not listed. */
  kind: 'verb' | 'bookend' | 'unknown';
};

export type Unsubscribe = () => void;

export type CockpitApi = {
  onWindowInit: (handler: (payload: WindowInitPayload) => void) => Unsubscribe;
  onChain: (handler: (chain: ChainPayload) => void) => Unsubscribe;
  onChanges: (handler: (payload: ChangesPayload) => void) => Unsubscribe;
  /** Subscribe to per-scope commit-list pushes — the Changes-panel baseline dropdown. */
  onCommitList: (handler: (payload: CommitListPayload) => void) => Unsubscribe;
  /** Flip a scope's baseline; the next Changes push reflects the new value. */
  setBaseline: (arg: SetBaselineArg) => Promise<void>;
  /** Read the unified-diff text for one path against one baseline. */
  diffText: (arg: DiffTextArg) => Promise<DiffTextResult>;
  onTreeInit: (handler: (payload: TreeInitPayload) => void) => Unsubscribe;
  onTreeUpdate: (handler: (payload: TreeUpdatePayload) => void) => Unsubscribe;
  openPath: (path: string) => Promise<string>;
  revealInFinder: (path: string) => void;
  treeExpand: (arg: TreeExpandArg) => Promise<TreeNode[]>;
  searchFiles: (arg: FileSearchArg) => Promise<FileSearchHit[]>;
  openProject: (path?: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  reload: () => Promise<void>;
  spawnTerminal: () => Promise<string>;
  /** Spawn a PTY running an AI engine — resolves to the PTY id. */
  spawnTerminalEngine: (arg: TerminalSpawnEngineArg) => Promise<string>;
  sendTerminalInput: (arg: TerminalInputArg) => void;
  resizeTerminal: (arg: TerminalResizeArg) => void;
  killTerminal: (id: string) => void;
  onTerminalData: (handler: (payload: TerminalDataPayload) => void) => Unsubscribe;
  onTerminalExit: (handler: (payload: TerminalExitPayload) => void) => Unsubscribe;
  onTerminalStatus: (handler: (payload: TerminalStatusPayload) => void) => Unsubscribe;
  /** Create a browser tab. An `initialUrl` seeds it instead of the home page. */
  browserCreate: (tabId: string, initialUrl?: string) => void;
  browserDestroy: (tabId: string) => void;
  /** Read the current URL of a browser tab — for the layout snapshot. */
  browserGetUrl: (tabId: string) => Promise<string | null>;
  browserSetVisible: (tabId: string, visible: boolean) => void;
  browserSetBounds: (tabId: string, bounds: BrowserBounds) => void;
  browserNavigate: (tabId: string, url: string) => void;
  browserGoBack: (tabId: string) => void;
  browserGoForward: (tabId: string) => void;
  browserReload: (tabId: string) => void;
  browserSetProfile: (tabId: string, profile: BrowserProfile) => void;
  /** Hide every browser view in this window (`true`) or restore them (`false`). */
  browserSuppressAll: (suppress: boolean) => void;
  onBrowserState: (handler: (state: BrowserStatePayload) => void) => Unsubscribe;
  shortcutsList: () => Promise<Shortcut[]>;
  shortcutsRun: (id: string) => void;
  shortcutsPickApp: () => Promise<string | null>;
  shortcutsAdd: (input: ShortcutInput) => Promise<Shortcut[]>;
  shortcutsRemove: (id: string) => Promise<Shortcut[]>;
  onShortcutsChanged: (handler: (list: Shortcut[]) => void) => Unsubscribe;
  /** A `terminal` shortcut was run — open a new terminal tab and execute `command`. */
  onOpenTerminalShortcut: (handler: (payload: ShortcutTerminalPayload) => void) => Unsubscribe;
  settingsGet: () => Promise<SettingsSnapshot>;
  settingsSet: (arg: SettingsSetArg) => Promise<SettingsSnapshot>;
  settingsSetIgnores: (arg: SettingsSetIgnoresArg) => Promise<SettingsSnapshot>;
  onSettingsChanged: (handler: (snapshot: SettingsSnapshot) => void) => Unsubscribe;
  /** Subscribe to the macOS App menu's Settings… item firing (also `⌘,`). */
  onSettingsOpen: (handler: () => void) => Unsubscribe;
  /** Subscribe to ⌘+1..⌘+9 — select the Nth cockpit tab (1-based). */
  onSelectCockpitTab: (handler: (index: number) => void) => Unsubscribe;
  /** Subscribe to ⌘+F — focus the global file search. */
  onFocusGlobalSearch: (handler: () => void) => Unsubscribe;
  /**
   * Update one field of the AI-Lore register on the active project's
   * `status.index.md` frontmatter. Resolves when the file has been written
   * and the chain has been re-broadcast.
   */
  setRegister: (arg: SetRegisterArg) => Promise<void>;
  /**
   * Read a focus or AT-node Memory file's parsed frontmatter + sections.
   * Used by the in-app focus view to render gate / vision / context /
   * scope / watch-outs without leaving the cockpit.
   */
  focusRead: (arg: FocusReadArg) => Promise<FocusReadResult>;
  /**
   * Open a file's diff against the latest save-point in the configured
   * external diff app. Resolves to a status union so the renderer can show
   * the right tooltip / fallback.
   */
  openDiff: (arg: OpenDiffArg) => Promise<OpenDiffResult>;
  /** Replace the global Apps catalog; returns the new settings snapshot. */
  appsSave: (apps: AppEntry[]) => Promise<SettingsSnapshot>;
  /** Invoke a catalog app on a node path. */
  appsInvoke: (arg: AppsInvokeArg) => Promise<AppsInvokeResult>;
  /** List configured AI engines — back-filled with PATH-resolvable defaults. */
  enginesList: () => Promise<EngineEntry[]>;
  /** Replace the global engines list; resolves to the new list. */
  enginesSave: (engines: EngineEntry[]) => Promise<EngineEntry[]>;
  /** Subscribe to engine-list changes. */
  onEnginesChanged: (handler: (engines: EngineEntry[]) => void) => Unsubscribe;
  /** The engine id last picked in this window's project, or null. */
  engineLastGet: () => Promise<string | null>;
  /** Persist the engine id just picked in this window's project. */
  engineLastSet: (engineId: string) => Promise<void>;
  /** The prompts-column width persisted for this window's project, or null. */
  aiPromptsWidthGet: () => Promise<number | null>;
  /** Persist the prompts-column width for this window's project. */
  aiPromptsWidthSet: (width: number) => Promise<void>;
  /** Read the prompts catalog (vendored verbs) for this window's project. */
  promptsList: () => Promise<PromptEntry[]>;
  /** Subscribe to prompts-catalog changes — fires when a verb file changes. */
  onPromptsChanged: (handler: () => void) => Unsubscribe;
};

declare global {
  interface Window {
    cockpit: CockpitApi;
  }
}
