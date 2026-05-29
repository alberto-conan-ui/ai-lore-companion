import {
  type JSX,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ContentSearchHit, FileSearchHit } from '../../../shared/ipc.js';

/** One row in the dropdown — a name match or an in-file content match. The two
 *  groups render under their own headers but share one keyboard highlight. */
type Row = { kind: 'name'; hit: FileSearchHit } | { kind: 'content'; hit: ContentSearchHit };

type Props = {
  /** Absolute directories the search walks — the union of every pane's roots. */
  dirs: string[];
  /** Called with the absolute path of the file the user picked. */
  onPick: (path: string) => void;
  /** Maps an absolute path to a short tab-relative path for display. */
  displayPath: (absPath: string) => string;
};

/** Imperative handle App uses to focus the search input from ⌘+F. */
export type GlobalSearchHandle = {
  /** Focus the search input, remembering the previous activeElement so Esc
   *  can return focus there. */
  focusMe: () => void;
};

function dirname(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? '' : p.slice(0, idx);
}

/**
 * Global file search in the cockpit header. Typing runs a debounced
 * main-process recursive search across every cockpit pane's directories;
 * picking a result hands the path to `onPick`, which switches to the tab that
 * owns the file and reveals it there. Mouse and keyboard share one highlight:
 * `↑`/`↓` move it (wrapping), `Enter` picks the highlighted hit, hovering a
 * row updates it, `Escape` closes.
 */
