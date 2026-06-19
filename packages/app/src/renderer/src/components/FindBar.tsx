import { type JSX, useEffect, useRef, useState } from 'react';
import type { XtermSearchHandle } from './useXtermSession.js';

/**
 * The in-terminal find bar (Focus 4) — an iTerm-style overlay in the terminal's
 * top-right corner, driven by the shared `useXtermSession` search handle. Both
 * the Shell tab and the AI tab render it; ⌘F (intercepted in the hook) opens it
 * when a terminal has focus. Typing searches incrementally; Enter / Shift+Enter
 * step matches; Esc closes (and the surface returns focus to the terminal).
 */
export function FindBar({
  search,
  onClose,
}: {
  search: XtermSearchHandle;
  onClose: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ resultIndex: -1, resultCount: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input on open; subscribe to match counts; clear decorations on close.
  useEffect(() => {
    inputRef.current?.focus();
    const off = search.onResults(setResults);
    return () => {
      off();
      search.clear();
    };
  }, [search]);

  // Search incrementally as the query changes.
  useEffect(() => {
    if (query) search.findNext(query);
    else search.clear();
  }, [query, search]);

  const count =
    query === ''
      ? ''
      : results.resultCount === 0
        ? 'No matches'
        : `${results.resultIndex + 1}/${results.resultCount}`;

  return (
    <div style={barStyle} data-testid="terminal-find">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find"
        style={inputStyle}
        data-testid="terminal-find-input"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) search.findPrevious(query);
            else search.findNext(query);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <span style={countStyle} data-testid="terminal-find-count">
        {count}
      </span>
      <button
        type="button"
        style={btnStyle}
        title="Previous (⇧⏎)"
        onClick={() => search.findPrevious(query)}
      >
        ‹
      </button>
      <button
        type="button"
        style={btnStyle}
        title="Next (⏎)"
        onClick={() => search.findNext(query)}
      >
        ›
      </button>
      <button
        type="button"
        style={btnStyle}
        title="Close (Esc)"
        data-testid="terminal-find-close"
        onClick={onClose}
      >
        ✕
      </button>
    </div>
  );
}

const barStyle: React.CSSProperties = {
  position: 'absolute',
  top: '8px',
  right: '12px',
  zIndex: 5,
  display: 'flex',
  alignItems: 'center',
  gap: '0.25rem',
  padding: '0.25rem 0.4rem',
  background: 'var(--color-header)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '6px',
  boxShadow: '0 6px 18px rgba(0, 0, 0, 0.5)',
};

const inputStyle: React.CSSProperties = {
  width: '11rem',
  height: '1.5rem',
  padding: '0 0.4rem',
  background: 'var(--color-panel)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '4px',
  color: 'var(--color-text)',
  fontSize: '0.78rem',
};

const countStyle: React.CSSProperties = {
  minWidth: '3.5rem',
  textAlign: 'center',
  color: 'var(--color-text-secondary)',
  fontSize: '0.7rem',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

const btnStyle: React.CSSProperties = {
  width: '1.4rem',
  height: '1.5rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  borderRadius: '4px',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
  fontSize: '0.9rem',
  lineHeight: 1,
};
