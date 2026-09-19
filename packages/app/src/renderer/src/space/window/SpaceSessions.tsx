import type { EngineEntry } from '@ai-lore-companion/core';
import type { DockviewApi } from 'dockview';
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiTabSpace } from '../../components/AiTab.js';
import { DockWorkspace } from '../../components/DockWorkspace.js';
import type { PanelId, WorkspaceTab } from '../../components/TabbedPanel.js';
import { type NewTabContext, TAB_KINDS, type TabRenderContext } from '../../components/tabKinds.js';
import { SessionHeader } from '../session-header/SessionHeader.js';
import { SkillsColumn } from '../skills/SkillsColumn.js';
import { secondaryButtonStyle } from '../styles.js';
import { AI_READINESS_CHECKING, EngineStartControl } from './EngineStartControl.js';
import {
  nextIndexOf,
  withAiEngine,
  withAiRunning,
  withTabRenamed,
  withTerminalStatus,
  withoutLastSession,
  withoutTab,
} from './sessionTabs.js';
import { useSpaceNavStore } from './spaceNavStore.js';
import { useEngineChoice } from './useEngineChoice.js';

type Props = {
  /** The Space's folder. Main roots every terminal of this window there. */
  spaceRoot: string;
  /**
   * Tabs restored from an earlier run. Nothing saves them yet (see below); a
   * restored tab carries `lastSession` and stays dormant: an AI tab among them
   * starts no engine until the Human Lead presses Start.
   */
  initialTabs?: WorkspaceTab[];
};

type Panel = { tabs: WorkspaceTab[]; activeId: string };

const EMPTY_PANEL: Panel = { tabs: [], activeId: '' };

/** The sentence under an AI tab's Start button in a Space window. */
const AI_TAB_HINT =
  "Start begins a guarded session in Read only, in the Space's folder. It enters Writing only through the dialog the companion shows.";

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
 * AI tabs (phase M4.6, engine choice M9.10). `+ AI` is enabled only when the
 * engine choice (`useEngineChoice`, architecture document A.9) has an engine
 * that can start; otherwise it is disabled and the refusal's sentence is its
 * tooltip and the note. An AI tab here gets
 * `spaceAi`: its Start calls `spaceSessionStart` (the guarded start of M4.4)
 * and never the cockpit's engine spawn; it shows the session header and the
 * Skills column. A tab made by `+ AI` starts at once; a restored one waits for
 * Start. Closing an AI tab ends its session with `spaceSessionEnd`.
 *
 * Nothing of Sessions is saved: the cockpit's layout channels store a layout
 * only for a v0.8 project, in the settings file, where no 1.0 state may go
 * (architecture document, section 2.4 rule 4).
 */
