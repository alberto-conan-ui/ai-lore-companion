import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import type { SpaceInitOf } from '../../../../shared/ipc.js';
import { FilesEditor } from './FilesEditor.js';
import { RootBaselinePicker } from './RootBaselinePicker.js';
import { RootChangesPanel } from './RootChangesPanel.js';
import { RootSearch } from './RootSearch.js';
import { RootTabs, rootPanelId, rootTabId } from './RootTabs.js';
import { RootTree } from './RootTree.js';
import {
  type FilesOpenFile,
  type FilesOpenRequest,
  type RootSummary,
  isTrackedRoot,
} from './filesTypes.js';
import { useFilesMemory } from './useFilesMemory.js';
import { useRootTrees } from './useRootTrees.js';
import { useSelectedRoot } from './useSelectedRoot.js';
import { useSpaceRoots } from './useSpaceRoots.js';

type Props = { init: SpaceInitOf<'space-files'> };

/** The sentence the Workbench's tab shows in place of a changes list. */
export const WORKBENCH_NOTICE = 'The Workbench is not tracked by git, so it has no changes list.';

/** The sentence shown when this instance may not write the desk's records and main gave no reason. */
export const DESK_NOT_WRITABLE = "This window cannot write the desk's records.";

/** Why a root that is not tracked by git has no changes list. */
export function untrackedNotice(summary: RootSummary): string {
  if (summary.root.kind === 'workbench') return WORKBENCH_NOTICE;
  const reason = summary.root.tracking.tracked ? '' : ` ${summary.root.tracking.message}`;
  return `${summary.root.name} has no changes list.${reason}`;
}

/**
 * The Files window of a Space (phase M5.2): the roots as tabs with the count
 * of their changes, and for the selected root the baseline picker (M5.4), its
 * tree with change markers, and the Changes panel (M5.3); the editor (M5.5)
 * takes the rest of the window. A root that git does not track, the Workbench
 * among them, has a tree and no changes list, and says so in one sentence.
 *
 * Counts and markers follow main's pushes of each root's changes; the tree
 * follows its file events. `init.open`, when given, selects that root, reveals
 * the file in its tree and asks the editor to open it; main sends a new `init`
 * when "Open in Files" is used while the window is open.
 *
 * The header holds Search (M5.6), opened by its button or by the find
 * shortcut; a result selects its root, reveals the file and opens it.
 */
