import type { ChangeScope, EngineEntry, TabLastSession } from '@ai-lore-companion/core';
import type { CSSProperties, JSX, ReactNode } from 'react';
import type { Shortcut, TerminalForegroundStatus } from '../../../shared/ipc.js';
import { AiTab } from './AiTab.js';
import { AssistantHost } from './AssistantHost.js';
import { Banner } from './Banner.js';
import { BrowserTab } from './BrowserTab.js';
import { Pane, type SubRoot } from './Pane.js';
import { PublishPane } from './PublishPane.js';
import type { TabKind, WorkspaceTab } from './TabbedPanel.js';
import { TerminalTab } from './TerminalTab.js';

/** One of the pinned cockpit panes — its tab, plus how to root and scope it.
 *  Lives here (not App) because the `pane` descriptor's `renderBody` is the
 *  one place that consumes it. */
export type PaneSpec = { id: string; title: string; scope: ChangeScope; subRoot: SubRoot };

/** Everything a tab body needs from App to render. Threaded through
 *  `renderBody` so the registry stays a pure module — it imports no App state.
 *  This is the "render context" the handover called for: the ~10 pieces the
 *  old inline body closures reached into App for. */
export type TabRenderContext = {
  /** The resolved project root — the Pane's `projectRoot`. */
  projectRoot: string;
  /** Pinned-pane specs by tab id; the `pane` body looks itself up here. */
  paneSpecById: Map<string, PaneSpec>;
  /** A short, tab-relative display path for a file. */
  displayPath: (abs: string) => string;
  /** The current global-search reveal request, if any. */
  revealTarget: { paneId: string; path: string; token: number } | null;
  /** Foreground-status callback for terminal / AI tabs. */
  handleTerminalStatus: (tabId: string, status: TerminalForegroundStatus, command: string) => void;
  /** One-shot commands seeded for a terminal-shortcut tab, by tab id. */
  terminalInitialCommands: Record<string, string>;
  /** Initial URLs seeded for a browser-shortcut tab, by tab id. */
  browserInitialUrls: Record<string, string>;
  /** URL + terminal shortcuts surfaced inside Shell / Web tab sidebars. */
  tabShortcuts: Shortcut[];
  /** Configured AI engines — the AI tab's engine dropdown. */
  engines: EngineEntry[];
  /** Change the engine bound to an AI tab. */
  setAiTabEngine: (tabId: string, engineId: string) => void;
  /** Flip an AI tab's running state. */
  setAiTabRunning: (tabId: string, running: boolean) => void;
  /** Clear a restored tab's dormant `lastSession` — resumes it (mounts the
   *  live surface) or dismisses the banner. Wired to the banner's action / ✕. */
  clearLastSession: (tabId: string) => void;
};

/** Context the strip's `+ <kind>` creator buttons act through. */
export type NewTabContext = {
  engines: readonly EngineEntry[];
  lastEngineId: string | null;
  onNewShell: () => void;
  onNewAi: (engineId: string) => void;
  onNewBrowser: () => void;
  /** Shortcuts offered in the `+ shell ▾` / `+ web ▾` start-with-shortcut
   *  dropdowns — this project's own shortcuts plus the global url/terminal
   *  list. The dropdown builders filter by target. */
  shortcuts: readonly Shortcut[];
  /** Seed a new shell tab with a shortcut command, titled after the shortcut. */
  onNewShellWithCommand: (command: string, label: string) => void;
  /** Seed a new browser tab with a shortcut URL, titled after the shortcut. */
  onNewBrowserWithUrl: (url: string, label: string) => void;
  /** Open a URL in the external browser — the `↗` on web dropdown rows. */
  onLaunchUrlExternal: (url: string) => void;
};

/** One row in a creator's start-with-shortcut dropdown. */
export type NewTabDropdownItem = {
  id: string;
  label: string;
  /** The command or URL — shown as monospace subtext. */
  detail: string;
  /** Primary action — open a new tab seeded with this shortcut (the `▣`). */
  onPick: () => void;
  /** Optional `↗` — open the URL externally (web rows only). */
  onLaunchExternal?: () => void;
};

