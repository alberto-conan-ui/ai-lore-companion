import type { EngineEntry } from '@ai-lore-companion/core';
import type { DockviewApi } from 'dockview';
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SpaceSessionStarted } from '../../../../shared/ipc.js';
import type { AiTabSpace } from '../../components/AiTab.js';
import { DockWorkspace } from '../../components/DockWorkspace.js';
import type { PanelId, WorkspaceTab } from '../../components/TabbedPanel.js';
import { type NewTabContext, TAB_KINDS, type TabRenderContext } from '../../components/tabKinds.js';
import { SessionRoster } from './SessionRoster.js';
import './sessions.css';
import { SessionHeader } from '../session-header/SessionHeader.js';
import { SkillsColumn } from '../skills/SkillsColumn.js';
import { secondaryButtonStyle } from '../styles.js';
import {
  AI_READINESS_CHECKING,
  EngineStartControl,
  defaultParamTexts,
} from './EngineStartControl.js';
import {
  nextIndexOf,
  withAiEngine,
  withAiRunning,
  withAiUnguarded,
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
const PM_TAB_ID = 'space-pm';

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
  const [pmSession, setPmSession] = useState<SpaceSessionStarted | null>(null);
  const [pmProblem, setPmProblem] = useState<string | null>(null);
  const [dashboardProblem, setDashboardProblem] = useState<string | null>(null);
  const [pmStarting, setPmStarting] = useState(true);
  const mounted = useRef(false);
  const [rosterOpen, setRosterOpen] = useState(true);
  const [activeTab, setActiveTab] = useState('');
  const [sessionMap, setSessionMap] = useState<ReadonlyMap<string, string>>(new Map());
  const [restartPending, setRestartPending] = useState<number | null>(null);
  /** Closing the PM invalidates any in-flight ensure or restart. */
  const pmGeneration = useRef(0);
  const pmFocus = useRef<{ ptyId: string; focus: () => void } | null>(null);
  const pmBusy = useRef(false);
  const { choice, pick, reinstall, refresh } = useEngineChoice();
  /** AI tabs made by `+ AI` that have not started yet. */
  const pendingStart = useRef(new Set<string>());
  /** The session of each AI tab whose engine runs. */
  const sessionByTab = useRef(new Map<string, string>());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  /** The dock's API, to show a tab asked for from the Dashboard. */
  const dockApi = useRef<DockviewApi | null>(null);
  const dockContainer = useRef<HTMLDivElement | null>(null);
  const screen = useSpaceNavStore((state) => state.screen);
  // biome-ignore lint/correctness/useExhaustiveDependencies: rosterOpen changes the measured dock width.
  useEffect(() => {
    if (screen !== 'sessions') return;
    // A queued Dockview overlay measurement can run while this screen is hidden.
    // Refresh its content bounds after showing the screen or changing roster width.
    const frame = requestAnimationFrame(() => {
      const bounds = dockContainer.current?.getBoundingClientRect();
      if (bounds?.width && bounds.height)
        dockApi.current?.layout(bounds.width, bounds.height, true);
    });
    return () => cancelAnimationFrame(frame);
  }, [screen, rosterOpen]);
  const sessionsRequest = useSpaceNavStore((state) => state.sessionsRequest);
  const sessionsRequestHandled = useSpaceNavStore((state) => state.sessionsRequestHandled);
  const setSessionsWithTab = useSpaceNavStore((state) => state.setSessionsWithTab);
  const reportSessions = useCallback((): void => {
    setSessionsWithTab([...sessionByTab.current.values()]);
    setSessionMap(new Map(sessionByTab.current));
  }, [setSessionsWithTab]);

  const ensurePm = useCallback(async (): Promise<void> => {
    const generation = pmGeneration.current;
    setPmStarting(true);
    setPmProblem(null);
    try {
      const started = await window.cockpit.spacePmEnsure({});
      if (!mounted.current || generation !== pmGeneration.current) return;
      if (!started.ok) {
        setPmProblem(started.error.message);
        return;
      }
      setPmSession(started.value);
      sessionByTab.current.set(PM_TAB_ID, started.value.sessionId);
      reportSessions();
      setTabs((prev) =>
        prev.some((tab) => tab.id === PM_TAB_ID)
          ? prev
          : [
              {
                id: PM_TAB_ID,
                kind: 'ai',
                title: 'PM',
                baseTitle: 'PM',
                manualTitle: true,
                engine: started.value.engineId,
              },
              ...prev,
            ],
      );
    } catch (caught) {
      if (mounted.current && generation === pmGeneration.current)
        setPmProblem(`PM could not start: ${String(caught)}`);
    } finally {
      if (mounted.current && generation === pmGeneration.current) setPmStarting(false);
    }
  }, [reportSessions]);

  useEffect(() => {
    mounted.current = true;
    void ensurePm();
    return () => {
      mounted.current = false;
    };
  }, [ensurePm]);

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

  const tickedParams = useSpaceNavStore((state) => state.tickedParams);
  const setTickedParams = useSpaceNavStore((state) => state.setTickedParams);
  const ticked = engineId !== null ? (tickedParams[engineId] ?? null) : null;
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
      if (tabId === PM_TAB_ID) {
        pmGeneration.current += 1;
        setRestartPending(null);
        setPmStarting(false);
        setPmSession(null);
      }
      setTabs((prev) => withoutTab(prev, tabId));
    },
    [tabs, endSession, reportSessions],
  );

  const restartPm = useCallback(async (): Promise<void> => {
    if (pmBusy.current) return;
    pmBusy.current = true;
    const generation = pmGeneration.current;
    setPmStarting(true);
    setPmProblem(null);
    const sessionId = sessionByTab.current.get(PM_TAB_ID);
    try {
      if (sessionId) {
        const ended = await window.cockpit.spaceSessionEnd({ sessionId });
        if (!mounted.current || generation !== pmGeneration.current) return;
        if (!ended.ok) {
          setPmProblem(ended.error.message);
          setPmStarting(false);
          return;
        }
      }
      if (!mounted.current || generation !== pmGeneration.current) return;
      sessionByTab.current.delete(PM_TAB_ID);
      reportSessions();
      setPmSession(null);
      setTabs((previous) => withoutTab(previous, PM_TAB_ID));
      setRestartPending(generation);
    } catch (caught) {
      if (mounted.current && generation === pmGeneration.current) {
        setPmProblem(`PM could not restart: ${String(caught)}`);
        setPmStarting(false);
      }
    } finally {
      pmBusy.current = false;
    }
  }, [reportSessions]);

  useEffect(() => {
    if (restartPending === null || tabs.some((tab) => tab.id === PM_TAB_ID)) return;
    setRestartPending(null);
    if (restartPending !== pmGeneration.current) return;
    void ensurePm();
  }, [restartPending, tabs, ensurePm]);

  const selectTab = useCallback((id: string): void => {
    dockApi.current?.getPanel(id)?.api.setActive();
  }, []);

  const requestPmReport = useCallback((): void => {
    // The dashboard and an agent use one guarded operation. The PM's
    // conversational terminal remains untouched; there is no synthetic Enter.
    setDashboardProblem(null);
    void window.cockpit
      .spaceDashboardRefresh({ reason: 'human' })
      .then((result) => {
        if (mounted.current && !result.ok) setDashboardProblem(result.error.message);
      })
      .catch((caught: unknown) => {
        if (mounted.current) setDashboardProblem(String(caught));
      });
  }, []);

  // A request from the Dashboard (phase M7.4): open an AI tab and start it, or show a session's tab.
  useEffect(() => {
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
      ...(tab.id === PM_TAB_ID
        ? {
            engineLocked: true,
            ...(pmSession ? { existingSession: pmSession } : {}),
          }
        : {}),
      start: async (engineId) => {
        pendingStart.current.delete(tab.id);
        const option = choice?.options.find((candidate) => candidate.engineId === engineId);
        const params = tickedParams[engineId] ?? defaultParamTexts(option?.params ?? []);
        const started =
          tab.id === PM_TAB_ID
            ? await window.cockpit.spacePmEnsure({})
            : await window.cockpit.spaceSessionStart({ engineId, params });
        if (!started.ok) {
          refresh();
          return { ok: false, message: started.error.message };
        }
        if (started.value.unguarded.length > 0) {
          setTabs((prev) => withAiUnguarded(prev, tab.id));
        }
        if (tab.id === PM_TAB_ID) {
          setPmSession(started.value);
          setTabs((prev) => withAiEngine(prev, tab.id, started.value.engineId, engineName));
        }
        return { ok: true, sessionId: started.value.sessionId, ptyId: started.value.ptyId };
      },
      autoStart: pendingStart.current.has(tab.id) && !tab.lastSession,
      onSessionChange: (sessionId) => {
        if (sessionId === null) {
          if (tab.id === PM_TAB_ID) setPmSession(null);
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
      sidebar: (ptyId, focusPty) => {
        if (tab.id === PM_TAB_ID) pmFocus.current = { ptyId, focus: focusPty };
        return <SkillsColumn ptyId={ptyId} focusPty={focusPty} engineId={tab.engine ?? null} />;
      },
      hint: AI_TAB_HINT,
    }),
    [engineName, endSession, refresh, reportSessions, choice, tickedParams, pmSession],
  );

  const onDockApi = useCallback((api: DockviewApi): void => {
    dockApi.current = api;
    setActiveTab(api.activePanel?.id ?? '');
  }, []);

  const onDockLayoutChange = useCallback((): void => {
    setActiveTab(dockApi.current?.activePanel?.id ?? '');
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

  return (
    <section
      className="space-sessions"
      aria-label="Sessions"
      data-testid={tabs.length === 0 ? 'space-sessions-empty' : 'space-sessions'}
    >
      <div className="space-sessions-toolbar">
        <button
          type="button"
          data-testid="session-roster-toggle"
          aria-expanded={rosterOpen}
          aria-controls="session-roster"
          onClick={() => setRosterOpen((open) => !open)}
        >
          {rosterOpen ? 'Hide roster' : 'Show roster'}
        </button>
        <EngineStartControl
          compact
          choice={choice}
          onStart={startEngine}
          onPick={pick}
          onReinstall={reinstall}
          onRefresh={refresh}
          menu="always"
          buttonTestId="new-ai"
          noteTestId={AI_NOTE_ID}
          menuTestId="space-sessions-engine-menu"
          ticked={ticked}
          onTickedChange={setTickedParams}
        />
      </div>
      <div className="space-sessions-body" data-roster-open={rosterOpen}>
        <div className="space-sessions-roster" hidden={!rosterOpen}>
          {dashboardProblem ? (
            <p role="alert">Dashboard update failed: {dashboardProblem}</p>
          ) : null}
          <SessionRoster
            tabs={tabs}
            sessions={sessionMap}
            engines={engines}
            activeTab={activeTab}
            pmTabId={PM_TAB_ID}
            pmSession={pmSession}
            pmStarting={pmStarting}
            pmProblem={pmProblem}
            onSelect={selectTab}
            onClose={closeTab}
            onEnsurePm={() => void ensurePm()}
            onRestartPm={() => void restartPm()}
            onRequest={requestPmReport}
          />
        </div>
        <div className="space-sessions-dock" ref={dockContainer}>
          {tabs.length === 0 ? (
            <div className="space-sessions-empty">
              <h2>Sessions</h2>
              <p>No tab is open. A shell starts in the Space's folder.</p>
              <div className="session-roster-actions">
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
            </div>
          ) : (
            <DockWorkspace
              panels={panels}
              renderCtx={renderCtx}
              newTabCtx={newTabCtx}
              onCloseTab={closeTab}
              onRenameTab={renameTab}
              onApi={onDockApi}
              onLayoutChange={onDockLayoutChange}
            />
          )}
        </div>
      </div>
    </section>
  );
}
