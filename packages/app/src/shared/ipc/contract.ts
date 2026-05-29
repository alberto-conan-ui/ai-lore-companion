/**
 * The IPC contract — one typed descriptor table that the channel strings, the
 * preload bridge, the `CockpitApi` renderer surface, and the main-side handler
 * registrar all derive from. Adding a channel is **one entry here**, not four
 * hand-mirrored edits across `ipc.ts` / `preload` / `main`.
 *
 * Each entry is keyed by its `CockpitApi` method name and declares a direction:
 *
 * - `invoke` — renderer → main, request/response. Becomes `(...args) => Promise<R>`.
 * - `send`   — renderer → main, fire-and-forget. Becomes `(...args) => void`.
 * - `push`   — main → renderer, subscription. Becomes `(handler) => Unsubscribe`.
 *
 * Argument lists are modelled as tuples (`[a: string, b?: number]`) so the
 * generated method keeps its exact positional signature and the wire passes
 * the same positional args — no per-method object packing.
 */

import type { AppEntry, EngineEntry, TreeNode } from '@ai-lore-companion/core';
import type {
  AppsInvokeArg,
  AppsInvokeResult,
  BrowserBounds,
  BrowserProfile,
  BrowserStatePayload,
  ChainPayload,
  ChangesPayload,
  CommitListPayload,
  ContentSearchArg,
  ContentSearchResult,
  DiffTextArg,
  DiffTextResult,
  FileSearchArg,
  FileSearchHit,
  FocusReadArg,
  FocusReadResult,
  OpenDiffArg,
  OpenDiffResult,
  PromptEntry,
  SetBaselineArg,
  SetRegisterArg,
  SettingsSetArg,
  SettingsSetIgnoresArg,
  SettingsSnapshot,
  Shortcut,
  ShortcutInput,
  ShortcutTerminalPayload,
  TerminalDataPayload,
  TerminalExitPayload,
  TerminalInputArg,
  TerminalResizeArg,
  TerminalSpawnEngineArg,
  TerminalStatusPayload,
  TreeExpandArg,
  TreeInitPayload,
  TreeUpdatePayload,
  WindowInitPayload,
} from '../ipc.js';

export type Unsubscribe = () => void;

/** A renderer → main request/response channel. `A` is the positional arg tuple. */
export type InvokeDesc<A extends unknown[], R> = {
  readonly kind: 'invoke';
  readonly channel: string;
  /** Phantom — carries the arg tuple type; never present at runtime. */
  readonly __args?: A;
  /** Phantom — carries the result type; never present at runtime. */
  readonly __result?: R;
};
/** A renderer → main fire-and-forget channel. `A` is the positional arg tuple. */
export type SendDesc<A extends unknown[]> = {
  readonly kind: 'send';
  readonly channel: string;
  readonly __args?: A;
};
/** A main → renderer subscription channel. `P` is the pushed payload. */
export type PushDesc<P> = {
  readonly kind: 'push';
  readonly channel: string;
  readonly __payload?: P;
};

const invoke = <A extends unknown[], R>(channel: string): InvokeDesc<A, R> => ({
  kind: 'invoke',
  channel,
});
const send = <A extends unknown[]>(channel: string): SendDesc<A> => ({ kind: 'send', channel });
const push = <P>(channel: string): PushDesc<P> => ({ kind: 'push', channel });

/**
 * The single source of truth for every cockpit IPC channel. The key is the
 * `CockpitApi` method name; the value declares the direction, the channel
 * string, and the argument / payload types.
 */
