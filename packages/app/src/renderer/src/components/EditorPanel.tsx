import { type JSX, useEffect, useRef, useState } from 'react';
import { type EditorDoc, useCockpitStore } from '../store.js';
import { makeCodeView, makeDiffView } from './editor/codemirror.js';

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
          <DocView doc={active} />
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
  const baseline = useCockpitStore((s) => s.baselineByScope[doc.scope]);
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
  }, [doc.path, doc.name, doc.scope, doc.mode, doc.oldPath, baseline, diskSignal]);

  return (
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