export function FilesWindow({ init }: Props): JSX.Element {
  const { state, reload } = useSpaceRoots();
  const roots = state.status === 'ready' ? state.roots : [];
  const trees = useRootTrees(roots);
  const [selectedId, setSelectedId] = useSelectedRoot(init.space);
  const memory = useFilesMemory({
    spaceKey: init.space.key,
    roots: state.status === 'ready' ? state.roots : null,
    selectedId,
    select: setSelectedId,
  });
  const [openRequest, setOpenRequest] = useState<FilesOpenRequest | null>(null);
  const seq = useRef(0);
  const handledOpen = useRef<SpaceInitOf<'space-files'> | null>(null);

  const selected = roots.find((summary) => summary.root.id === selectedId) ?? roots[0] ?? null;

  const { ensure, reveal } = trees;

  // The tree of the shown root is read the first time it is shown.
  useEffect(() => {
    if (selected && selected.root.path !== '') ensure(selected.root.id);
  }, [selected, ensure]);

  const requestOpen = useCallback((rootId: string, file: Parameters<FilesOpenFile>[0]): void => {
    seq.current += 1;
    setOpenRequest({ seq: seq.current, rootId, ...file });
  }, []);

  // "Open in Files": select the root, reveal the file and open it, once per `init`.
  useEffect(() => {
    if (state.status !== 'ready' || handledOpen.current === init) return;
    handledOpen.current = init;
    const open = init.open;
    if (!open || !state.roots.some((summary) => summary.root.id === open.rootId)) return;
    setSelectedId(open.rootId);
    if (open.relPath !== undefined) {
      void reveal(open.rootId, open.relPath);
      requestOpen(open.rootId, { path: open.relPath, mode: 'code' });
    }
  }, [state, init, reveal, requestOpen, setSelectedId]);

  const revealFile = useCallback(
    (rootId: string, path: string): void => {
      setSelectedId(rootId);
      void reveal(rootId, path);
    },
    [reveal, setSelectedId],
  );

  // Search (M5.6): a result selects its root's tab, reveals the file in the tree and opens it.
  const [searchOpen, setSearchOpen] = useState(false);
  const openResult = useCallback(
    (rootId: string, path: string): void => {
      setSelectedId(rootId);
      void reveal(rootId, path);
      requestOpen(rootId, { path, mode: 'code' });
    },
    [reveal, requestOpen, setSelectedId],
  );

  // The find shortcut opens Search, as in the Space window, unless a terminal has the focus.
  const searchable = roots.some((summary) => summary.root.path !== '');
  const routeFind = useCallback((): void => {
    if (searchable && !document.activeElement?.closest('.xterm')) setSearchOpen(true);
  }, [searchable]);
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

  const title = init.space.name === '' ? init.space.root : init.space.name;

  return (
    <div style={windowStyle} data-testid="files-window">
      <header style={headerStyle}>
        <h1 style={titleStyle}>{title} — Files</h1>
        <p style={folderStyle} data-testid="space-files-root">
          {init.space.root}
        </p>
        {state.status === 'ready' ? (
          <div style={searchSlotStyle}>
            <RootSearch
              roots={roots}
              onOpenResult={openResult}
              open={searchOpen}
              onOpenChange={setSearchOpen}
            />
          </div>
        ) : null}
      </header>
      {state.status === 'ready' && !state.deskWritable ? (
        <output style={{ ...noticeStyle, display: 'block' }} data-testid="files-desk-notice">
          {state.deskNotice ?? DESK_NOT_WRITABLE}
        </output>
      ) : null}
      {memory.notices.length > 0 ? (
        <output style={{ ...noticeStyle, display: 'block' }} data-testid="files-memory-notices">
          {memory.notices.map((notice) => (
            <span key={notice} style={{ display: 'block' }}>
              {notice}
            </span>
          ))}
          <button
            type="button"
            style={dismissStyle}
            onClick={memory.dismissNotices}
            data-testid="files-memory-dismiss"
          >
            Dismiss
          </button>
        </output>
      ) : null}
      {state.status === 'loading' ? (
        <output style={{ ...messageStyle, display: 'block' }} data-testid="files-loading">
          Reading the roots of the Space.
        </output>
      ) : null}
      {state.status === 'failed' ? (
        <p role="alert" style={errorStyle} data-testid="files-roots-error">
          {state.message}
        </p>
      ) : null}
      {state.status === 'ready' ? (
        <div style={bodyStyle}>
          <section style={rootsColumnStyle} aria-label="Roots">
            <RootTabs
              roots={roots}
              selectedId={selected?.root.id ?? null}
              onSelect={setSelectedId}
            />
            {selected ? (
              <div
                role="tabpanel"
                id={rootPanelId(selected.root.id)}
                aria-labelledby={rootTabId(selected.root.id)}
                style={panelStyle}
                data-testid="files-root-panel"
              >
                {isTrackedRoot(selected) ? (
                  <div style={pickerSlotStyle} data-testid="files-picker-slot">
                    <RootBaselinePicker summary={selected} reloadRoots={reload} />
                  </div>
                ) : (
                  <p style={noticeStyle} data-testid="files-untracked-notice">
                    {untrackedNotice(selected)}
                  </p>
                )}
                {selected.root.path === '' ? null : (
                  <RootTree
                    summary={selected}
                    state={trees.stateFor(selected)}
                    onSelectFolder={(abs) => trees.selectFolder(selected.root.id, abs)}
                    onSelectFile={(abs) => trees.select(selected.root.id, abs)}
                    onToggleExpand={(abs) => trees.toggle(selected.root.id, abs)}
                    onOpenFile={(path) => requestOpen(selected.root.id, { path, mode: 'code' })}
                  />
                )}
                {isTrackedRoot(selected) ? (
                  <div style={changesSlotStyle} data-testid="files-changes-slot">
                    <RootChangesPanel
                      summary={selected}
                      deskWritable={state.deskWritable}
                      deskNotice={state.deskNotice}
                      onRevealFile={(path) => revealFile(selected.root.id, path)}
                      onOpenFile={(file) => requestOpen(selected.root.id, file)}
                      reloadRoots={reload}
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <p style={messageStyle}>This Space has no roots.</p>
            )}
          </section>
          <section style={editorColumnStyle} aria-label="Editor" data-testid="files-editor-slot">
            {memory.ready ? (
              <FilesEditor
                space={init.space}
                roots={roots}
                openRequest={openRequest}
                onRevealFile={revealFile}
                initialState={memory.editorInitial}
                onStateChange={memory.saveEditor}
              />
            ) : (
              <output style={{ ...messageStyle, display: 'block' }} data-testid="files-restoring">
                Reopening the documents that were open.
              </output>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

const windowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  width: '100vw',
  background: 'var(--color-shell)',
  color: 'var(--color-text)',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.8rem',
  padding: '0.45rem 0.8rem',
  background: 'var(--color-header)',
  borderBottom: '1px solid var(--color-border)',
};

const titleStyle: React.CSSProperties = { margin: 0, fontSize: '0.95rem', fontWeight: 600 };

const folderStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  color: 'var(--color-text-secondary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const searchSlotStyle: React.CSSProperties = { marginLeft: 'auto', flexShrink: 0 };

const bodyStyle: React.CSSProperties = { display: 'flex', flex: 1, minHeight: 0 };

const rootsColumnStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '22rem',
  minWidth: '14rem',
  borderRight: '1px solid var(--color-border)',
};

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
};

const pickerSlotStyle: React.CSSProperties = {
  flexShrink: 0,
  height: '6.5rem',
  borderBottom: '1px solid var(--color-border)',
};

const changesSlotStyle: React.CSSProperties = {
  flexShrink: 0,
  height: '35%',
  minHeight: '8rem',
  borderTop: '1px solid var(--color-border)',
};

const editorColumnStyle: React.CSSProperties = { display: 'flex', flex: 1, minWidth: 0 };

const messageStyle: React.CSSProperties = {
  margin: '0.8rem',
  fontSize: '0.85rem',
  color: 'var(--color-text-secondary)',
};

const noticeStyle: React.CSSProperties = {
  margin: 0,
  padding: '0.45rem 0.8rem',
  fontSize: '0.82rem',
  color: 'var(--color-text)',
  background: 'var(--color-surface-blue)',
  borderBottom: '1px solid var(--color-surface-blue-border)',
};

const dismissStyle: React.CSSProperties = {
  marginTop: '0.3rem',
  fontSize: '0.78rem',
  padding: '0.1rem 0.5rem',
  background: 'transparent',
  color: 'var(--color-text)',
  border: '1px solid var(--color-surface-blue-border)',
  borderRadius: '3px',
  cursor: 'pointer',
};

const errorStyle: React.CSSProperties = {
  margin: '0.8rem',
  fontSize: '0.85rem',
  color: 'var(--color-danger)',
};