export const CONTRACT = {
  // ── Window lifecycle + chain ──────────────────────────────────────────────
  onWindowInit: push<WindowInitPayload>('cockpit:window-init'),
  onChain: push<ChainPayload>('cockpit:chain'),

  // ── Changes panel (drift vs a baseline) ───────────────────────────────────
  // `Changes` keeps its v0.5-era channel string for stored-layout compatibility.
  onChanges: push<ChangesPayload>('cockpit:git-status'),
  onCommitList: push<CommitListPayload>('cockpit:commit-list'),
  setBaseline: invoke<[arg: SetBaselineArg], void>('cockpit:set-baseline'),
  diffText: invoke<[arg: DiffTextArg], DiffTextResult>('cockpit:diff-text'),
  openDiff: invoke<[arg: OpenDiffArg], OpenDiffResult>('cockpit:open-diff'),

  // ── File trees ────────────────────────────────────────────────────────────
  onTreeInit: push<TreeInitPayload>('cockpit:tree-init'),
  onTreeUpdate: push<TreeUpdatePayload>('cockpit:tree-update'),
  treeExpand: invoke<[arg: TreeExpandArg], TreeNode[]>('cockpit:tree-expand'),
  searchFiles: invoke<[arg: FileSearchArg], FileSearchHit[]>('cockpit:file-search'),
  searchContent: invoke<[arg: ContentSearchArg], ContentSearchResult>('cockpit:content-search'),

  // ── Files + paths ─────────────────────────────────────────────────────────
  openPath: invoke<[path: string], string>('cockpit:open-path'),
  revealInFinder: send<[path: string]>('cockpit:reveal-in-finder'),
  openExternal: invoke<[url: string], void>('cockpit:open-external'),

  // ── Project window control ────────────────────────────────────────────────
  openProject: invoke<[path?: string], void>('cockpit:open-project'),
  reload: invoke<[], void>('cockpit:reload'),

  // ── Terminals ─────────────────────────────────────────────────────────────
  spawnTerminal: invoke<[], string>('terminal:spawn'),
  spawnTerminalEngine: invoke<[arg: TerminalSpawnEngineArg], string>('terminal:spawn-engine'),
  sendTerminalInput: send<[arg: TerminalInputArg]>('terminal:input'),
  resizeTerminal: send<[arg: TerminalResizeArg]>('terminal:resize'),
  killTerminal: send<[id: string]>('terminal:kill'),
  onTerminalData: push<TerminalDataPayload>('terminal:data'),
  onTerminalExit: push<TerminalExitPayload>('terminal:exit'),
  onTerminalStatus: push<TerminalStatusPayload>('terminal:status'),

  // ── Embedded browser tabs ─────────────────────────────────────────────────
  browserCreate: send<[tabId: string, initialUrl?: string]>('browser:create'),
  browserDestroy: send<[tabId: string]>('browser:destroy'),
  browserGetUrl: invoke<[tabId: string], string | null>('browser:get-url'),
  browserSetVisible: send<[tabId: string, visible: boolean]>('browser:set-visible'),
  browserSetBounds: send<[tabId: string, bounds: BrowserBounds]>('browser:set-bounds'),
  browserNavigate: send<[tabId: string, url: string]>('browser:navigate'),
  browserGoBack: send<[tabId: string]>('browser:go-back'),
  browserGoForward: send<[tabId: string]>('browser:go-forward'),
  browserReload: send<[tabId: string]>('browser:reload'),
  browserSetProfile: send<[tabId: string, profile: BrowserProfile]>('browser:set-profile'),
  browserSuppressAll: send<[suppress: boolean]>('browser:suppress-all'),
  onBrowserState: push<BrowserStatePayload>('browser:state'),

  // ── App-launch shortcuts ──────────────────────────────────────────────────
  shortcutsList: invoke<[], Shortcut[]>('shortcuts:list'),
  shortcutsRun: send<[id: string]>('shortcuts:run'),
  shortcutsPickApp: invoke<[], string | null>('shortcuts:pick-app'),
  shortcutsAdd: invoke<[input: ShortcutInput], Shortcut[]>('shortcuts:add'),
  shortcutsRemove: invoke<[id: string], Shortcut[]>('shortcuts:remove'),
  onShortcutsChanged: push<Shortcut[]>('shortcuts:changed'),
  onOpenTerminalShortcut: push<ShortcutTerminalPayload>('shortcut:open-terminal'),

  // ── Settings + register ───────────────────────────────────────────────────
  settingsGet: invoke<[], SettingsSnapshot>('settings:get'),
  settingsSet: invoke<[arg: SettingsSetArg], SettingsSnapshot>('settings:set'),
  settingsSetIgnores: invoke<[arg: SettingsSetIgnoresArg], SettingsSnapshot>(
    'settings:set-ignores',
  ),
  onSettingsChanged: push<SettingsSnapshot>('settings:changed'),
  onSettingsOpen: push<void>('settings:open'),
  onSelectCockpitTab: push<number>('cockpit:select-tab'),
  onFocusGlobalSearch: push<void>('cockpit:focus-search'),
  setRegister: invoke<[arg: SetRegisterArg], void>('cockpit:set-register'),
  focusRead: invoke<[arg: FocusReadArg], FocusReadResult>('cockpit:focus-read'),

  // ── Apps catalog ──────────────────────────────────────────────────────────
  appsSave: invoke<[apps: AppEntry[]], SettingsSnapshot>('cockpit:apps-save'),
  appsInvoke: invoke<[arg: AppsInvokeArg], AppsInvokeResult>('cockpit:apps-invoke'),

  // ── Engines + prompts ─────────────────────────────────────────────────────
  enginesList: invoke<[], EngineEntry[]>('engines:list'),
  enginesSave: invoke<[engines: EngineEntry[]], EngineEntry[]>('engines:save'),
  onEnginesChanged: push<EngineEntry[]>('engines:changed'),
  engineLastGet: invoke<[], string | null>('engines:last-get'),
  engineLastSet: invoke<[engineId: string], void>('engines:last-set'),
  aiPromptsWidthGet: invoke<[], number | null>('engines:prompts-width-get'),
  aiPromptsWidthSet: invoke<[width: number], void>('engines:prompts-width-set'),
  promptsList: invoke<[], PromptEntry[]>('prompts:list'),
  onPromptsChanged: push<void>('prompts:changed'),
} as const;

