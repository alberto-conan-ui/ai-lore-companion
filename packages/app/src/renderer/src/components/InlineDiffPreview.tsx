import type { ChangeScope } from '@ai-lore-companion/core';
import { type JSX, useEffect, useMemo, useState } from 'react';

/**
 * Threshold above which the preview shows a truncation hint + an
 * "Open externally" button instead of rendering the full diff. Plain
 * `git diff` text for a single file is usually under a few KB; this
 * threshold is the safety net for unusual changes (large renames,
 * generated files committed in a row, etc.) where rendering thousands
 * of lines would block the renderer.
 */
const TRUNCATION_BYTES = 500 * 1024;

type Props = {
  /** Which repo the diff is read from. */
  scope: ChangeScope;
  /** The pane's label — used to disambiguate test IDs when two panes share a scope. */
  label: string;
  /** The baseline the panel is currently comparing against. */
  baseline: string;
  /** Path of the currently-selected row, project-relative. `null` clears the preview. */
  selectedPath: string | null;
  /** Fired when the user clicks the "Open externally" button on a truncated diff. */
  onOpenExternally: () => void;
};

type State =
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'ok'; text: string }
  | { kind: 'failed'; message: string };

/**
 * Bottom strip inside the Changes panel — shows `git diff <baseline> -- <path>`
 * for the currently-selected row, plain text with line-level red/green colouring
 * (`-` red, `+` green, headers grey). New files appear as all-additions with a
 * `+++ new file:` header (synthesised in [core/changes/changes.ts](../../../core/src/changes/changes.ts)).
 *
 * Phase B task 5 of [Companion v0.6](../../../../.ai-lore-ai-lore-companion/memory/action-tree/companion-v0.6/B-drift-is-git.phase.md).
 */
export function InlineDiffPreview({
  scope,
  label,
  baseline,
  selectedPath,
  onOpenExternally,
}: Props): JSX.Element {
  const slug = label.toLowerCase();
  const [state, setState] = useState<State>({ kind: 'empty' });

  useEffect(() => {
    if (!selectedPath) {
      setState({ kind: 'empty' });
      return;
    }
    let cancelled = false;
    setState({ kind: 'loading' });
    void window.cockpit
      .diffText({ scope, baseline, relPath: selectedPath })
      .then((result) => {
        if (cancelled) return;
        if (result.kind === 'ok') setState({ kind: 'ok', text: result.text });
        else setState({ kind: 'failed', message: result.message });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ kind: 'failed', message: `${(err as Error).message}` });
      });
    return () => {
      cancelled = true;
    };
  }, [scope, baseline, selectedPath]);

  const truncated = state.kind === 'ok' && state.text.length > TRUNCATION_BYTES;

  const lines = useMemo(() => {
    if (state.kind !== 'ok' || truncated) return [];
    return state.text.length === 0 ? [] : state.text.split('\n');
  }, [state, truncated]);

  return (
    <section style={containerStyle} data-testid={`changes-preview-${slug}`}>
      {state.kind === 'empty' && <div style={emptyStyle}>Select a row to preview its diff.</div>}
      {state.kind === 'loading' && <div style={emptyStyle}>Loading diff…</div>}
      {state.kind === 'failed' && (
        <div style={failedStyle}>Failed to load diff: {state.message}</div>
      )}
      {state.kind === 'ok' && !truncated && lines.length === 0 && (
        <div style={emptyStyle}>No diff against this baseline.</div>
      )}
      {state.kind === 'ok' && !truncated && lines.length > 0 && (
        <pre style={preStyle} data-testid={`changes-preview-pre-${slug}`}>
          {lines.map((line, idx) => (
            <span key={idx} style={lineStyleFor(line)}>
              {line}
              {idx < lines.length - 1 ? '\n' : ''}
            </span>
          ))}
        </pre>
      )}
      {state.kind === 'ok' && truncated && (
        <div style={truncatedStyle}>
          <span>Diff is {Math.round(state.text.length / 1024)} KB — too large to preview inline.</span>
          <button
            type="button"
            onClick={onOpenExternally}
            style={openExternallyStyle}
            data-testid={`changes-preview-open-${slug}`}
          >
            Open externally
          </button>
        </div>
      )}
    </section>
  );
}

function lineStyleFor(line: string): React.CSSProperties {
  if (line.startsWith('+++') || line.startsWith('---')) return headerLineStyle;
  if (line.startsWith('@@')) return hunkLineStyle;
  if (line.startsWith('+')) return addLineStyle;
  if (line.startsWith('-')) return delLineStyle;
  if (line.startsWith('diff ') || line.startsWith('index ')) return headerLineStyle;
  return contextLineStyle;
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  height: '100%',
  background: '#0a0f17',
  borderTop: '1px solid #1f2933',
  overflow: 'auto',
};

const emptyStyle: React.CSSProperties = {
  padding: '0.6rem 0.9rem',
  color: '#6c7884',
  fontSize: '0.78rem',
  fontStyle: 'italic',
};

const failedStyle: React.CSSProperties = {
  padding: '0.6rem 0.9rem',
  color: '#ff6b6b',
  fontSize: '0.78rem',
};

const truncatedStyle: React.CSSProperties = {
  padding: '0.6rem 0.9rem',
  display: 'flex',
  alignItems: 'center',
  gap: '0.7rem',
  color: '#dde3ea',
  fontSize: '0.78rem',
};

const openExternallyStyle: React.CSSProperties = {
  background: '#1f2933',
  border: '1px solid #2f3a45',
  borderRadius: '4px',
  padding: '0.25rem 0.6rem',
  color: '#dde3ea',
  fontSize: '0.74rem',
  cursor: 'pointer',
};

const preStyle: React.CSSProperties = {
  margin: 0,
  padding: '0.4rem 0.7rem',
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  fontSize: '0.78rem',
  lineHeight: 1.45,
  color: '#dde3ea',
  whiteSpace: 'pre',
};

const headerLineStyle: React.CSSProperties = { color: '#9fb1bd' };
const hunkLineStyle: React.CSSProperties = { color: '#86a6c2', display: 'block' };
const addLineStyle: React.CSSProperties = { color: '#7fc97f', display: 'block' };
const delLineStyle: React.CSSProperties = { color: '#ff8a8a', display: 'block' };
const contextLineStyle: React.CSSProperties = { color: '#dde3ea', display: 'block' };
