import type { QueueEntry } from '@ai-lore-companion/core';
import type { ColDef, ValueGetterParams } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { type JSX, useMemo, useState } from 'react';
// Importing the theme also evaluates FileGrid.tsx, which registers the AG Grid
// modules and license — so this grid has them without repeating the setup.
import { cockpitGridTheme } from './FileGrid.js';

type Props = {
  label: string;
  entries: QueueEntry[];
  onRowClick: (entry: QueueEntry) => void;
  onRowDoubleClick: (entry: QueueEntry) => void;
  onAck: (id: string) => void;
  onAckAll: () => void;
  /** Maps an entry's project-relative path to its tab-relative display path. */
  displayPath: (relPath: string) => string;
};

const TYPE_GLYPH: Record<QueueEntry['type'], { glyph: string; color: string; label: string }> = {
  add: { glyph: '+', color: '#7fc97f', label: 'added' },
  change: { glyph: '~', color: '#ffb84d', label: 'changed' },
  unlink: { glyph: '−', color: '#ff6b6b', label: 'removed' },
  'tracker-review': { glyph: '▸', color: '#c599ff', label: 'tracker → Review' },
};

function basename(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? p : p.slice(idx + 1);
}

function dirname(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? '' : p.slice(0, idx);
}

/** The first path segment — the Location value (payload, status, journal, …). */
function firstSegment(p: string): string {
  const i = p.indexOf('/');
  return i === -1 ? p : p.slice(0, i);
}