export const GlobalSearch = forwardRef<GlobalSearchHandle, Props>(function GlobalSearch(
  { dirs, onPick, displayPath }: Props,
  forwardedRef,
): JSX.Element {
  const [query, setQuery] = useState('');
  const [nameHits, setNameHits] = useState<FileSearchHit[]>([]);
  const [contentHits, setContentHits] = useState<ContentSearchHit[]>([]);
  const [ripgrepMissing, setRipgrepMissing] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  // One flat, ordered list (names first, then content) so a single highlight
  // index walks both groups with ↑/↓.
  const rows = useMemo<Row[]>(
    () => [
      ...nameHits.map((hit): Row => ({ kind: 'name', hit })),
      ...contentHits.map((hit): Row => ({ kind: 'content', hit })),
    ],
    [nameHits, contentHits],
  );
  // Refs to the result `<li>`s so we can scroll the highlighted one into view.
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);
  // Refs for the input itself and for the element that held focus when the
  // search input was focused — so Esc can return focus there.
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useImperativeHandle(forwardedRef, () => ({
    focusMe: () => {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      inputRef.current?.focus();
      inputRef.current?.select();
    },
  }));

  // Debounced search — name (index) and content (ripgrep) run together ~150ms
  // after typing settles; results show as two groups.
  useEffect(() => {
    const q = query.trim();
    if (q === '') {
      setNameHits([]);
      setContentHits([]);
      setRipgrepMissing(false);
      return;
    }
    const timer = setTimeout(() => {
      void Promise.all([
        window.cockpit.searchFiles({ dirs, query: q }),
        window.cockpit.searchContent({ dirs, query: q }),
      ]).then(([names, content]) => {
        setNameHits(names);
        setContentHits(content.hits);
        setRipgrepMissing(content.ripgrepMissing);
        setHighlight(0);
        setOpen(true);
      });
    }, 150);
    return () => clearTimeout(timer);
  }, [query, dirs]);

  // Keep `highlight` clamped if the result set shrinks (e.g. user keeps typing).
  useEffect(() => {
    if (highlight >= rows.length) setHighlight(Math.max(0, rows.length - 1));
  }, [rows.length, highlight]);

  // Scroll the highlighted row into view when the dropdown overflows `maxHeight`.
  useEffect(() => {
    if (!open) return;
    itemRefs.current[highlight]?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const pick = (path: string): void => {
    onPick(path);
    setQuery('');
    setNameHits([]);
    setContentHits([]);
    setOpen(false);
  };

  // Render one result row at its absolute index in `rows` (so the keyboard
  // highlight and the scroll-into-view refs line up across both groups).
  const renderRow = (row: Row, index: number): JSX.Element => {
    const isHighlight = index === highlight;
    const { hit } = row;
    return (
      <li
        key={`${row.kind}:${hit.path}${row.kind === 'content' ? `:${hit.line}` : ''}`}
        ref={(el) => {
          itemRefs.current[index] = el;
        }}
        style={{ listStyle: 'none' }}
      >
        <button
          type="button"
          style={isHighlight ? hitStyleHighlighted : hitStyle}
          data-testid={row.kind === 'name' ? 'search-result' : 'content-result'}
          aria-selected={isHighlight}
          onMouseEnter={() => setHighlight(index)}
          // onMouseDown fires before the input's blur — so the pick lands.
          onMouseDown={(e) => {
            e.preventDefault();
            pick(hit.path);
          }}
        >
          {row.kind === 'name' ? (
            <>
              <span style={hitNameStyle}>{hit.name}</span>
              <span style={hitDirStyle}>{dirname(displayPath(hit.path))}</span>
            </>
          ) : (
            <>
              <span style={hitNameStyle}>
                {hit.name}
                <span style={hitLineStyle}>:{hit.line}</span>
              </span>
              <span style={hitSnippetStyle}>{hit.snippet}</span>
            </>
          )}
        </button>
      </li>
    );
  };

  return (
    <div style={wrapStyle}>
      <span aria-hidden style={iconStyle}>
        ⌕
      </span>
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => {
          if (rows.length > 0) setOpen(true);
        }}
        onBlur={() => {
          // Delay the close so an onMouseDown on a result still registers.
          setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            (e.target as HTMLInputElement).blur();
            // Esc returns focus to wherever the user was before ⌘+F.
            const prev = previousFocusRef.current;
            previousFocusRef.current = null;
            if (prev && document.body.contains(prev)) prev.focus();
          } else if (e.key === 'ArrowDown' && rows.length > 0) {
            e.preventDefault();
            setHighlight((h) => (h + 1) % rows.length);
          } else if (e.key === 'ArrowUp' && rows.length > 0) {
            e.preventDefault();
            setHighlight((h) => (h - 1 + rows.length) % rows.length);
          } else if (e.key === 'Enter' && rows.length > 0) {
            const row = rows[highlight] ?? rows[0];
            if (row) pick(row.hit.path);
          }
        }}
        placeholder="Find a file by name…"
        style={inputStyle}
        data-testid="global-search"
      />
      {open && (rows.length > 0 || ripgrepMissing) ? (
        <ul style={dropdownStyle}>
          {nameHits.length > 0 ? (
            <li aria-hidden style={groupHeaderStyle}>
              Names
            </li>
          ) : null}
          {nameHits.map((hit, i) => renderRow({ kind: 'name', hit }, i))}
          {contentHits.length > 0 ? (
            <li aria-hidden style={groupHeaderStyle}>
              In files
            </li>
          ) : null}
          {contentHits.map((hit, j) => renderRow({ kind: 'content', hit }, nameHits.length + j))}
          {ripgrepMissing ? (
            <li style={hintStyle} data-testid="content-search-hint">
              Install ripgrep (`rg`) on your PATH to search inside files.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
});

const wrapStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  minWidth: 0,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: '2.05rem',
  padding: '0 0.7rem 0 2rem',
  background: '#0c121a',
  border: '1px solid #2f3a45',
  borderRadius: '5px',
  color: '#dde3ea',
  fontSize: '0.82rem',
};

/** A leading glyph inside the search input — visually marks the row as a search. */
const iconStyle: React.CSSProperties = {
  position: 'absolute',
  left: '0.7rem',
  top: '50%',
  transform: 'translateY(-50%)',
  pointerEvents: 'none',
  color: '#6c7783',
  fontSize: '0.95rem',
  lineHeight: 1,
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

const hitStyleHighlighted: React.CSSProperties = {
  ...hitStyle,
  background: '#1a2433',
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

/** A group header ("Names" / "In files") separating the two result kinds. */
const groupHeaderStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: '0.35rem 0.7rem 0.15rem',
  color: '#6c7783',
  fontSize: '0.62rem',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};

/** The trailing line/column marker on a content hit's file name. */
const hitLineStyle: React.CSSProperties = {
  color: '#6c7783',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

/** The matched line's text under a content hit. */
const hitSnippetStyle: React.CSSProperties = {
  color: '#9aa7b4',
  fontSize: '0.7rem',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/** The "install ripgrep" hint shown when `rg` is absent on PATH. */
const hintStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: '0.3rem 0.7rem',
  color: '#6c7783',
  fontSize: '0.7rem',
};
