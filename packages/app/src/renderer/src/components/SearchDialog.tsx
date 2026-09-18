import { Command } from 'cmdk';
import { type JSX, useEffect, useMemo, useState } from 'react';
import type { ContentSearchHit, FileSearchHit } from '../../../shared/ipc.js';
import { ModalSheet } from './overlay/ModalSheet.js';

/** One searchable scope — a pinned tab and the directories it covers. */
export type SearchScope = { id: string; label: string; dirs: string[] };

/** A result row — a name match or an in-file content match. */
type Row = { kind: 'name'; hit: FileSearchHit } | { kind: 'content'; hit: ContentSearchHit };
type Group = { id: string; label: string; rows: Row[] };

type Props = {
  scopes: SearchScope[];
  /** Reveal the file in the pane that owns it. */
  onPick: (path: string) => void;
  /** Absolute → short tab-relative path, for display. */
  displayPath: (absPath: string) => string;
  /** Close the dialog (Esc, backdrop, ×, or after a pick). */
  onClose: () => void;
  /** A sentence shown under the scopes. The cockpit passes none. */
  note?: string;
};

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

/** A row's cmdk item value — unique across kinds and content lines. */
function rowValue(row: Row): string {
  return `${row.kind}:${row.hit.path}${row.kind === 'content' ? `:${row.hit.line}` : ''}`;
}

/**
 * The project search dialog — a modal (VS Code-style) opened by ⌘F or the Edit
 * ▸ Find menu item, not a header bar. Search by file name (fuzzy, or a `*`/`?`
 * glob) and by content (ripgrep) at once; results are grouped by pinned tab
 * (Status / Payload / Memory / Publish), each row badged by match kind (name vs
 * in-file) and flagged when it's a normally-ignored file. Scope checkboxes and
 * the include-ignored toggle narrow the search. Double-click (or Enter) opens a
 * result and closes; Esc / backdrop / × close without picking.
 *
 * Hosted in a `ModalSheet` (portal, backdrop, Escape, focus trap) with the
 * list on **cmdk** (`shouldFilter={false}` — results are IPC-backed, the
 * index/ripgrep already filtered): cmdk owns the roving selection, hover
 * follow, wrap-around arrow nav, scroll-into-view, and combobox aria wiring
 * the old dialog hand-rolled. Picking stays ours: Enter or double-click —
 * a single click only selects, as before.
 */
