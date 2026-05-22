import { type JSX, useEffect, useState } from 'react';
import type { FileSearchHit } from '../../../shared/ipc.js';

type Props = {
  /** Absolute directories the search walks — the union of every pane's roots. */
  dirs: string[];
  /** Called with the absolute path of the file the user picked. */
  onPick: (path: string) => void;
  /** Maps an absolute path to a short tab-relative path for display. */
  displayPath: (absPath: string) => string;
};

function dirname(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? '' : p.slice(0, idx);
}

/**
 * Global file search in the cockpit header. Typing runs a debounced
 * main-process recursive search across every cockpit pane's directories;
 * picking a result hands the path to `onPick`, which switches to the tab that
 * owns the file and reveals it there.
 */
export function GlobalSearch({ dirs, onPick, displayPath }: Props): JSX.Element {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<FileSearchHit[]>([]);
  const [open, setOpen] = useState(false);

  // Debounced search — one IPC round trip ~150ms after typing settles.
  useEffect(() => {
    const q = query.trim();
    if (q === '') {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      void window.cockpit.searchFiles({ dirs, query: q }).then((result) => {
        setHits(result);
        setOpen(true);
      });
    }, 150);
    return () => clearTimeout(timer);
  }, [query, dirs]);

  const pick = (hit: FileSearchHit): void => {
    onPick(hit.path);
    setQuery('');
    setHits([]);
    setOpen(false);
  };

  return (
    <div style={wrapStyle}>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => {
          if (hits.length > 0) setOpen(true);
        }}
        onBlur={() => {
          // Delay the close so an onMouseDown on a result still registers.
          setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Enter' && hits.length > 0) {
            pick(hits[0]);
          }
        }}
        placeholder="Search files…"
        style={inputStyle}
        data-testid="global-search"
      />
      {open && hits.length > 0 ? (
        <ul style={dropdownStyle}>
          {hits.map((hit) => (
            <li key={hit.path} style={{ listStyle: 'none' }}>
              <button
                type="button"
                style={hitStyle}
                data-testid="search-result"
                // onMouseDown fires before the input's blur — so the pick lands.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(hit);
                }}
              >
                <span style={hitNameStyle}>{hit.name}</span>
                <span style={hitDirStyle}>{dirname(displayPath(hit.path))}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  minWidth: 0,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.28rem 0.6rem',
  background: '#0c121a',
  border: '1px solid #2f3a45',
  borderRadius: '4px',
  color: '#dde3ea',
  fontSize: '0.76rem',
};

const dropdownStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  right: 0,
  margin: 0,
  padding: '0.2rem 0',
  maxHeight: '60vh',
  overflowY: 'auto',
  background: '#0f1620',
  border: '1px solid #2f3a45',
  borderRadius: '6px',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
  zIndex: 50,
};

const hitStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.05rem',
  width: '100%',
  padding: '0.3rem 0.7rem',
  background: 'transparent',
  border: 'none',
  textAlign: 'left',
  cursor: 'pointer',
};

const hitNameStyle: React.CSSProperties = {
  color: '#e6edf3',
  fontSize: '0.78rem',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const hitDirStyle: React.CSSProperties = {
  color: '#6c7783',
  fontSize: '0.68rem',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
