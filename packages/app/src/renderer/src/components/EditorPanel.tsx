import { type JSX, useEffect, useRef, useState } from 'react';
import type { FileHistoryEntry, SavePointInfo } from '../../shared/ipc.js';
import { type EditorDoc, useCockpitStore } from '../store.js';
import { CommitRow } from './CommitRow.js';
import { MarkdownPreview } from './editor/MarkdownPreview.js';
import { makeCodeView, makeDiffView, makeTripleView } from './editor/codemirror.js';

/** How the history column diffs a picked commit. */
type HistoryMode = 'current' | 'commit' | 'all3';

/** Markdown files get the third "Preview" view. */
function isMarkdown(name: string): boolean {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return ext === 'md' || ext === 'markdown' || ext === 'mdx';
}

/**
 * The editor column of the Read-only IDE. When one or more files are open the
 * left panel splits into nav | editor and this renders here: a strip of open
 * docs, a per-doc toolbar (Code | Diff toggle + open-in-external-editor), and a
 * CodeMirror surface showing the active doc as content or as a side-by-side diff
 * against the selected save-point/ack. Everything is **read-only** — files are
 * viewed, never written.
 */
export function EditorPanel(): JSX.Element | null {
  const docs = useCockpitStore((s) => s.editorDocs);
  const activePath = useCockpitStore((s) => s.activeDocPath);
  const setActiveDoc = useCockpitStore((s) => s.setActiveDoc);
  const closeDoc = useCockpitStore((s) => s.closeDoc);
  const setDocMode = useCockpitStore((s) => s.setDocMode);
  const hasSavePoint = useCockpitStore((s) =>
    s.chain && !('error' in s.chain) ? s.chain.hasSavePoint : false,
  );

  const active = docs.find((d) => d.path === activePath) ?? null;
  if (docs.length === 0) return null;

  return (
    <section style={panelStyle} data-testid="editor-panel" data-pane="editor">
      <div style={stripStyle} aria-label="Open files">
        {docs.map((doc) => {
          const isActive = doc.path === activePath;
          return (
            <div
              key={doc.path}
              style={{ ...tabStyle, ...(isActive ? tabActiveStyle : null) }}
              data-testid={`editor-tab-${doc.name}`}
              data-active={isActive}
            >
              <button
                type="button"
                style={tabNameStyle}
                title={doc.path}
                onClick={() => setActiveDoc(doc.path)}
              >
                {doc.name}
              </button>
              <button
                type="button"
                style={tabCloseStyle}
                aria-label={`Close ${doc.name}`}
                title="Close"
                onClick={() => closeDoc(doc.path)}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {active ? (
        <>
          <div style={toolbarStyle}>
            <div style={segmentStyle} aria-label="View mode">
              <button
                type="button"
                style={active.mode === 'code' ? segOnStyle : segStyle}
                aria-pressed={active.mode === 'code'}
                data-testid="editor-mode-code"
                onClick={() => setDocMode(active.path, 'code')}
              >
                Code
              </button>
              <button
                type="button"
                style={active.mode === 'diff' ? segOnStyle : segStyle}
                aria-pressed={active.mode === 'diff'}
                disabled={!hasSavePoint}
                data-testid="editor-mode-diff"
                title={
                  hasSavePoint
                    ? 'Diff against the selected save-point/ack'
                    : 'No save-point recorded — nothing to diff against'
                }
                onClick={() => setDocMode(active.path, 'diff')}
              >
                Diff
              </button>
              {isMarkdown(active.name) ? (
                <button
                  type="button"
                  style={active.mode === 'preview' ? segOnStyle : segStyle}
                  aria-pressed={active.mode === 'preview'}
                  data-testid="editor-mode-preview"
                  title="Rendered markdown preview"
                  onClick={() => setDocMode(active.path, 'preview')}
                >
                  Preview
                </button>
              ) : null}
            </div>
            <span style={toolbarSpacerStyle} />
            <button
              type="button"
              style={externalBtnStyle}
              data-testid="editor-open-external"
              title="Open in the external editor"
              onClick={() => void window.cockpit.openPath(active.path)}
            >
              Open externally ↗
            </button>
          </div>
          {active.mode === 'preview' && isMarkdown(active.name) ? (
            <MarkdownPreview doc={active} />
          ) : (
            <DocView doc={active} />
          )}
        </>
      ) : null}
    </section>
  );
}

/** The CodeMirror host for one doc. Rebuilds on doc / mode / baseline change and
 *  when the repo's changes snapshot ticks (an on-disk edit), so the view stays
 *  live against both the selected save-point and the file on disk. */
function DocView({ doc }: { doc: EditorDoc }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const globalBaseline = useCockpitStore((s) => s.baselineByScope[doc.scope]);
  const setDocDiffBaseline = useCockpitStore((s) => s.setDocDiffBaseline);
  // The history column's width, dragged via the divider beside it. Local to the
  // editor and persists across doc switches (DocView stays mounted).
  const [historyWidth, setHistoryWidth] = useState(240);
  const onHistoryResize = (e: React.MouseEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = historyWidth;
    const onMove = (ev: MouseEvent): void =>
      setHistoryWidth(Math.max(150, Math.min(480, startW + (ev.clientX - startX))));
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  // How the history column diffs a picked commit: against your **current** file
  // (the chosen point vs the working tree — the default), the commit's own
  // **change** (that commit vs its parent), or **all 3** (parent · commit ·
  // current side by side).
  const [historyMode, setHistoryMode] = useState<HistoryMode>('current');
  // This file's commit history (newest first). Each version carries its git
  // **blob** so a past version is fetched by blob — rename/move-safe, unlike
  // `git show <commit>:<current-path>` which misses a file that has since moved.
  const [entries, setEntries] = useState<FileHistoryEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    void window.cockpit.fileHistory({ scope: doc.scope, relPath: doc.path }).then((r) => {
      if (!cancelled) setEntries(r.kind === 'ok' ? r.entries : []);
    });
    return () => {
      cancelled = true;
    };
  }, [doc.path, doc.scope]);

  // The effective diff baseline: this file's per-file pin (from its history
  // column), else the global baseline picker.
  const baseline = doc.diffBaseline ?? globalBaseline;
  // When pinned to a commit in this file's history, read the version + its
  // predecessor by blob. `pinnedIdx + 1` is the file's *previous* version.
  const pinnedIdx = doc.diffBaseline ? entries.findIndex((e) => e.sha === doc.diffBaseline) : -1;
  const pinnedInHistory = pinnedIdx >= 0;
  const commitBlob = pinnedInHistory ? (entries[pinnedIdx]?.blob ?? '') : '';
  const parentBlob = pinnedInHistory ? (entries[pinnedIdx + 1]?.blob ?? '') : '';
  const changeMode = historyMode === 'commit' && pinnedInHistory;
  const threeMode = historyMode === 'all3' && pinnedInHistory;
  // The changes snapshot for this scope ticks whenever a file under it changes
  // on disk — use it as the "re-read from disk" signal for the open doc.
  const diskSignal = useCockpitStore((s) => s.changes[doc.scope]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'no-save-point' | 'unreadable'>(
    'loading',
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: diskSignal is a deliberate re-read trigger — the repo's changes snapshot ticks on an on-disk edit, keeping the open view live; it isn't read in the body.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    let cancelled = false;
    let view: { destroy: () => void } | null = null;
    setStatus('loading');
    const readBlob = (blob: string): Promise<{ kind: 'ok'; text: string } | { kind: 'failed' }> =>
      blob
        ? window.cockpit.readBlob({ scope: doc.scope, blob })
        : Promise.resolve({ kind: 'ok', text: '' });
    void (async () => {
      const current = await window.cockpit.readFile({ path: doc.path });
      if (cancelled || !hostRef.current) return;
      if (current.kind !== 'text') {
        setStatus('unreadable');
        return;
      }
      if (doc.mode === 'code') {
        view = makeCodeView(el, doc.name, current.text);
        setStatus('ready');
        return;
      }
      // Parent-relative modes: the picked version vs the file's previous version,
      // both fetched by blob. The oldest version has no predecessor → empty
      // parent → it reads as a full add.
      if (changeMode || threeMode) {
        const [parent, commit] = await Promise.all([readBlob(parentBlob), readBlob(commitBlob)]);
        if (cancelled || !hostRef.current) return;
        const parentText = parent.kind === 'ok' ? parent.text : '';
        const commitText = commit.kind === 'ok' ? commit.text : '';
        if (threeMode) {
          // "All 3": parent · commit · current side by side; the SHA tells the story.
          const sha = String(doc.diffBaseline ?? '').slice(0, 7);
          view = makeTripleView(el, doc.name, [
            { label: 'Parent', text: parentText },
            { label: `Commit ${sha}`, text: commitText },
            { label: 'Current', text: current.text },
          ]);
        } else {
          // "Change": what the picked commit changed — its predecessor vs itself.
          view = makeDiffView(el, doc.name, parentText, commitText);
        }
        setStatus('ready');
        return;
      }
      // "Current" mode, pinned to a history commit: that version (by blob) vs
      // your current file.
      if (pinnedInHistory) {
        const commit = await readBlob(commitBlob);
        if (cancelled || !hostRef.current) return;
        view = makeDiffView(el, doc.name, commit.kind === 'ok' ? commit.text : '', current.text);
        setStatus('ready');
        return;
      }
      // "Current" mode, following the global baseline picker (a milestone that
      // isn't necessarily in this file's history): resolve by commit+path.
      const base = await window.cockpit.readFileBaseline({
        scope: doc.scope,
        relPath: doc.path,
        oldPath: doc.oldPath,
        baseline,
      });
      if (cancelled || !hostRef.current) return;
      if (base.kind === 'no-save-point') {
        setStatus('no-save-point');
        return;
      }
      const baseText = base.kind === 'ok' ? base.text : '';
      view = makeDiffView(el, doc.name, baseText, current.text);
      setStatus('ready');
    })();
    return () => {
      cancelled = true;
      view?.destroy();
      if (el) el.replaceChildren();
    };
  }, [
    doc.path,
    doc.name,
    doc.scope,
    doc.mode,
    doc.oldPath,
    doc.diffBaseline,
    baseline,
    changeMode,
    threeMode,
    pinnedInHistory,
    commitBlob,
    parentBlob,
    diskSignal,
  ]);

  const body = (
    <div style={docBodyStyle}>
      <div ref={hostRef} style={cmHostStyle} data-testid="editor-cm-host" />
      {status !== 'ready' ? (
        <div style={overlayStyle} data-testid={`editor-status-${status}`}>
          {status === 'loading'
            ? 'Reading…'
            : status === 'no-save-point'
              ? 'No save-point recorded — nothing to diff against.'
              : 'This file can’t be shown in the editor.'}
        </div>
      ) : null}
    </div>
  );

  // In diff mode the file's commit history sits in a left column; clicking an
  // entry pins this file's diff to that commit (toggle to unpin → follow global).
  if (doc.mode === 'diff') {
    return (
      <div style={diffLayoutStyle}>
        <DiffHistoryColumn
          doc={doc}
          entries={entries}
          effective={baseline}
          width={historyWidth}
          mode={historyMode}
          onModeChange={setHistoryMode}
          onPick={(sha) => setDocDiffBaseline(doc.path, doc.diffBaseline === sha ? null : sha)}
        />
        <div
          style={historyResizeStyle}
          onMouseDown={onHistoryResize}
          title="Drag to resize the history column"
          data-testid="diff-history-resize"
        />
        {body}
      </div>
    );
  }
  return body;
}

/** The diff's per-file history column: every ack/save-point that touched this
 *  file, newest first. Clicking one re-bases *this file's* diff against that
 *  commit, leaving the global picker and every other open file untouched. */
function DiffHistoryColumn({
  doc,
  entries,
  effective,
  width,
  mode,
  onModeChange,
  onPick,
}: {
  doc: EditorDoc;
  entries: FileHistoryEntry[];
  effective: string;
  width: number;
  mode: HistoryMode;
  onModeChange: (mode: HistoryMode) => void;
  onPick: (sha: string) => void;
}): JSX.Element {
  const savePoints = useCockpitStore((s) => s.savePoints);

  const spCommit = (sp: SavePointInfo): string =>
    doc.scope === 'payload' ? sp.payloadCommit : sp.loreCommit;
  // The global default `'HEAD'` resolves to the latest save-point — highlight
  // that row so "following the picker" reads correctly.
  const resolvedEffective =
    effective === 'HEAD' && savePoints[0] ? spCommit(savePoints[0]) : effective;

  const modes: { id: HistoryMode; label: string; title: string }[] = [
    {
      id: 'current',
      label: 'Current',
      title: 'Compare the selected commit against your current file',
    },
    {
      id: 'commit',
      label: 'Change',
      title: 'What the selected commit changed (vs the commit before it)',
    },
    { id: 'all3', label: 'All 3', title: 'Parent · commit · current, side by side' },
  ];

  return (
    <div style={{ ...historyColStyle, width }} data-testid="diff-history">
      <div style={historyHeadStyle}>History</div>
      <div style={historyToggleRowStyle} aria-label="Compare mode">
        {modes.map((m) => (
          <button
            key={m.id}
            type="button"
            style={mode === m.id ? historyToggleOnStyle : historyToggleStyle}
            aria-pressed={mode === m.id}
            title={m.title}
            data-testid={`history-mode-${m.id}`}
            onClick={() => onModeChange(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {entries.length === 0 && savePoints.length === 0 ? (
        <div style={historyMsgStyle}>No history.</div>
      ) : (
        <div style={historyListStyle}>
          {/* Every save-point shows as a ★ reference marker — clickable when it
              touched this file, a dim label when it didn't — with the file's own
              acks (•) slotted in between by date. */}
          {buildTimeline(entries, savePoints, doc.scope).map((item) => (
            <CommitRow
              key={`${item.kind}-${item.sha}`}
              kind={item.kind}
              label={item.label}
              sha={item.sha}
              timestamp={Math.floor(item.ts / 1000)}
              active={item.clickable && item.sha === resolvedEffective}
              disabled={!item.clickable}
              testId={`history-${item.sha}`}
              onClick={() => onPick(item.sha)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type TimelineItem = {
  sha: string;
  kind: 'save-point' | 'ack';
  label: string;
  /** Epoch ms. */
  ts: number;
  clickable: boolean;
};

/**
 * The per-file diff timeline: **all** save-points as reference markers (clickable
 * only when the save-point's commit actually touched this file), with the file's
 * own acks slotted in between by date — so you can read how the file changed
 * across save-points. Newest first.
 */
function buildTimeline(
  entries: FileHistoryEntry[],
  savePoints: SavePointInfo[],
  scope: 'payload' | 'lore',
): TimelineItem[] {
  const spSha = (sp: SavePointInfo): string =>
    scope === 'payload' ? sp.payloadCommit : sp.loreCommit;
  const fileBySha = new Map(entries.map((e) => [e.sha, e]));
  const spShaSet = new Set(savePoints.map(spSha));
  const items: TimelineItem[] = [];
  for (const sp of savePoints) {
    const sha = spSha(sp);
    const fe = fileBySha.get(sha);
    items.push({
      sha,
      kind: 'save-point',
      label: sp.title,
      ts: fe ? fe.timestamp : Date.parse(sp.date) || 0,
      clickable: fe !== undefined,
    });
  }
  for (const e of entries) {
    if (spShaSet.has(e.sha)) continue;
    items.push({ sha: e.sha, kind: 'ack', label: e.subject, ts: e.timestamp, clickable: true });
  }
  items.sort((a, b) => b.ts - a.ts);
  return items;
}

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  background: '#0a0f17',
  borderRight: '1px solid #1f2933',
};

const stripStyle: React.CSSProperties = {
  display: 'flex',
  flexShrink: 0,
  overflowX: 'auto',
  background: '#0f1620',
  borderBottom: '1px solid #1f2933',
};

const tabStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.2rem',
  padding: '0 0.3rem 0 0.7rem',
  borderRight: '1px solid #1f2933',
  background: 'transparent',
  whiteSpace: 'nowrap',
};

const tabActiveStyle: React.CSSProperties = {
  background: '#0a0f17',
  boxShadow: 'inset 0 -2px 0 #5a9bd4',
};

const tabNameStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#dde3ea',
  fontSize: '0.78rem',
  padding: '0.45rem 0',
  cursor: 'pointer',
};

const tabCloseStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#6c7783',
  fontSize: '0.95rem',
  lineHeight: 1,
  padding: '0.1rem 0.25rem',
  borderRadius: '4px',
  cursor: 'pointer',
};

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.35rem 0.6rem',
  flexShrink: 0,
  background: '#0c121a',
  borderBottom: '1px solid #1f2933',
};

const segmentStyle: React.CSSProperties = {
  display: 'inline-flex',
  border: '1px solid #2f3a45',
  borderRadius: '5px',
  overflow: 'hidden',
};

const segStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#9fb1bd',
  fontSize: '0.74rem',
  fontWeight: 600,
  padding: '0.2rem 0.7rem',
  cursor: 'pointer',
};

const segOnStyle: React.CSSProperties = {
  ...segStyle,
  background: '#1d4e74',
  color: '#e6f2ff',
};

const toolbarSpacerStyle: React.CSSProperties = { flex: 1 };

const externalBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #2f3a45',
  borderRadius: '5px',
  color: '#9fb1bd',
  fontSize: '0.74rem',
  fontWeight: 600,
  padding: '0.2rem 0.6rem',
  cursor: 'pointer',
};

/** Diff mode: the per-file history column beside the merge view. */
const diffLayoutStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
};

const historyColStyle: React.CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto',
  background: '#0c121a',
};

const historyHeadStyle: React.CSSProperties = {
  padding: '0.45rem 0.7rem',
  fontSize: '0.66rem',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#6c7783',
  borderBottom: '1px solid #1f2933',
  position: 'sticky',
  top: 0,
  background: '#0c121a',
};

const historyMsgStyle: React.CSSProperties = {
  padding: '0.6rem 0.7rem',
  fontSize: '0.74rem',
  color: '#6c7783',
};

const historyListStyle: React.CSSProperties = {
  padding: '0.25rem',
};

/** The compare-mode toggle row beneath the History header. */
const historyToggleRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '2px',
  padding: '0.3rem 0.4rem',
  borderBottom: '1px solid #1f2933',
  position: 'sticky',
  top: '1.55rem',
  background: '#0c121a',
  zIndex: 1,
};

const historyToggleStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: 'transparent',
  border: '1px solid #2f3a45',
  borderRadius: '4px',
  color: '#9fb1bd',
  fontSize: '0.66rem',
  fontWeight: 600,
  padding: '0.15rem 0',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const historyToggleOnStyle: React.CSSProperties = {
  ...historyToggleStyle,
  background: '#1d4e74',
  borderColor: '#1d4e74',
  color: '#e6f2ff',
};

/** The draggable divider between the history column and the diff. */
const historyResizeStyle: React.CSSProperties = {
  width: '6px',
  flexShrink: 0,
  cursor: 'col-resize',
  background: '#0c121a',
  borderRight: '1px solid #1f2933',
};

const docBodyStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  display: 'flex',
};

const cmHostStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
};

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1rem',
  textAlign: 'center',
  color: '#6c7783',
  fontSize: '0.82rem',
  background: '#0a0f17',
  pointerEvents: 'none',
};