/** A display path's directory, minus its leading location segment. */
function folderRest(displayP: string): string {
  const dir = dirname(displayP);
  const i = dir.indexOf('/');
  return i === -1 ? '' : dir.slice(i + 1);
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  const ss = `${d.getSeconds()}`.padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** Change-type glyph cell — a React element so AG Grid renders it, not escaped text. */
function TypeCell(params: { value?: string }): JSX.Element | null {
  const t = params.value ? TYPE_GLYPH[params.value as QueueEntry['type']] : undefined;
  if (!t) return null;
  return (
    <span title={t.label} style={{ color: t.color, fontWeight: 700, fontSize: '0.95rem' }}>
      {t.glyph}
    </span>
  );
}

/**
 * The pane's drift queue, rendered on the same AG Grid the file grid uses:
 * sortable columns, column filters, a quick-search box, and a folder-path
 * column. Row click reveals the file, double-click opens it, and ack / ack-all
 * stay on the same callbacks the pane already wires up.
 */
export function PaneQueue({
  label,
  entries,
  onRowClick,
  onRowDoubleClick,
  onAck,
  onAckAll,
  displayPath,
}: Props): JSX.Element {
  const [quickFilter, setQuickFilter] = useState('');

  const columns = useMemo<ColDef<QueueEntry>[]>(
    () => [
      {
        headerName: '',
        colId: 'type',
        width: 56,
        valueGetter: (p: ValueGetterParams<QueueEntry>) => p.data?.type ?? '',
        cellRenderer: TypeCell,
        filter: 'agSetColumnFilter',
        cellStyle: { textAlign: 'center' },
      },
      {
        colId: 'location',
        headerName: 'Location',
        valueGetter: (p: ValueGetterParams<QueueEntry>) =>
          p.data ? firstSegment(displayPath(p.data.path)) : '',
        rowGroup: true,
        hide: true,
        filter: 'agSetColumnFilter',
      },
      {
        colId: 'name',
        headerName: 'Name',
        flex: 2,
        minWidth: 160,
        valueGetter: (p: ValueGetterParams<QueueEntry>) =>
          p.data ? (p.data.subject ? p.data.subject.title : basename(p.data.path)) : '',
        filter: 'agTextColumnFilter',
        floatingFilter: true,
      },
      {
        colId: 'folder',
        headerName: 'Folder',
        flex: 3,
        minWidth: 140,
        valueGetter: (p: ValueGetterParams<QueueEntry>) =>
          p.data ? folderRest(displayPath(p.data.path)) : '',
        filter: 'agTextColumnFilter',
        floatingFilter: true,
      },
      {
        field: 'ts',
        headerName: 'Time',
        width: 104,
        filter: 'agNumberColumnFilter',
        valueFormatter: (p: { value: number | undefined }) =>
          p.value === undefined ? '' : formatTime(p.value),
      },
      {
        headerName: '',
        colId: 'ack',
        width: 64,
        sortable: false,
        filter: false,
        resizable: false,
        cellStyle: { textAlign: 'center' },
        cellRenderer: (p: { data?: QueueEntry }) => {
          const entry = p.data;
          if (!entry) return null;
          return (
            <button
              type="button"
              style={ackBtn}
              onClick={(e) => {
                e.stopPropagation();
                onAck(entry.id);
              }}
            >
              ack
            </button>
          );
        },
      },
    ],
    [onAck, displayPath],
  );

  return (
    <section style={containerStyle} data-testid={`queue-${label.toLowerCase()}`}>
      <header style={headerStyle}>
        <span style={labelStyle}>{label} queue</span>
        <span style={countStyle}>{entries.length}</span>
        <input
          type="search"
          value={quickFilter}
          onChange={(e) => setQuickFilter(e.target.value)}
          placeholder="Search drift…"
          style={searchStyle}
          data-testid={`queue-search-${label.toLowerCase()}`}
        />
        <button
          type="button"
          onClick={onAckAll}
          disabled={entries.length === 0}
          style={{ ...ackAllBtn, ...(entries.length === 0 ? ackAllBtnDisabled : null) }}
        >
          Ack all
        </button>
      </header>
      <div style={gridWrapStyle}>
        <AgGridReact<QueueEntry>
          theme={cockpitGridTheme}
          rowData={entries}
          columnDefs={columns}
          defaultColDef={{ sortable: true, resizable: true, enableRowGroup: true }}
          getRowId={(p) => p.data.id}
          quickFilterText={quickFilter}
          rowGroupPanelShow="always"
          autoGroupColumnDef={{ headerName: 'Location', minWidth: 150, flex: 2 }}
          groupDefaultExpanded={1}
          rowSelection={{ mode: 'singleRow', checkboxes: false }}
          suppressCellFocus
          animateRows={false}
          headerHeight={28}
          rowHeight={26}
          overlayNoRowsTemplate="Drift is acked."
          onRowClicked={(e) => {
            if (e.data) onRowClick(e.data);
          }}
          onRowDoubleClicked={(e) => {
            if (e.data) onRowDoubleClick(e.data);
          }}
        />
      </div>
    </section>
  );
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  height: '100%',
  background: '#0c121a',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  padding: '0.4rem 0.7rem',
  borderBottom: '1px solid #1f2933',
  background: '#0f1620',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  fontWeight: 600,
  letterSpacing: '0.04em',
  color: '#dde3ea',
  textTransform: 'uppercase',
};

const countStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: '#9fb1bd',
  background: '#1f2933',
  padding: '0.05rem 0.35rem',
  borderRadius: '999px',
};

const searchStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  maxWidth: '14rem',
  padding: '0.2rem 0.5rem',
  background: '#0c121a',
  border: '1px solid #2f3a45',
  borderRadius: '4px',
  color: '#dde3ea',
  fontSize: '0.72rem',
};

const ackAllBtn: React.CSSProperties = {
  marginLeft: 'auto',
  padding: '0.18rem 0.55rem',
  background: '#3a78c2',
  color: '#ffffff',
  border: 'none',
  borderRadius: '4px',
  fontSize: '0.72rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const ackAllBtnDisabled: React.CSSProperties = {
  background: '#2a323a',
  color: '#7a8590',
  cursor: 'default',
};

const ackBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #2f3a45',
  color: '#aab4be',
  borderRadius: '4px',
  padding: '0.1rem 0.45rem',
  fontSize: '0.7rem',
  cursor: 'pointer',
};

const gridWrapStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
};