export function SpaceSessions({ spaceRoot, initialTabs }: Props): JSX.Element {
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => initialTabs ?? []);
  const [engines, setEngines] = useState<EngineEntry[]>([]);
  const { choice, pick, reinstall, refresh } = useEngineChoice();
  /** AI tabs made by `+ AI` that have not started yet. */
  const pendingStart = useRef(new Set<string>());
  /** The session of each AI tab whose engine runs. */
  const sessionByTab = useRef(new Map<string, string>());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  /** The dock's API, to show a tab asked for from the Dashboard. */
  const dockApi = useRef<DockviewApi | null>(null);
  const sessionsRequest = useSpaceNavStore((state) => state.sessionsRequest);
  const sessionsRequestHandled = useSpaceNavStore((state) => state.sessionsRequestHandled);
  const setSessionsWithTab = useSpaceNavStore((state) => state.setSessionsWithTab);
  const reportSessions = useCallback((): void => {
    setSessionsWithTab([...sessionByTab.current.values()]);
  }, [setSessionsWithTab]);

  const engineId = choice?.engineId ?? null;
  const aiReason = choice === null ? AI_READINESS_CHECKING : (choice.refusal?.message ?? undefined);

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

  const addTab = useCallback(
    (kind: 'shell' | 'browser' | 'ai', engineId?: string): void => {
      console.log('TRACE: SpaceSessions addTab', kind, engineId);
      const make = TAB_KINDS[kind].makeTab;
      if (!make) return;
      const id = crypto.randomUUID();
      if (kind === 'ai') pendingStart.current.add(id);
      setTabs((prev) => [
        ...prev,
        make({
          id,
          index: nextIndexOf(prev, kind),
          engineName,
          ...(engineId !== undefined ? { engineId } : {}),
        }),
      ]);
    },
    [engineName],
  );

  const endSession = useCallback((sessionId: string): void => {
    void window.cockpit.spaceSessionEnd({ sessionId });
  }, []);

  const closeTab = useCallback(
    (tabId: string): void => {
      const tab = tabs.find((t) => t.id === tabId);
      // The kind's own close rule: a shell that runs a task asks first, a browser tab
      // removes its view in main.
      if (tab && TAB_KINDS[tab.kind].onClose?.(tab) === false) return;
      // An AI tab's session ends through the end path of M4.4, which also stops its engine.
      const sessionId = sessionByTab.current.get(tabId);
      if (sessionId !== undefined) {
        sessionByTab.current.delete(tabId);
        endSession(sessionId);
        reportSessions();
      }
      pendingStart.current.delete(tabId);
      setTabs((prev) => withoutTab(prev, tabId));
    },
    [tabs, endSession, reportSessions],
  );

  // A request from the Dashboard (phase M7.4): open an AI tab and start it, or show a session's tab.
  useEffect(() => {
    console.log('TRACE: SpaceSessions sessionsRequest effect', sessionsRequest);
    if (sessionsRequest === null) return;
    sessionsRequestHandled(sessionsRequest.id);
    if (sessionsRequest.kind === 'start-ai') {
      addTab('ai', sessionsRequest.engineId);
      return;
    }
    for (const [tabId, sessionId] of sessionByTab.current) {
      if (sessionId === sessionsRequest.sessionId)
        dockApi.current?.getPanel(tabId)?.api.setActive();
    }
  }, [sessionsRequest, sessionsRequestHandled, addTab]);

  const spaceAi = useCallback(
    (tab: WorkspaceTab): AiTabSpace => ({
      start: async (engineId) => {
        console.log('TRACE: SpaceSessions spaceAi.start', tab.id, engineId);
        pendingStart.current.delete(tab.id);
        const started = await window.cockpit.spaceSessionStart({ engineId });
        if (!started.ok) {
          refresh();
          return { ok: false, message: started.error.message };
        }
        return { ok: true, sessionId: started.value.sessionId, ptyId: started.value.ptyId };
      },
      autoStart: pendingStart.current.has(tab.id) && !tab.lastSession,
      onSessionChange: (sessionId) => {
        if (sessionId === null) {
          sessionByTab.current.delete(tab.id);
          reportSessions();
          return;
        }
        // The tab was closed while its session started: end the session at once.
        if (!tabsRef.current.some((t) => t.id === tab.id)) {
          endSession(sessionId);
          return;
        }
        sessionByTab.current.set(tab.id, sessionId);
        reportSessions();
      },
      header: (sessionId) => (
        <SessionHeader sessionId={sessionId} engineName={engineName(tab.engine ?? '')} />
      ),
      sidebar: (ptyId, focusPty) => <SkillsColumn ptyId={ptyId} focusPty={focusPty} />,
      hint: AI_TAB_HINT,
    }),
    [engineName, endSession, refresh, reportSessions],
  );

  const onDockApi = useCallback((api: DockviewApi): void => {
    dockApi.current = api;
  }, []);

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
      },
      setAiTabRunning: (tabId, running) =>
        setTabs((prev) => withAiRunning(prev, tabId, running, engineName)),
      clearLastSession: (tabId) => setTabs((prev) => withoutLastSession(prev, tabId)),
      changesHeightByPane: {},
      onPaneChangesHeight: () => {},
      spaceAi,
    }),
    [spaceRoot, engines, engineName, spaceAi],
  );

  const newTabCtx = useMemo<NewTabContext>(
    () => ({
      engines,
      lastEngineId: engineId,
      onNewShell: () => addTab('shell'),
      // While `aiUnavailableReason` is set, a call that arrives anyway creates nothing.
      onNewAi: (id) => {
        if (aiReason !== undefined) return;
        addTab('ai', id);
      },
      ...(aiReason !== undefined ? { aiUnavailableReason: aiReason } : {}),
      onNewBrowser: () => addTab('browser'),
      // Shortcuts belong to a v0.8 project's settings; a Space window has none yet.
      shortcuts: [],
      onNewShellWithCommand: () => {},
      onNewBrowserWithUrl: () => {},
      onLaunchUrlExternal: (url) => void window.cockpit.urlOpenExternal(url),
    }),
    [engines, engineId, addTab, aiReason],
  );

  /** `onStart` of the empty view's and the compact row's `EngineStartControl`: opens the AI
   *  tab and starts it, exactly as `onNewAi` does (the guard against a stale click is the
   *  same: nothing is created once `aiReason` is set). */
  const startEngine = useCallback((id: string): void => newTabCtx.onNewAi(id), [newTabCtx]);

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
        <EngineStartControl
          choice={choice}
          onStart={startEngine}
          onPick={pick}
          onReinstall={reinstall}
          onRefresh={refresh}
          menu="always"
          buttonTestId="new-ai"
          noteTestId={AI_NOTE_ID}
          menuTestId="space-sessions-engine-menu"
        />
        <p style={emptyTextStyle}>Other tabs:</p>
        <div style={emptyActionsStyle}>
          <button
            type="button"
            style={secondaryButtonStyle}
            data-testid="new-shell"
            onClick={() => newTabCtx.onNewShell()}
          >
            Terminal
          </button>
          <button
            type="button"
            style={secondaryButtonStyle}
            data-testid="new-browser"
            onClick={() => newTabCtx.onNewBrowser()}
          >
            Web page
          </button>
        </div>
      </section>
    );
  }

  return (
    <section style={dockStyle} aria-label="Sessions" data-testid="space-sessions">
      <div style={aiCompactRowStyle}>
        <EngineStartControl
          choice={choice}
          onStart={startEngine}
          onPick={pick}
          onReinstall={reinstall}
          onRefresh={refresh}
          menu="always"
          buttonTestId="new-ai"
          noteTestId={AI_NOTE_ID}
          menuTestId="space-sessions-engine-menu"
        />
      </div>
      <DockWorkspace
        panels={panels}
        renderCtx={renderCtx}
        newTabCtx={newTabCtx}
        onCloseTab={closeTab}
        onRenameTab={renameTab}
        onApi={onDockApi}
      />
    </section>
  );
}

const aiCompactRowStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: '0.4rem 0.9rem',
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
