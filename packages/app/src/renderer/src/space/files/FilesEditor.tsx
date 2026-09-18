import { type JSX, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { type FilesBuffers, FilesCodeView } from './FilesCodeView.js';
import { FilesDiffView } from './FilesDiffView.js';
import {
  EMPTY_EDITOR_STATE,
  type FilesDocMode,
  type FilesDocState,
  type FilesEditorState,
  baseName,
  docKey,
  filesEditorReducer,
  isMarkdown,
} from './filesEditorModel.js';
import {
  buttonStyle,
  dirtyDotStyle,
  emptyStyle,
  panelStyle,
  segOnStyle,
  segStyle,
  segmentStyle,
  stripStyle,
  tabActiveStyle,
  tabCloseStyle,
  tabNameStyle,
  tabRootStyle,
  tabStyle,
  toolbarStyle,
  visuallyHiddenStyle,
} from './filesEditorStyles.js';
import type { FilesOpenRequest, RootSummary, SpaceSummary } from './filesTypes.js';

export type { FilesEditorState } from './filesEditorModel.js';

export type FilesEditorProps = {
  /** The Space the window shows. */
  space: SpaceSummary;
  /** Every root, with its present baseline and snapshot, kept current by the layout. A diff is read again when its root's snapshot changes. */
  roots: RootSummary[];
  /** The last request to open a file, or `null`. A new `seq` is a new request. */
  openRequest: FilesOpenRequest | null;
  /** Select a root and reveal a file of it in the tree (from a document's tab or its history). */
  onRevealFile: (rootId: string, path: string) => void;
  /** The documents to start with, as `onStateChange` gave them. For phase M5.7's restore. */
  initialState?: FilesEditorState;
  /** Told of every change of the documents, their modes and their pins. For phase M5.7. */
  onStateChange?: (state: FilesEditorState) => void;
};

/** The label of each mode, one to one with the mode's internal name. */
const MODE_LABEL: Record<FilesDocMode, string> = {
  code: 'Code',
  preview: 'Preview',
  diff: 'Diff',
  'at-commit': 'At commit',
};

/**
 * The editor of the Files window: the strip of open documents (one per root
 * and path, from any root), Code, Preview for markdown, Diff with the file's
 * history, and a file at a commit. The state of the documents is one
 * serialisable `FilesEditorState`; unsaved text is kept apart and guarded
 * when a document is closed and when the window unloads.
 */
export function FilesEditor({
  roots,
  openRequest,
  onRevealFile,
  initialState,
  onStateChange,
}: FilesEditorProps): JSX.Element {
  const [state, dispatch] = useReducer(filesEditorReducer, initialState ?? EMPTY_EDITOR_STATE);

  // A request is taken once, by its `seq`.
  const lastSeq = useRef<number | null>(null);
  useEffect(() => {
    if (openRequest === null || openRequest.seq === lastSeq.current) return;
    lastSeq.current = openRequest.seq;
    dispatch({ type: 'open', request: openRequest });
  }, [openRequest]);

  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  useEffect(() => {
    onStateChangeRef.current?.(state);
  }, [state]);

  // Unsaved text by document key; `dirty` mirrors its keys for rendering.
  const bufferMap = useRef(new Map<string, string>());
  const [dirty, setDirty] = useState<ReadonlySet<string>>(() => new Set());
  const buffers = useMemo<FilesBuffers>(
    () => ({
      get: (key) => bufferMap.current.get(key),
      set: (key, text) => {
        const had = bufferMap.current.has(key);
        if (text === null) bufferMap.current.delete(key);
        else bufferMap.current.set(key, text);
        if (had !== (text !== null)) setDirty(new Set(bufferMap.current.keys()));
      },
    }),
    [],
  );

  const anyDirty = dirty.size > 0;
  useEffect(() => {
    if (!anyDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [anyDirty]);

  const requestClose = useCallback(
    (doc: FilesDocState): void => {
      const key = docKey(doc);
      if (
        dirty.has(key) &&
        !window.confirm(`Discard unsaved changes to ${doc.path}? They are not saved.`)
      ) {
        return;
      }
      buffers.set(key, null);
      dispatch({ type: 'close', key });
    },
    [dirty, buffers],
  );

  const activeTabRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a change of the active document is when the strip scrolls.
  useEffect(() => {
    activeTabRef.current?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }, [state.activeKey]);

  const rootName = (rootId: string): string =>
    roots.find((summary) => summary.root.id === rootId)?.root.name ?? rootId;

  const active = state.docs.find((doc) => docKey(doc) === state.activeKey) ?? null;

  // The last request, said to assistive technology when it arrives.
  const announcement =
    openRequest === null ? null : (
      <output style={visuallyHiddenStyle} data-testid="files-editor-request">
        {openRequest.rootId}: {openRequest.path} ({openRequest.mode})
      </output>
    );

  if (state.docs.length === 0) {
    return (
      <div style={panelStyle} data-testid="files-editor">
        <p style={emptyStyle} data-testid="files-editor-empty">
          No document is open. Open a file from the tree or a change from the changes list.
        </p>
        {announcement}
      </div>
    );
  }

  return (
    <div style={panelStyle} data-testid="files-editor">
      {announcement}
      <div style={stripStyle} role="tablist" aria-label="Open documents">
        {state.docs.map((doc) => {
          const key = docKey(doc);
          const isActive = key === state.activeKey;
          const isDirty = dirty.has(key);
          const name = baseName(doc.path);
          return (
            <div
              key={key}
              ref={isActive ? activeTabRef : undefined}
              style={{ ...tabStyle, ...(isActive ? tabActiveStyle : null) }}
              data-testid={`files-doc-tab-${doc.rootId}-${doc.path}`}
              data-active={isActive}
              data-dirty={isDirty ? true : undefined}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  requestClose(doc);
                }
              }}
            >
              {isDirty ? (
                <span style={dirtyDotStyle} role="img" aria-label="Unsaved changes" />
              ) : null}
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                style={tabNameStyle}
                title={`${rootName(doc.rootId)}: ${doc.path}`}
                onClick={() => dispatch({ type: 'activate', key })}
              >
                {name}
                <span style={tabRootStyle}>{rootName(doc.rootId)}</span>
              </button>
              <button
                type="button"
                style={tabCloseStyle}
                aria-label={`Close ${doc.path} of ${rootName(doc.rootId)}`}
                title="Close"
                data-testid={`files-doc-close-${doc.rootId}-${doc.path}`}
                onClick={() => requestClose(doc)}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      {active !== null ? (
        <ActiveDocument
          key={docKey(active)}
          doc={active}
          summary={roots.find((summary) => summary.root.id === active.rootId)}
          buffers={buffers}
          dispatch={dispatch}
          onRevealFile={onRevealFile}
        />
      ) : null}
    </div>
  );
}

function ActiveDocument({
  doc,
  summary,
  buffers,
  dispatch,
  onRevealFile,
}: {
  doc: FilesDocState;
  summary: RootSummary | undefined;
  buffers: FilesBuffers;
  dispatch: (action: Parameters<typeof filesEditorReducer>[1]) => void;
  onRevealFile: (rootId: string, path: string) => void;
}): JSX.Element {
  const key = docKey(doc);
  const tracked = summary?.root.tracking.tracked === true;
  const modes: FilesDocMode[] = [
    'code',
    ...(isMarkdown(doc.path) ? (['preview'] as const) : []),
    'diff',
    ...(doc.atCommit !== null ? (['at-commit'] as const) : []),
  ];
  const editing = doc.mode === 'code' || doc.mode === 'preview';

  return (
    <>
      <div style={toolbarStyle}>
        <fieldset style={segmentStyle}>
          <legend style={visuallyHiddenStyle}>Mode</legend>
          {modes.map((mode) => {
            const disabled = !tracked && (mode === 'diff' || mode === 'at-commit');
            return (
              <button
                key={mode}
                type="button"
                style={doc.mode === mode ? segOnStyle : segStyle}
                aria-pressed={doc.mode === mode}
                disabled={disabled}
                title={disabled ? 'This root is not tracked by git, so it has no diff.' : undefined}
                data-testid={`files-editor-mode-${mode}`}
                onClick={() => dispatch({ type: 'set-mode', key, mode })}
              >
                {MODE_LABEL[mode]}
              </button>
            );
          })}
        </fieldset>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          style={buttonStyle}
          data-testid="files-editor-reveal"
          onClick={() => onRevealFile(doc.rootId, doc.path)}
        >
          Show in tree
        </button>
      </div>
      {editing ? (
        <FilesCodeView
          docKey={key}
          rootId={doc.rootId}
          path={doc.path}
          livePreview={doc.mode === 'preview'}
          buffers={buffers}
        />
      ) : (
        <FilesDiffView
          doc={doc}
          summary={summary}
          onPin={(pin) => dispatch({ type: 'pin', key, pin })}
          onAgainst={(against) => dispatch({ type: 'against', key, against })}
          onOpenAt={(at) => dispatch({ type: 'open-at', key, at })}
        />
      )}
    </>
  );
}
