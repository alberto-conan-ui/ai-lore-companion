import type { EngineEntry } from '@ai-lore-companion/core';
import type { DockviewApi } from 'dockview';
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiTabSpace } from '../../components/AiTab.js';
import { DockWorkspace } from '../../components/DockWorkspace.js';
import type { PanelId, WorkspaceTab } from '../../components/TabbedPanel.js';
import {
  NEW_TAB_BUTTONS,
  type NewTabContext,
  TAB_KINDS,
  type TabRenderContext,
  defaultEngineId,
} from '../../components/tabKinds.js';
import { SessionHeader } from '../session-header/SessionHeader.js';
import { SkillsColumn } from '../skills/SkillsColumn.js';
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

/** The note while `spaceSessionReadiness` has not answered yet. */
export const AI_READINESS_CHECKING = 'Checking whether an AI session can start in this Space.';

/** The note when the registry has no engine to start. */
export const AI_NO_ENGINE =
  'No AI session can start: the list of engines is empty. Add Claude Code under Settings, Engines.';

/** The note when `+ AI` can start a guarded session. */
export const AI_SESSIONS_GUARDED =
  "An AI session starts in Read only, with the write-guard of this Space, in the Space's folder.";

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
 * AI tabs (phase M4.6). `+ AI` is enabled only when `spaceSessionReadiness`
 * answers ready for the engine it would use; otherwise it is disabled and the
 * answer's sentence is its tooltip and the note. An AI tab here gets
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
  const [lastEngineId, setLastEngineId] = useState<string | null>(null);
  const [aiReason, setAiReason] = useState<string | undefined>(AI_READINESS_CHECKING);
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

  const readyEngineId = defaultEngineId(engines, lastEngineId);
  const checkReadiness = useCallback((): void => {
    if (readyEngineId === '') {
      setAiReason(AI_NO_ENGINE);
      return;
    }
    void window.cockpit.spaceSessionReadiness({ engineId: readyEngineId }).then((ready) => {
      setAiReason(ready.ok ? undefined : ready.error.message);
    });
  }, [readyEngineId]);

  useEffect(() => {
    checkReadiness();
    // Python, the install or the desk can change while the window is in the background.
    window.addEventListener('focus', checkReadiness);
    return () => window.removeEventListener('focus', checkReadiness);
  }, [checkReadiness]);

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
    if (sessionsRequest === null) return;
    sessionsRequestHandled(sessionsRequest.id);
    if (sessionsRequest.kind === 'start-ai') {
      setLastEngineId(sessionsRequest.engineId);
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
        pendingStart.current.delete(tab.id);
        const started = await window.cockpit.spaceSessionStart({ engineId });
        if (!started.ok) {
          checkReadiness();
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
    [engineName, endSession, checkReadiness, reportSessions],
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
        setLastEngineId(engineId);
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
      lastEngineId,
      onNewShell: () => addTab('shell'),
      // While `aiUnavailableReason` is set, a call that arrives anyway creates nothing.
      onNewAi: (engineId) => {
        if (aiReason !== undefined) return;
        setLastEngineId(engineId);
        addTab('ai', engineId);
      },
      ...(aiReason !== undefined ? { aiUnavailableReason: aiReason } : {}),
      onNewBrowser: () => addTab('browser'),
      // Shortcuts belong to a v0.8 project's settings; a Space window has none yet.
      shortcuts: [],
      onNewShellWithCommand: () => {},
      onNewBrowserWithUrl: () => {},
      onLaunchUrlExternal: (url) => void window.cockpit.urlOpenExternal(url),
    }),
    [engines, lastEngineId, addTab, aiReason],
  );

  const aiNote = aiReason ?? AI_SESSIONS_GUARDED;

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
          {aiNote}
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
        {aiNote}
      </p>
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