export function SearchDialog({ scopes, onPick, displayPath, onClose, note }: Props): JSX.Element {
  const [query, setQuery] = useState('');
  const [nameHits, setNameHits] = useState<FileSearchHit[]>([]);
  const [contentHits, setContentHits] = useState<ContentSearchHit[]>([]);
  const [ripgrepMissing, setRipgrepMissing] = useState(false);
  /** cmdk's controlled selection — the selected row's `rowValue` string. */
  const [selected, setSelected] = useState('');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [includeIgnored, setIncludeIgnored] = useState(false);

  const dirs = useMemo(
    () => scopes.filter((s) => !excluded.has(s.id)).flatMap((s) => s.dirs),
    [scopes, excluded],
  );

  // Debounced search across the checked scopes.
  useEffect(() => {
    const q = query.trim();
    if (q === '' || dirs.length === 0) {
      setNameHits([]);
      setContentHits([]);
      setRipgrepMissing(false);
      return;
    }
    const timer = setTimeout(() => {
      void Promise.all([
        window.cockpit.searchFiles({ dirs, query: q, includeIgnored }),
        window.cockpit.searchContent({ dirs, query: q, includeIgnored }),
      ]).then(([names, content]) => {
        setNameHits(names);
        setContentHits(content.hits);
        setRipgrepMissing(content.ripgrepMissing);
        // Reset the selection so cmdk re-selects the top row of the new
        // result set (the old dialog reset its highlight to 0 here).
        setSelected('');
      });
    }, 150);
    return () => clearTimeout(timer);
  }, [query, dirs, includeIgnored]);

  // Group every hit under the scope whose dirs contain it (first match wins).
  const groups = useMemo<Group[]>(() => {
    const scopeIdOf = (path: string): string | null => {
      for (const s of scopes) {
        if (s.dirs.some((d) => path === d || path.startsWith(`${d}/`))) return s.id;
      }
      return null;
    };
    const all: Row[] = [
      ...nameHits.map((hit): Row => ({ kind: 'name', hit })),
      ...contentHits.map((hit): Row => ({ kind: 'content', hit })),
    ];
    const out: Group[] = [];
    for (const s of scopes) {
      const rows = all.filter((r) => scopeIdOf(r.hit.path) === s.id);
      if (rows.length > 0) out.push({ id: s.id, label: s.label, rows });
    }
    const orphans = all.filter((r) => scopeIdOf(r.hit.path) === null);
    if (orphans.length > 0) out.push({ id: '_other', label: 'Other', rows: orphans });
    return out;
  }, [scopes, nameHits, contentHits]);

  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const rowByValue = useMemo(() => new Map(flat.map((r) => [rowValue(r), r])), [flat]);

  const pick = (path: string): void => {
    onPick(path);
    onClose();
  };

  // Enter picks the selected row. Arrows, hover follow, and scroll-into-view
  // are cmdk's; Escape and backdrop are the ModalSheet's.
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && flat.length > 0) {
      e.preventDefault();
      const row = rowByValue.get(selected) ?? flat[0];
      if (row) pick(row.hit.path);
    }
  };

  const renderRow = (row: Row): JSX.Element => {
    const { hit } = row;
    return (
      <Command.Item
        key={rowValue(row)}
        value={rowValue(row)}
        className="search-row"
        style={rowStyle}
        data-testid={row.kind === 'name' ? 'search-result' : 'content-result'}
        onDoubleClick={() => pick(hit.path)}
      >
        <span style={row.kind === 'name' ? kindNameStyle : kindTextStyle}>
          {row.kind === 'name' ? 'name' : 'text'}
        </span>
        <span style={rowMainStyle}>
          <span style={rowTopStyle}>
            <span style={nameStyle}>
              {hit.name}
              {row.kind === 'content' ? <span style={lineStyle}>:{hit.line}</span> : null}
            </span>
            {hit.ignored ? <span style={ignoredBadgeStyle}>ignored</span> : null}
          </span>
          <span style={pathStyle}>{dirname(displayPath(hit.path)) || displayPath(hit.path)}</span>
          {row.kind === 'content' ? <span style={snippetStyle}>{hit.snippet}</span> : null}
        </span>
      </Command.Item>
    );
  };

  return (
    <ModalSheet
      label="Search the project"
      onClose={onClose}
      testId="search-dialog"
      backdropTestId="search-dialog-backdrop"
      backdropStyle={{ background: 'rgba(0, 0, 0, 0.45)' }}
      panelStyle={panelStyle}
    >
      <Command
        label="Search the project"
        shouldFilter={false}
        loop
        value={selected}
        onValueChange={setSelected}
        onKeyDown={onKeyDown}
        style={commandStyle}
      >
        <div style={headerStyle}>
          <span aria-hidden style={iconStyle}>
            ⌕
          </span>
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Search files and contents…  (try *.ts)"
            style={inputStyle}
            data-testid="search-dialog-input"
          />
          <button type="button" style={closeBtnStyle} onClick={onClose} aria-label="Close search">
            ×
          </button>
        </div>

        <div style={controlsRowStyle}>
          {scopes.map((s) => (
            <label key={s.id} style={chipStyle}>
              <input
                type="checkbox"
                checked={!excluded.has(s.id)}
                onChange={(e) =>
                  setExcluded((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.delete(s.id);
                    else next.add(s.id);
                    return next;
                  })
                }
                data-testid={`search-scope-${s.id}`}
              />
              {s.label}
            </label>
          ))}
          <span style={dividerStyle} aria-hidden="true" />
          <label
            style={chipStyle}
            title="Include ignored + hidden files (.git, node_modules, build output)"
          >
            <input
              type="checkbox"
              checked={includeIgnored}
              onChange={(e) => setIncludeIgnored(e.target.checked)}
              data-testid="search-include-ignored"
            />
            incl. ignored
          </label>
        </div>
        {note !== undefined ? (
          <div style={hintStyle} data-testid="search-dialog-note">
            {note}
          </div>
        ) : null}

        <Command.List style={resultsStyle}>
          {flat.length === 0 && query.trim() !== '' ? (
            <div style={emptyStyle}>No matches.</div>
          ) : null}
          {groups.map((g) => (
            <div key={g.id}>
              <div style={groupHeaderStyle}>
                {g.label}
                <span style={groupCountStyle}>{g.rows.length}</span>
              </div>
              {g.rows.map(renderRow)}
            </div>
          ))}
          {ripgrepMissing ? (
            <div style={hintStyle} data-testid="content-search-hint">
              Install ripgrep (`rg`) on your PATH to search inside files.
            </div>
          ) : null}
        </Command.List>
      </Command>
    </ModalSheet>
  );
}

