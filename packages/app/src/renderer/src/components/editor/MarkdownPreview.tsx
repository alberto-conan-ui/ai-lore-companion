import MarkdownIt from 'markdown-it';
import { type JSX, useEffect, useRef, useState } from 'react';
import { type EditorDoc, useCockpitStore } from '../../store.js';
import './markdown.css';

/**
 * Rendered markdown preview (Read-only IDE P4) — the third view for `.md` files,
 * Typora-inspired typography on a centred reading column. Read-only: it renders
 * the file's text, never edits it. `html: false` escapes any embedded raw HTML,
 * so a project file can't inject markup; links open in the external browser.
 */
const md = new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: false });

export function MarkdownPreview({ doc }: { doc: EditorDoc }): JSX.Element {
  // Re-render when the file changes on disk (the scope's changes snapshot ticks).
  const diskSignal = useCockpitStore((s) => s.changes[doc.scope]);
  const [html, setHtml] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unreadable'>('loading');
  const ref = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: diskSignal re-renders the preview on an on-disk change; it isn't read in the body.
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    void window.cockpit.readFile({ path: doc.path }).then((r) => {
      if (cancelled) return;
      if (r.kind !== 'text') {
        setStatus('unreadable');
        return;
      }
      setHtml(md.render(r.text));
      setStatus('ready');
    });
    return () => {
      cancelled = true;
    };
  }, [doc.path, diskSignal]);

  // Reset scroll to the top when switching files.
  // biome-ignore lint/correctness/useExhaustiveDependencies: doc.path is the trigger — reset scroll only on a doc change, not on every disk tick.
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [doc.path]);

  // Links in rendered markdown open in the external browser, never navigate the
  // app's own window.
  const onClick = (e: React.MouseEvent): void => {
    const anchor = (e.target as HTMLElement).closest('a');
    const href = anchor?.getAttribute('href');
    if (!href) return;
    e.preventDefault();
    if (/^https?:\/\//.test(href)) void window.cockpit.openExternal(href);
  };

  return (
    <div style={wrapStyle} ref={ref} data-testid="markdown-preview">
      {status === 'ready' && html != null ? (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown-it output, raw-HTML disabled (html:false) so project text can't inject markup
        // biome-ignore lint/a11y/useKeyWithClickEvents: delegated link-click interception only; the rendered links are themselves keyboard-accessible
        <div className="md-preview" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div style={overlayStyle}>
          {status === 'loading' ? 'Rendering…' : 'This file can’t be previewed.'}
        </div>
      )}
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflow: 'auto',
  background: 'var(--color-shell)',
};

const overlayStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  color: 'var(--color-text-muted)',
  fontSize: '0.82rem',
};
