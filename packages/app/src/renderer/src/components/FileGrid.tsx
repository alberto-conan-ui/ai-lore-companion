import type { ChangeScope, QueueEntry, TreeNode } from '@ai-lore-companion/core';
import {
  type ColDef,
  ModuleRegistry,
  type ValueGetterParams,
  colorSchemeDark,
  themeQuartz,
} from 'ag-grid-community';
import { AllEnterpriseModule, LicenseManager } from 'ag-grid-enterprise';
import { AgGridReact } from 'ag-grid-react';
import { type JSX, useEffect, useMemo, useRef } from 'react';

ModuleRegistry.registerModules([AllEnterpriseModule]);

const LICENSE_KEY = import.meta.env.VITE_AG_GRID_LICENSE_KEY;
if (LICENSE_KEY) LicenseManager.setLicenseKey(LICENSE_KEY);

/**
 * AG Grid v35 ignores the legacy `ag-theme-quartz-dark` CSS class unless the
 * grid opts into legacy mode — the Theming API is the default. So the theme is
 * built here: Quartz + the dark colour scheme, tuned to sit on the cockpit's
 * `#0a0f17` chrome instead of the generic dark grey.
 */
export const cockpitGridTheme = themeQuartz.withPart(colorSchemeDark).withParams({
  backgroundColor: '#0a0f17',
  chromeBackgroundColor: '#121a24',
  headerBackgroundColor: '#0f1620',
  headerTextColor: '#e6edf3',
  foregroundColor: '#dde3ea',
  borderColor: '#1f2933',
  accentColor: '#5a9bd4',
});

type Props = {
  scope: ChangeScope;
  rows: TreeNode[];
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
  /** Double-clicking a folder row navigates the pane into that folder. */
  onOpenFolder: (path: string) => void;
  driftByPath: Map<string, QueueEntry>;
};

const DRIFT_GLYPH: Record<QueueEntry['type'], { glyph: string; color: string; label: string }> = {
  add: { glyph: '+', color: '#7fc97f', label: 'added' },
  change: { glyph: '~', color: '#ffb84d', label: 'changed' },
  unlink: { glyph: '−', color: '#ff6b6b', label: 'removed' },
  'tracker-review': { glyph: '▸', color: '#c599ff', label: 'tracker → Review' },
};

/**
 * Drift glyph cell — a React element, not an HTML string. AG Grid v33+ renders
 * a string returned from `cellRenderer` as escaped text, so an HTML string
 * shows up literally as `<span…>`.
 */
function DriftCell(params: { value?: string }): JSX.Element | null {
  const t = params.value ? DRIFT_GLYPH[params.value as QueueEntry['type']] : undefined;
  if (!t) return null;
  return (
    <span title={t.label} style={{ color: t.color, fontWeight: 700, fontSize: '0.95rem' }}>
      {t.glyph}
    </span>
  );
}

function extOf(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(idx + 1) : '';
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatModified(ts: number | undefined): string {
  if (ts === undefined) return '';
  const diffMs = Date.now() - ts;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

export function FileGrid({
  scope,
  rows,
  selectedPath,
  onSelectPath,
  onOpenFolder,
  driftByPath,
}: Props): JSX.Element {
  const gridRef = useRef<AgGridReact<TreeNode>>(null);

  const columns = useMemo<ColDef<TreeNode>[]>(
    () => [
      {
        headerName: '',
        colId: 'drift',
        width: 64,
        valueGetter: (p: ValueGetterParams<TreeNode>) =>
          p.data ? (driftByPath.get(p.data.path)?.type ?? '') : '',
        cellRenderer: DriftCell,
        filter: 'agSetColumnFilter',
        cellStyle: { textAlign: 'center' },
      },
      {
        field: 'name',
        headerName: 'Name',
        flex: 2,
        minWidth: 200,
        filter: 'agTextColumnFilter',
        floatingFilter: true,
        cellRenderer: (params: { value: string; data: TreeNode }) => {
          const glyph = params.data.isDir ? '📁' : '📄';
          return `${glyph}  ${params.value}`;
        },
      },
      {
        colId: 'type',
        headerName: 'Type',
        width: 100,
        valueGetter: (p: ValueGetterParams<TreeNode>) => (p.data ? extOf(p.data.name) : ''),
        filter: 'agSetColumnFilter',
        floatingFilter: true,
      },
      {
        field: 'size',
        headerName: 'Size',
        width: 110,
        filter: 'agNumberColumnFilter',
        valueFormatter: (p: { value: number | undefined }) => formatBytes(p.value),
        type: 'numericColumn',
      },
      {
        field: 'mtimeMs',
        headerName: 'Modified',
        width: 130,
        filter: 'agNumberColumnFilter',
        valueFormatter: (p: { value: number | undefined }) => formatModified(p.value),
      },
    ],
    [driftByPath],
  );

  useEffect(() => {
    const api = gridRef.current?.api;
    if (!api || !selectedPath) return;
    const rowNode = api.getRowNode(selectedPath);
    if (rowNode) {
      api.ensureNodeVisible(rowNode, 'middle');
      api.deselectAll();
      rowNode.setSelected(true);
    }
  }, [selectedPath]);

  return (
    <div style={containerStyle} data-testid={`grid-${scope}`}>
      <AgGridReact<TreeNode>
        ref={gridRef}
        theme={cockpitGridTheme}
        rowData={rows}
        columnDefs={columns}
        defaultColDef={{ sortable: true, resizable: true }}
        getRowId={(params) => params.data.path}
        rowSelection={{ mode: 'singleRow', checkboxes: false }}
        suppressCellFocus
        animateRows={false}
        headerHeight={28}
        rowHeight={26}
        onRowClicked={(e) => {
          if (e.data) onSelectPath(e.data.path);
        }}
        onRowDoubleClicked={(e) => {
          if (!e.data) return;
          // A folder navigates the pane into it; a file opens in the OS app.
          if (e.data.isDir) onOpenFolder(e.data.path);
          else void window.cockpit.openPath(e.data.path);
        }}
      />
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: '100%',
};