type Contract = typeof CONTRACT;
export type ContractKey = keyof Contract;

/** Map one descriptor to the renderer-facing method signature it generates. */
type MethodFor<D> = D extends InvokeDesc<infer A, infer R>
  ? (...args: A) => Promise<R>
  : D extends SendDesc<infer A>
    ? (...args: A) => void
    : D extends PushDesc<infer P>
      ? (handler: (payload: P) => void) => Unsubscribe
      : never;

/** The renderer's `window.cockpit` surface — derived entirely from {@link CONTRACT}. */
export type CockpitApi = { [K in ContractKey]: MethodFor<Contract[K]> };

/** Keys whose descriptor is an `invoke` (request/response). */
export type InvokeKey = {
  [K in ContractKey]: Contract[K] extends InvokeDesc<infer _A, infer _R> ? K : never;
}[ContractKey];
/** Keys whose descriptor is a `send` (fire-and-forget). */
export type SendKey = {
  [K in ContractKey]: Contract[K] extends SendDesc<infer _A> ? K : never;
}[ContractKey];

/** The positional argument tuple for an `invoke` or `send` channel. */
export type ArgsOf<K extends ContractKey> = Contract[K] extends InvokeDesc<infer A, infer _R>
  ? A
  : Contract[K] extends SendDesc<infer A>
    ? A
    : never;
/** The resolved result type for an `invoke` channel. */
export type ResOf<K extends ContractKey> = Contract[K] extends InvokeDesc<infer _A, infer R>
  ? R
  : never;

/**
 * The channel string for every method — `CHANNELS.onChain` etc. The main
 * process uses these for its `push` sends (`win.webContents.send`); the
 * registrar resolves `invoke` / `send` channels straight off {@link CONTRACT}.
 */
export const CHANNELS = Object.fromEntries(
  Object.entries(CONTRACT).map(([method, desc]) => [method, desc.channel]),
) as { [K in ContractKey]: string };

declare global {
  interface Window {
    cockpit: CockpitApi;
  }
}
