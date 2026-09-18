import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';
import type { SpaceInitOf } from '../../../../shared/ipc.js';
import { SearchDialog, type SearchScope } from '../../components/SearchDialog.js';
import { Dashboard } from '../dashboard/Dashboard.js';
import { SpaceDialogs } from '../dialogs/SpaceDialogs.js';
import { errorAreaStyle } from '../styles.js';
import { useWindowRequest } from '../useWindowRequest.js';
import { SpaceHeader } from './SpaceHeader.js';
import { SpaceRail } from './SpaceRail.js';
import { SpaceSessions } from './SpaceSessions.js';
import { type SpaceRailEntryId, useSpaceNavStore } from './spaceNavStore.js';

type Props = { init: SpaceInitOf<'space'> };

/**
 * A Space window has no file watcher behind the file-name index (its context in
 * main has no watcher; phase M5.1 adds watchers per root, and phase M5.6 builds
 * search in the Files window). The dialog says what that means. Main searches
 * the Space's folder whatever `dirs` this window sends (`searchDirs` of the
 * window's context).
 */
export const SEARCH_INDEX_NOTE =
  'The index of file names is built at the first search in this window and is not updated while the window is open. A file created or deleted since then is found by name with "incl. ignored" ticked, or after the window is opened again. Search inside files reads the files at every search.';

/**
 * The Space window: the header, the rail (Dashboard, Sessions, Files, Search)
 * and one screen at a time in the rest.
 *
 * - Dashboard is `<Dashboard />`, which phase M7.3 builds.
 * - Sessions is the v0.8 dock workspace (`SpaceSessions`). It stays mounted
 *   while the Dashboard is shown, so its terminals keep their processes; it is
 *   hidden with `display: none`, which also makes a browser tab report an
 *   empty rectangle to main, so its native view does not cover the Dashboard.
 * - Files asks main for the Files window of this Space (`spaceNavigate`).
 * - Search is the v0.8 search dialog with one scope, the Space's folder. The
 *   dialog takes its scopes as props and the search channels take their
 *   folders as arguments, so nothing of the cockpit changes. Picking a result
 *   opens the Files window; selecting the file there needs the root the file
 *   belongs to, which phase M5.1 provides.
 *
 * `<SpaceDialogs />` is mounted once here for phase M4.5.
 */
export function SpaceWindow({ init }: Props): JSX.Element {
  const { space } = init;
  const screen = useSpaceNavStore((state) => state.screen);
  const showScreen = useSpaceNavStore((state) => state.showScreen);
  const [searchOpen, setSearchOpen] = useState(false);
  const files = useWindowRequest();

  const openFiles = useCallback((): void => {
    void files.run(() => window.cockpit.spaceNavigate({ to: 'space-files' }));
  }, [files.run]);

  const onSelect = useCallback(
    (entry: SpaceRailEntryId): void => {
      if (entry === 'files') openFiles();
      else if (entry === 'search') setSearchOpen(true);
      else showScreen(entry);
    },
    [openFiles, showScreen],
  );

  // The find shortcut opens Search, unless a terminal has the focus: then the cockpit's
  // own listener in `App.tsx`, which runs in every window, opens that terminal's find bar.
  const routeFind = useCallback((): void => {
    if (!document.activeElement?.closest('.xterm')) setSearchOpen(true);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && (event.key === 'f' || event.key === 'F')) {
        routeFind();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [routeFind]);
  useEffect(() => window.cockpit.onFocusGlobalSearch(routeFind), [routeFind]);

  const scopes = useMemo<SearchScope[]>(
    () => [{ id: 'space', label: 'Space', dirs: [space.root] }],
    [space.root],
  );
  const displayPath = useCallback(
    (abs: string): string =>
      abs.startsWith(`${space.root}/`) ? abs.slice(space.root.length + 1) : abs,
    [space.root],
  );

  return (
    <div style={windowStyle} data-testid="space-window">
      <SpaceHeader space={space} />
      {files.error !== null ? (
        <p style={errorStyle} role="alert" data-testid="space-window-error">
          {files.error}
        </p>
      ) : null}
      <div style={bodyStyle}>
        <SpaceRail screen={screen} onSelect={onSelect} />
        <div
          style={screen === 'dashboard' ? screenStyle : hiddenStyle}
          data-testid="space-screen-dashboard"
        >
          <Dashboard />
        </div>
        <div
          style={screen === 'sessions' ? screenStyle : hiddenStyle}
          data-testid="space-screen-sessions"
        >
          <SpaceSessions spaceRoot={space.root} />
        </div>
      </div>
      {searchOpen ? (
        <SearchDialog
          scopes={scopes}
          onPick={openFiles}
          displayPath={displayPath}
          note={SEARCH_INDEX_NOTE}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}
      <SpaceDialogs />
    </div>
  );
}

const windowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  width: '100vw',
  margin: 0,
  background: 'var(--color-shell)',
  color: 'var(--color-text)',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
};

const bodyStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
};

const screenStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
};

const hiddenStyle: React.CSSProperties = { display: 'none' };

const errorStyle: React.CSSProperties = {
  ...errorAreaStyle,
  flexShrink: 0,
  padding: '0.35rem 0.9rem',
  borderBottom: '1px solid var(--color-border)',
};