/** A strip creator button — `+ AI` / `+ shell` / `+ web`. */
export type NewTabButton = {
  /** Display label, e.g. `+ AI`. */
  label: string;
  /** Stable test id, e.g. `new-ai`. */
  testId: string;
  /** Order within the creator group (lower = leftmost). */
  order: number;
  /** Tooltip — may depend on context (e.g. "add an engine" when none). */
  title: (ctx: NewTabContext) => string;
  /** Whether the button is disabled in the current context. */
  disabled?: (ctx: NewTabContext) => boolean;
  /** Create the tab. */
  onClick: (ctx: NewTabContext) => void;
  /** Optional start-with-shortcut dropdown. When present, the strip renders a
   *  `▾` caret beside the label; opening it lists these rows so a new tab can
   *  start seeded with a shortcut. */
  dropdown?: (ctx: NewTabContext) => NewTabDropdownItem[];
};

/** Helpers a `makeTab` factory uses to build a fresh tab. */
export type MakeTabArgs = {
  /** A fresh stable id (caller-supplied so it can key state immediately). */
  id: string;
  /** 1-based count for the auto-title (`Shell 1`, `Browser 2`, …). */
  index: number;
  /** For `ai`: the chosen engine id. */
  engineId?: string;
  /** Resolve an engine's display name (for the AI tab title). */
  engineName: (engineId: string) => string;
};

/** What a tab kind is and how the workspace treats it. One descriptor per
 *  kind — adding a kind is one entry here, with no edits to the layout
 *  switches in App.tsx / TabbedPanel.tsx. */
export type TabKindDescriptor = {
  /** Can the user drag this tab between panels? Doubles as "is an editable
   *  user tab" — pinned panes are the only non-draggable kind, and they are
   *  also the only kind that cannot be renamed. */
  draggable: boolean;
  /** Does this tab show a close (×) button? */
  closable: boolean;
  /** Optional glyph left of the title (status dot, AI badge). */
  stripAdornment?: (tab: WorkspaceTab) => JSX.Element | null;
  /** Build a fresh tab of this kind. Omitted for kinds the user cannot
   *  create directly (`pane` — those are seeded by `panesForShape`). */
  makeTab?: (args: MakeTabArgs) => WorkspaceTab;
  /** The strip creator button for this kind, if any. */
  newButton?: NewTabButton;
  /** Render the tab's body. `visible` mirrors the active+open portal flag. */
  renderBody: (tab: WorkspaceTab, visible: boolean, ctx: TabRenderContext) => JSX.Element | null;
  /** Side-effect + veto when a tab of this kind closes. Return `false` to
   *  cancel the close (e.g. the user declines the running-task confirm). */
  onClose?: (tab: WorkspaceTab) => boolean;
};

/** The banner line for a restored tab — what it was running last session.
 *  A monospace span carries the command / URL when one was captured. */
function restoreMessage(ls: TabLastSession): ReactNode {
  const detail = ls.detail ? <span style={restoreDetailStyle}>{ls.detail}</span> : null;
  switch (ls.kind) {
    case 'shell':
      return detail ? (
        <>Last session, this terminal was running {detail}</>
      ) : (
        'Last session, this was an open terminal.'
      );
    case 'browser':
      return detail ? (
        <>Last session, this tab was on {detail}</>
      ) : (
        'Last session, this was a browser tab.'
      );
    case 'ai':
      return detail ? (
        <>Last session, this tab was running {detail}</>
      ) : (
        'Last session, this was an AI session.'
      );
    default:
      return 'Last session, this tab was open.';
  }
}

/** The resume-action label for a restored tab — kind-appropriate verb. */
function resumeLabel(kind: string): string {
  if (kind === 'browser') return 'New browser';
  if (kind === 'ai') return 'New session';
  return 'New terminal';
}

/**
 * A restored shell / browser tab in its **dormant** state: the warn banner
 * over an empty body. The live surface (PTY, WebContentsView) is deliberately
 * not mounted, so nothing is spawned or loaded on open. The banner's action
 * and its `✕` both call `onResume`, which clears `lastSession` — the parent
 * then re-renders the live surface as a fresh tab.
 */
function DormantTabSurface({
  lastSession,
  onResume,
}: {
  lastSession: TabLastSession;
  onResume: () => void;
}): JSX.Element {
  return (
    <div style={dormantWrapStyle} data-testid="dormant-tab" data-tab-kind={lastSession.kind}>
      <Banner
        tone="warn"
        testId="restore-banner"
        action={{ label: resumeLabel(lastSession.kind), onClick: onResume }}
        onDismiss={onResume}
      >
        {restoreMessage(lastSession)}
      </Banner>
      <div style={dormantBodyStyle} />
    </div>
  );
}

