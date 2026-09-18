import type { EngineEntry } from '@ai-lore-companion/core';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';
import { DockWorkspace } from '../../components/DockWorkspace.js';
import type { PanelId, WorkspaceTab } from '../../components/TabbedPanel.js';
import {
  NEW_TAB_BUTTONS,
  type NewTabContext,
  TAB_KINDS,
  type TabRenderContext,
} from '../../components/tabKinds.js';
import {
  nextIndexOf,
  withAiEngine,
  withAiRunning,
  withTabRenamed,
  withTerminalStatus,
  withoutLastSession,
  withoutTab,
} from './sessionTabs.js';

type Props = {
  /** The Space's folder. Main roots every terminal of this window there. */
  spaceRoot: string;
};

type Panel = { tabs: WorkspaceTab[]; activeId: string };

const EMPTY_PANEL: Panel = { tabs: [], activeId: '' };

/**
 * Why `+ AI` is disabled in a Space window. An AI session in a Space needs the
 * write-guard, Read only and a session record, which phase M4.4 builds. The
 * cockpit's AI tab has none of them, so until M4.4 a Space window starts none.
 */
export const AI_SESSIONS_UNAVAILABLE =
  'AI sessions in a Space are started by the guarded start of phase M4.4. Until that phase is built, a Space window starts no AI session. Shell tabs and browser tabs are available.';

const AI_NOTE_ID = 'space-sessions-ai-note';

/**
 * Sessions of a Space window: the v0.8 dock workspace, hosted as it is.
 *
 * `DockWorkspace` takes its tabs, its render context and its creators as
 * props, so this component gives it a tab list of its own and changes nothing
 * in it. The tab kinds (`shell`, `ai`, `browser`) and their bodies are the
 * cockpit's. A terminal asks main for a PTY through the existing terminal
 * channels; main gave this window a terminal service whose working directory
 * is the Space's folder (`attachTerminal` in `main/space/host.ts`), so a shell
 * tab starts there.
 *
 * What is not here. The session header and the Skills column are phase M4.6's:
 * they are rendered inside the AI tab, which M4.6 edits. Nothing of Sessions is
 * saved: the cockpit's layout channels store a layout only for a v0.8 project,
 * in the settings file, where no 1.0 state may go (architecture document,
 * section 2.4 rule 4).
 */
