import { create } from 'zustand';

/**
 * The entries of the Space window's rail. The label of an entry is its
 * internal name with a capital: Dashboard, Sessions, Files, Search.
 *
 * `dashboard` and `sessions` are screens of the Space window: one of them is
 * shown at a time. `files` and `search` are actions: Files opens the Files
 * window of the Space, Search opens the search dialog. Neither changes the
 * screen that is shown.
 */
export const SPACE_RAIL_ENTRIES = [
  { id: 'dashboard', label: 'Dashboard', kind: 'screen' },
  { id: 'sessions', label: 'Sessions', kind: 'screen' },
  { id: 'files', label: 'Files', kind: 'action' },
  { id: 'search', label: 'Search', kind: 'action' },
] as const;

export type SpaceRailEntry = (typeof SPACE_RAIL_ENTRIES)[number];
export type SpaceRailEntryId = SpaceRailEntry['id'];
/** The entries that are screens of the Space window. */
export type SpaceScreenId = Extract<SpaceRailEntry, { kind: 'screen' }>['id'];

/**
 * A request to Sessions from another screen (phase M7.4, the Dashboard):
 * open an AI tab and start its session, or show the tab of a session.
 * `SpaceSessions` carries it out and calls `sessionsRequestHandled` with its id.
 */
export type SessionsRequest =
  | { id: number; kind: 'start-ai'; engineId: string }
  | { id: number; kind: 'show-session'; sessionId: string };

type SpaceNavState = {
  /** The screen the Space window shows. */
  screen: SpaceScreenId;
  /** Show a screen. A part built in a later phase calls it, for example to go from the Dashboard to Sessions. */
  showScreen: (screen: SpaceScreenId) => void;
  /** The request to Sessions not carried out yet, or `null`. */
  sessionsRequest: SessionsRequest | null;
  /** The sessions that have an AI tab in Sessions now, as `SpaceSessions` reports them. */
  sessionsWithTab: readonly string[];
  /** Show Sessions, open an AI tab for the engine and start its session. */
  startAiSession: (engineId: string) => void;
  /** Show Sessions and the tab of the session. */
  showSessionTab: (sessionId: string) => void;
  sessionsRequestHandled: (id: number) => void;
  setSessionsWithTab: (sessionIds: readonly string[]) => void;
  /** The execution flags (e.g. --dangerously) shared across start session components. */
  executionFlags: string[];
  setExecutionFlags: (flags: string[]) => void;
};

let lastRequestId = 0;

/**
 * Which screen the Space window shows. A store of its own (architecture
 * document, section 6.6), so a later phase changes the screen without a prop
 * through `SpaceWindow`. A window has one renderer, so the store is per window.
 *
 * The window opens on Sessions while the Dashboard is a placeholder; phase
 * M7.3, which builds the Dashboard, decides whether that changes.
 */
export const useSpaceNavStore = create<SpaceNavState>((set) => ({
  screen: 'sessions',
  showScreen: (screen) => set({ screen }),
  sessionsRequest: null,
  sessionsWithTab: [],
  startAiSession: (engineId) => {
    lastRequestId += 1;
    set({ screen: 'sessions', sessionsRequest: { id: lastRequestId, kind: 'start-ai', engineId } });
  },
  showSessionTab: (sessionId) => {
    lastRequestId += 1;
    set({
      screen: 'sessions',
      sessionsRequest: { id: lastRequestId, kind: 'show-session', sessionId },
    });
  },
  sessionsRequestHandled: (id) =>
    set((state) => (state.sessionsRequest?.id === id ? { sessionsRequest: null } : {})),
  setSessionsWithTab: (sessionIds) => set({ sessionsWithTab: sessionIds }),
  executionFlags: [],
  setExecutionFlags: (flags) => set({ executionFlags: flags }),
}));
