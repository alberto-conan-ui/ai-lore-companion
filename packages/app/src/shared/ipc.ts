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
  WorkspaceLayout,
  WriteTier,
} from '@ai-lore-companion/core';

export type { ChangeScope };

/**
 * The channel + direction descriptors live in [`ipc/contract.ts`](./ipc/contract.ts)
 * — the single table the channel strings, the preload bridge, the `CockpitApi`
 * surface, and the main-side registrar all derive from. The payload / argument
 * **types** still live in this file (below); the contract references them.
 */
export {
  CHANNELS,
  CONTRACT,
  type ArgsOf,
  type CockpitApi,
  type ContractKey,
  type InvokeKey,
  type ResOf,
  type SendKey,
  type Unsubscribe,
} from './ipc/contract.js';

/**
 * Type-only ChainResult discriminator that does not require importing
 * `@ai-lore-companion/core`'s runtime module — used by the renderer, which
 * cannot bundle core's Node-native dependencies.
 */
export function isChainErrorPayload(chain: ChainResult): chain is ChainError {
  return 'error' in chain;
}

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
  /** Committer date, Unix epoch **seconds** — ordering + ack-pairing across repos. */
  timestamp: number;
  /** Save-point match when present. */
  savePoint?: { title: string };
};

/** Per-scope commit-list snapshot pushed from main. */
export type CommitListPayload = { scope: ChangeScope; commits: CommitListEntry[] };

/**
 * One save-point, projected from the ledger for the global baseline picker.
 * Carries **both** repo commits so the picker pairs the two panes from one
 * logical selection (the renderer never sees the two-commit detail). Pushed
 * via `onSavePoints`, newest first.
 */
export type SavePointInfo = {
  /** Ledger filename — the stable id behind a save-point milestone. */
  name: string;
  /** Save-point title. */
  title: string;
  /** `YYYY-MM-DD` from the ledger frontmatter. */
  date: string;
  /** Payload-repo commit SHA. */
  payloadCommit: string;
  /** Lore-repo commit SHA. */
  loreCommit: string;
};

/** Save-point ledger snapshot pushed from main, newest first. */
export type SavePointsPayload = { savePoints: SavePointInfo[] };

/** Renderer → main: flip a scope's baseline. */
export type SetBaselineArg = { scope: ChangeScope; baseline: string };

/** Renderer → main: read unified-diff text for one path against one baseline. */
export type DiffTextArg = { scope: ChangeScope; baseline: string; relPath: string };

/** Result of an `IPC.DiffText` invoke. */
export type DiffTextResult = { kind: 'ok'; text: string } | { kind: 'failed'; message: string };

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

/** A global file-search request — absolute directories to walk (the checked
 *  scopes), the query, and whether to include ignored/hidden files. The scope
 *  checkboxes choose `dirs`; `includeIgnored` switches the name search from the
 *  watcher-fed index to an unfiltered `rg --files` scan. */
export type FileSearchArg = { dirs: string[]; query: string; includeIgnored?: boolean };
/** One file matched by a search — its base name and absolute path. `ignored` is
 *  set when the file is only present because the include-ignored toggle is on
 *  (it would normally be excluded) — the dialog badges it. */
export type FileSearchHit = { name: string; path: string; ignored?: boolean };

/** A content-search request — same dirs + query as the name search, plus the
 *  include-ignored flag (drops the ignore globs and adds `--no-ignore --hidden`). */
export type ContentSearchArg = { dirs: string[]; query: string; includeIgnored?: boolean };
/** One in-file match from ripgrep content search: the file, the 1-based line
 *  and column of the match, and the matching line's text as a snippet. */
export type ContentSearchHit = {
  name: string;
  path: string;
  line: number;
  column: number;
  snippet: string;
  /** Set when this match is in a normally-ignored file (include-ignored on). */
  ignored?: boolean;
};
/** Content-search result — the hits, plus whether ripgrep was missing on PATH
 *  (so the renderer can hint at installing it rather than showing "no matches"). */
export type ContentSearchResult = { hits: ContentSearchHit[]; ripgrepMissing: boolean };

/** Keystrokes (or pasted text) bound for a terminal's PTY. */
export type TerminalInputArg = { id: string; data: string };