/** Panel placement and skin — the backdrop/portal/Escape are the ModalSheet's.
 *  Mirrors the old flex-centred panel: top 8vh, horizontally centred. */
const panelStyle: React.CSSProperties = {
  top: '8vh',
  left: '50%',
  transform: 'translateX(-50%)',
  width: 'min(56rem, 92vw)',
  maxHeight: '78vh',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--color-raised)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '8px',
  boxShadow: '0 16px 48px rgba(0, 0, 0, 0.6)',
  overflow: 'hidden',
};

/** The cmdk root fills the panel; the list below it owns the scroll. */
const commandStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  outline: 'none',
};

const headerStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.7rem 0.8rem',
  borderBottom: '1px solid var(--color-border)',
};

const iconStyle: React.CSSProperties = {
  color: 'var(--color-text-muted)',
  fontSize: '1.05rem',
  lineHeight: 1,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: '2.1rem',
  padding: '0 0.6rem',
  background: 'var(--color-panel)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '5px',
  color: 'var(--color-text)',
  fontSize: '0.9rem',
};

const closeBtnStyle: React.CSSProperties = {
  flex: 'none',
  width: '1.8rem',
  height: '1.8rem',
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-secondary)',
  fontSize: '1.2rem',
  lineHeight: 1,
  cursor: 'pointer',
};

const controlsRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '0.25rem 0.8rem',
  padding: '0.5rem 0.8rem',
  borderBottom: '1px solid var(--color-border)',
};

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.35rem',
  color: 'var(--color-text-secondary)',
  fontSize: '0.74rem',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const dividerStyle: React.CSSProperties = {
  width: '1px',
  height: '1rem',
  background: 'var(--color-border-strong)',
};

const resultsStyle: React.CSSProperties = {
  overflowY: 'auto',
  minHeight: 0,
  padding: '0.3rem 0',
};

const emptyStyle: React.CSSProperties = {
  padding: '1rem 0.9rem',
  color: 'var(--color-text-muted)',
  fontSize: '0.8rem',
  fontStyle: 'italic',
};

const groupHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.45rem 0.9rem 0.2rem',
  color: 'var(--color-text-muted)',
  fontSize: '0.64rem',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};

const groupCountStyle: React.CSSProperties = {
  color: 'var(--color-text-secondary)',
  background: 'var(--color-border)',
  borderRadius: '999px',
  padding: '0 0.35rem',
  fontSize: '0.62rem',
};

/** Row layout only — the selected background rides the `.search-row`
 *  `[data-selected]` rule in the global CSS (cmdk marks the selected item). */
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '0.5rem',
  width: '100%',
  padding: '0.35rem 0.9rem',
  textAlign: 'left',
  cursor: 'pointer',
};

const kindBadgeBase: React.CSSProperties = {
  flex: 'none',
  marginTop: '0.1rem',
  fontSize: '0.58rem',
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  borderRadius: '3px',
  padding: '0.05rem 0.3rem',
};
const kindNameStyle: React.CSSProperties = {
  ...kindBadgeBase,
  background: 'var(--color-match-bg)',
  color: 'var(--color-accent-bright)',
};
const kindTextStyle: React.CSSProperties = {
  ...kindBadgeBase,
  background: 'var(--color-amber-tag-bg)',
  color: 'var(--color-amber)',
};

const rowMainStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.05rem',
};

const rowTopStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.5rem',
};

const nameStyle: React.CSSProperties = {
  color: 'var(--color-text-bright)',
  fontSize: '0.8rem',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const lineStyle: React.CSSProperties = {
  color: 'var(--color-text-muted)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

const ignoredBadgeStyle: React.CSSProperties = {
  flex: 'none',
  fontSize: '0.6rem',
  color: 'var(--color-amber-tag-fg)',
  border: '1px solid var(--color-amber-tag-border)',
  borderRadius: '3px',
  padding: '0 0.3rem',
};

const pathStyle: React.CSSProperties = {
  color: 'var(--color-text-muted)',
  fontSize: '0.68rem',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const snippetStyle: React.CSSProperties = {
  color: 'var(--color-text-secondary)',
  fontSize: '0.7rem',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const hintStyle: React.CSSProperties = {
  padding: '0.6rem 0.9rem',
  color: 'var(--color-text-muted)',
  fontSize: '0.74rem',
};