/** Idle/running dot on a shell tab — lit while a foreground task runs. */
function StatusDot({ status }: { status: TerminalForegroundStatus }): JSX.Element {
  const running = status === 'running';
  return (
    <span
      style={{
        ...statusDotStyle,
        background: running ? '#4cd07d' : '#3a4654',
        boxShadow: running ? '0 0 4px #4cd07d' : 'none',
      }}
      aria-label={running ? 'running' : 'idle'}
    />
  );
}

/** Filled-glyph badge on an AI tab — the kind marker. */
function AiBadge(): JSX.Element {
  return (
    <span style={aiBadgeStyle} aria-label="AI tab">
      ✦
    </span>
  );
}

/** Pick the engine id `+ AI` creates a tab with: the last pick if it still
 *  exists, else the first available, else `''` (the button is disabled). */
export function defaultEngineId(
  engines: readonly EngineEntry[],
  lastEngineId: string | null,
): string {
  if (lastEngineId && engines.some((e) => e.id === lastEngineId)) return lastEngineId;
  return engines[0]?.id ?? '';
}

export const TAB_KINDS: Record<TabKind, TabKindDescriptor> = {
  pane: {
    draggable: false,
    closable: false,
    renderBody: (tab, visible, ctx) => {
      // The `publish` pane is rendered by its own component — by methodology
      // contract `publish/` is write-restricted and the companion tracks no
      // drift against it, so it carries no PaneSpec.
      if (tab.id === 'publish') return <PublishPane />;
      // The mid-pane `assistant-host` tab hosts the live read-only session
      // (`visible` drives its embedded Claude terminal's re-fit when shown). The
      // Assistant's *output* (AssistantFeed) is not a tab — it's a section of the
      // left activity rail, rendered directly by App (CR9 Phase 3).
      if (tab.id === 'assistant-host') return <AssistantHost active={visible} />;
      const spec = ctx.paneSpecById.get(tab.id);
      if (!spec) return null;
      return (
        <Pane
          testId={spec.id}
          scope={spec.scope}
          label={spec.title}
          subRoot={spec.subRoot}
          projectRoot={ctx.projectRoot}
          displayPath={ctx.displayPath}
          revealRequest={ctx.revealTarget?.paneId === spec.id ? ctx.revealTarget : undefined}
        />
      );
    },
  },
  shell: {
    draggable: true,
    closable: true,
    stripAdornment: (tab) => <StatusDot status={tab.status ?? 'idle'} />,
    makeTab: ({ id, index }) => {
      const title = `Shell ${index}`;
      return { id, kind: 'shell', title, baseTitle: title, status: 'idle' };
    },
    newButton: {
      label: '+ shell',
      testId: 'new-shell',
      order: 1,
      title: () => 'New shell',
      onClick: (ctx) => ctx.onNewShell(),
      dropdown: (ctx) =>
        ctx.shortcuts
          .filter((s) => s.target === 'terminal' && s.command)
          .map((s) => ({
            id: s.id,
            label: s.label,
            detail: s.command ?? '',
            onPick: () => ctx.onNewShellWithCommand(s.command ?? '', s.label),
          })),
    },
    renderBody: (tab, visible, ctx) =>
      tab.lastSession ? (
        <DormantTabSurface
          lastSession={tab.lastSession}
          onResume={() => ctx.clearLastSession(tab.id)}
        />
      ) : (
        <TerminalTab
          active={visible}
          tabId={tab.id}
          onStatus={ctx.handleTerminalStatus}
          initialCommand={ctx.terminalInitialCommands[tab.id]}
          tabShortcuts={ctx.tabShortcuts}
        />
      ),
    onClose: (tab) => {
      // A shell running a task confirms before closing — the whole-window
      // close has the same guard, but closing a single tab bypassed it.
      if (tab.status === 'running') {
        return window.confirm(
          'This terminal is running a task. Closing the tab will end it.\n\nClose anyway?',
        );
      }
      return true;
    },
  },
  ai: {
    draggable: true,
    closable: true,
    stripAdornment: () => <AiBadge />,
    makeTab: ({ id, engineId, engineName }) => {
      const eid = engineId ?? '';
      const title = `AI (${engineName(eid)})`;
      return { id, kind: 'ai', title, baseTitle: title, engine: eid };
    },
    newButton: {
      label: '+ AI',
      testId: 'new-ai',
      order: 0,
      title: (ctx) =>
        ctx.engines.length === 0
          ? 'Add an engine in Settings → Engines to enable AI tabs'
          : 'New AI session',
      disabled: (ctx) => ctx.engines.length === 0,
      onClick: (ctx) => ctx.onNewAi(defaultEngineId(ctx.engines, ctx.lastEngineId)),
    },
    // An AI tab is already inert until the user clicks Start (it never
    // auto-spawns), so a restored one needs no dormant placeholder — its own
    // empty state IS the dormant state. The restore banner sits above it;
    // starting the engine (or the ✕) clears it.
    renderBody: (tab, visible, ctx) => (
      <div style={bannerStackStyle}>
        {tab.lastSession ? (
          <Banner
            tone="warn"
            testId="restore-banner"
            onDismiss={() => ctx.clearLastSession(tab.id)}
          >
            {restoreMessage(tab.lastSession)}
          </Banner>
        ) : null}
        <AiTab
          active={visible}
          tabId={tab.id}
          engine={tab.engine ?? ''}
          engines={ctx.engines}
          onEngineChange={(engineId) => ctx.setAiTabEngine(tab.id, engineId)}
          onStatus={ctx.handleTerminalStatus}
          onRunningChange={(id, running) => {
            if (running) ctx.clearLastSession(id);
            ctx.setAiTabRunning(id, running);
          }}
        />
      </div>
    ),
  },
  browser: {
    draggable: true,
    closable: true,
    makeTab: ({ id, index }) => {
      const title = `Browser ${index}`;
      return { id, kind: 'browser', title, baseTitle: title };
    },
    newButton: {
      label: '+ web',
      testId: 'new-browser',
      order: 2,
      title: () => 'New browser',
      onClick: (ctx) => ctx.onNewBrowser(),
      dropdown: (ctx) =>
        ctx.shortcuts
          .filter((s) => s.target === 'url' && s.url)
          .map((s) => ({
            id: s.id,
            label: s.label,
            detail: s.url ?? '',
            onPick: () => ctx.onNewBrowserWithUrl(s.url ?? '', s.label),
            onLaunchExternal: () => ctx.onLaunchUrlExternal(s.url ?? ''),
          })),
    },
    renderBody: (tab, visible, ctx) =>
      tab.lastSession ? (
        <DormantTabSurface
          lastSession={tab.lastSession}
          onResume={() => ctx.clearLastSession(tab.id)}
        />
      ) : (
        <BrowserTab
          tabId={tab.id}
          visible={visible}
          initialUrl={ctx.browserInitialUrls[tab.id]}
          tabShortcuts={ctx.tabShortcuts}
          onLaunchUrlExternal={(id) => window.cockpit.shortcutsRun(id)}
        />
      ),
    onClose: (tab) => {
      // A dormant (restored, never-resumed) browser tab has no WebContentsView
      // in main — destroy is a harmless no-op there, but skip it for clarity.
      if (!tab.lastSession) window.cockpit.browserDestroy(tab.id);
      return true;
    },
  },
};

/** The strip's creator buttons, in display order (`+ AI`, `+ shell`, `+ web`).
 *  Derived from the registry so a new creatable kind needs only its descriptor. */
export const NEW_TAB_BUTTONS: NewTabButton[] = Object.values(TAB_KINDS)
  .map((d) => d.newButton)
  .filter((b): b is NewTabButton => b !== undefined)
  .sort((a, b) => a.order - b.order);

/** Column that stacks a restore banner above a tab body (AI tab). */
const bannerStackStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
};

/** Dormant shell/browser tab: banner over an empty body. */
const dormantWrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  background: '#0a0f17',
};

const dormantBodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
};

const restoreDetailStyle: CSSProperties = {
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  fontWeight: 600,
};

const statusDotStyle: CSSProperties = {
  flexShrink: 0,
  width: '7px',
  height: '7px',
  borderRadius: '50%',
};

const aiBadgeStyle: CSSProperties = {
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '14px',
  fontSize: '0.95rem',
  fontWeight: 700,
  lineHeight: 1,
  color: '#c7b3ff',
  textShadow: '0 0 6px rgba(199, 179, 255, 0.35)',
};