/**
 * Software flow-control tokens for PTY backpressure (Focus 4). The PTY is
 * spawned with node-pty's `handleFlowControl`, which intercepts these on the
 * input path — `PTY_FLOW_PAUSE` (XOFF) pauses reading from the child,
 * `PTY_FLOW_RESUME` (XON) resumes — rather than forwarding them. The renderer
 * sends them through the normal input channel when xterm's parse buffer crosses
 * the high/low-water mark, so a flood (`yes`, a big `cat`) cannot outrun the UI.
 * These are the conventional terminal flow-control codes (Ctrl+S / Ctrl+Q).
 */
export const PTY_FLOW_PAUSE = '\x13';
export const PTY_FLOW_RESUME = '\x11';

/**
 * Renderer-safe mirror of core's `WORKSPACE_LAYOUT_SCHEMA_VERSION`. The renderer
 * stamps captured layout snapshots with it; importing the value straight from
 * the core barrel would drag the main-process watcher (chokidar) into the
 * renderer bundle, so it is mirrored here instead. **Keep in lockstep with
 * `@ai-lore-companion/core`'s constant.**
 */
export const WORKSPACE_LAYOUT_SCHEMA_VERSION = 1;
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

/** Main → renderer: focus a browser tab's address bar (the ⌘L handler). */
export type BrowserFocusUrlPayload = { tabId: string };

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

/** Replace the per-project workspace-layout snapshot — or clear it with `null`. */
export type SettingsSetLayoutArg = { layout: WorkspaceLayout | null };

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
   * Source path (project-relative) for a renamed/copied entry — set when the
   * change code is `R`/`C`. The baseline ("before") side is materialised from
   * this path at the commit; without it a moved file has no baseline version and
   * the external diff opens it as a brand-new file. Absent for non-rename entries.
   */
  oldPath?: string;
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

/**
 * The read-only AI assistant ("helper") the app drives on the user's behalf
 * (AI Helper). A canned read-only action the assistant panel can request:
 * `summarize-pending` reads `status.index.md`; `what-changed` summarizes the
 * project's current drift (the app supplies the change list — the helper can't
 * run git); `orient` is the app-fired first turn that makes the helper read
 * `ai_readme.md` and walk the focus chain before answering anything (no button —
 * it auto-runs once the session is ready). `dashboard` (CR9 Phase 4) asks the
 * helper to read the lore and return a **structured JSON** snapshot — what the
 * project is doing, recently done, what's next, risks — in plain human language,
 * which the app renders as a glanceable dashboard (no walls of text). Free-text
 * questions go through `helperAskText`, not this union.
 */
export type HelperAction = 'summarize-pending' | 'what-changed' | 'orient' | 'dashboard';

/**
 * The lifecycle phase of the app-driven helper session, pushed to the renderer
 * as it advances. `connecting` → the read-only `claude` PTY is spawning;
 * `ready` → its SessionStart hook reported in; `thinking` → a turn was injected
 * and is in flight; `answered` → the Stop hook returned the answer; `error` →
 * the turn or the connection failed.
 */
export type HelperPhase = 'connecting' | 'ready' | 'thinking' | 'answered' | 'error';

/**
 * Main → renderer: a state change on a window's helper session. `answer` is set
 * on `answered`; `error` carries a human message on `error`. `ptyId` is set on
 * the first (`connecting`) event (CR2) — it's the id of the helper's visible
 * terminal, which the Assistant panel binds an xterm to. The single egress
 * channel for the helper — more phases / fields grow per CR.
 */
export type HelperEventPayload = {
  sessionId: string;
  phase: HelperPhase;
  /** The helper's visible-terminal PTY id (set on `connecting`, CR2). */
  ptyId?: string;
  answer?: string;
  error?: string;
};

/**
 * Main → renderer: a **structured result** the read-only helper reported by
 * calling an MCP tool (AI Helper, CR10). The successor to scraping the board out
 * of the `answer` text: the assistant calls `report_dashboard(board)` on the
 * app-hosted local MCP server, the host validates the argument, and it arrives
 * here as typed data — no stdout, no envelope, no parse. `tool` names which
 * report fired (`report_dashboard` today; `report_humanized` /
 * `report_consolidation` / `report_answer` as CR10 grows); `payload` is that
 * tool's validated argument, narrowed by `tool` on the renderer.
 */
export type HelperReportPayload = {
  sessionId: string;
  tool: string;
  payload: unknown;
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