export function SpaceSessions({ spaceRoot }: Props): JSX.Element {
  const [tabs, setTabs] = useState<WorkspaceTab[]>([]);
  const [engines, setEngines] = useState<EngineEntry[]>([]);
  const [lastEngineId, setLastEngineId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void window.cockpit.enginesList().then((list) => {
      if (live) setEngines(list);
    });
    const off = window.cockpit.onEnginesChanged(setEngines);
    return () => {
      live = false;
      off();
    };
  }, []);

  const engineName = useCallback(
    (engineId: string): string => engines.find((e) => e.id === engineId)?.name ?? engineId,
    [engines],
  );

  // No `ai` kind here: a Space window creates no AI tab until phase M4.4.
  const addTab = useCallback(
    (kind: 'shell' | 'browser'): void => {
      const make = TAB_KINDS[kind].makeTab;
      if (!make) return;
      const id = crypto.randomUUID();
      setTabs((prev) => [...prev, make({ id, index: nextIndexOf(prev, kind), engineName })]);
    },
    [engineName],
  );

  const closeTab = useCallback(
    (tabId: string): void => {
      const tab = tabs.find((t) => t.id === tabId);
      // The kind's own close rule: a shell that runs a task asks first, a browser tab
      // removes its view in main.
      if (tab && TAB_KINDS[tab.kind].onClose?.(tab) === false) return;
      setTabs((prev) => withoutTab(prev, tabId));
    },
    [tabs],
  );

  const renameTab = useCallback((tabId: string, name: string): void => {
    setTabs((prev) => withTabRenamed(prev, tabId, name));
  }, []);

  const renderCtx = useMemo<TabRenderContext>(
    () => ({
      projectRoot: spaceRoot,
      paneSpecById: new Map(),
      displayPath: (abs) =>
        abs.startsWith(`${spaceRoot}/`) ? abs.slice(spaceRoot.length + 1) : abs,
      revealTarget: null,
      handleTerminalStatus: (tabId, status, command) =>
        setTabs((prev) => withTerminalStatus(prev, tabId, status, command, engineName)),
      terminalInitialCommands: {},
      browserInitialUrls: {},
      tabShortcuts: [],
      engines,
      setAiTabEngine: (tabId, engineId) => {
        setTabs((prev) => withAiEngine(prev, tabId, engineId, engineName));
        setLastEngineId(engineId);
      },
      setAiTabRunning: (tabId, running) =>
        setTabs((prev) => withAiRunning(prev, tabId, running, engineName)),
      clearLastSession: (tabId) => setTabs((prev) => withoutLastSession(prev, tabId)),
      changesHeightByPane: {},
      onPaneChangesHeight: () => {},
    }),
    [spaceRoot, engines, engineName],
  );

  const newTabCtx = useMemo<NewTabContext>(
    () => ({
      engines,
      lastEngineId,
      onNewShell: () => addTab('shell'),
      // `+ AI` is disabled by `aiUnavailableReason`; a call that arrives anyway creates nothing.
      onNewAi: () => {},
      aiUnavailableReason: AI_SESSIONS_UNAVAILABLE,
      onNewBrowser: () => addTab('browser'),
      // Shortcuts belong to a v0.8 project's settings; a Space window has none yet.
      shortcuts: [],
      onNewShellWithCommand: () => {},
      onNewBrowserWithUrl: () => {},
      onLaunchUrlExternal: (url) => void window.cockpit.urlOpenExternal(url),
    }),
    [engines, lastEngineId, addTab],
  );

  const panels = useMemo<Record<PanelId, Panel>>(
    () => ({
      leftRail: EMPTY_PANEL,
      centre: { tabs, activeId: tabs[tabs.length - 1]?.id ?? '' },
      right: EMPTY_PANEL,
      leftRailBottom: EMPTY_PANEL,
      centreBottom: EMPTY_PANEL,
      rightBottom: EMPTY_PANEL,
    }),
    [tabs],
  );

  // The dock's creators are in the header of a tab group, and with no tab there is no
  // group. The same creators are offered here until the first tab exists.
  if (tabs.length === 0) {
    return (
      <section style={emptyStyle} aria-label="Sessions" data-testid="space-sessions-empty">
        <h2 style={emptyTitleStyle}>Sessions</h2>
        <p style={emptyTextStyle}>No tab is open. A shell starts in the Space's folder.</p>
        <p id={AI_NOTE_ID} style={emptyTextStyle} data-testid={AI_NOTE_ID}>
          {AI_SESSIONS_UNAVAILABLE}
        </p>
        <div style={emptyActionsStyle}>
          {NEW_TAB_BUTTONS.map((button) => (
            <button
              key={button.testId}
              type="button"
              style={emptyButtonStyle}
              data-testid={button.testId}
              title={button.title(newTabCtx)}
              aria-describedby={button.testId === 'new-ai' ? AI_NOTE_ID : undefined}
              disabled={button.disabled?.(newTabCtx) ?? false}
              onClick={() => button.onClick(newTabCtx)}
            >
              {button.label}
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section style={dockStyle} aria-label="Sessions" data-testid="space-sessions">
      <p id={AI_NOTE_ID} style={aiNoteStyle} data-testid={AI_NOTE_ID}>
        {AI_SESSIONS_UNAVAILABLE}
      </p>
      <DockWorkspace
        panels={panels}
        renderCtx={renderCtx}
        newTabCtx={newTabCtx}
        onCloseTab={closeTab}
        onRenameTab={renameTab}
      />
    </section>
  );
}

const aiNoteStyle: React.CSSProperties = {
  flexShrink: 0,
  margin: 0,
  padding: '0.3rem 0.9rem',
  fontSize: '0.75rem',
  color: 'var(--color-text-secondary)',
  borderBottom: '1px solid var(--color-border)',
};

const dockStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
};

const emptyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  padding: '1.5rem',
  textAlign: 'center',
};

const emptyTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '1rem',
  fontWeight: 600,
  color: 'var(--color-text)',
};

const emptyTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.85rem',
  color: 'var(--color-text-secondary)',
};

const emptyActionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  marginTop: '0.4rem',
};

const emptyButtonStyle: React.CSSProperties = {
  padding: '0.35rem 0.8rem',
  fontSize: '0.8rem',
  fontWeight: 600,
  color: 'var(--color-text)',
  background: 'transparent',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '5px',
  cursor: 'pointer',
};
