import type { AppEntry, ChangeScope, TreeNode } from '@ai-lore-companion/core';
import {
  type CellKeyDownEvent,
  type ColDef,
  type GetContextMenuItemsParams,
  type MenuItemDef,
  ModuleRegistry,
  type ValueGetterParams,
  colorSchemeDark,
  themeQuartz,
} from 'ag-grid-community';
import { AllEnterpriseModule, LicenseManager } from 'ag-grid-enterprise';
import { AgGridReact } from 'ag-grid-react';
import {
  type JSX,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { type DriftKind, categoriseDriftCode } from '../store.js';
import type { DriftRow } from './ChangesPanel.js';
import { buildNodeContextMenu } from './nodeContextMenu.js';
import { RowKebab } from './RowKebab.js';

/** Imperative handle the Pane uses to move keyboard focus into the grid. */
export type FileGridHandle = {
  /** Focus the grid; AG-Grid restores the last focused cell, or focuses the
   *  first row's `name` cell on first entry. */
  focusMe: () => void;
};

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
  driftByPath: Map<string, DriftRow>;
  /** Right-click ▸ Ignore — create a project ignore rule for the row's path. */
  onIgnore: (node: TreeNode) => void;
  /**
   * Right-click ▸ Diff against latest save-point — opens the configured
   * external diff app. Disabled in the menu when no save-point exists.
   */
  onDiff: (node: TreeNode) => void;
  /** Whether a save-point is recorded — drives the Diff menu item's enabled state. */
  hasSavePoint: boolean;
  /** The Apps catalog — drives the *Open with [label]* menu entries. */
  apps: AppEntry[];
  /** Invoke a catalog app on a node. */
  onOpenWith: (app: AppEntry, node: TreeNode) => void;
  /** Reveal a node in Finder (folder = open, file = highlight). */
  onRevealInFinder: (node: TreeNode) => void;
};

const DRIFT_GLYPH: Record<DriftKind, { glyph: string; color: string; label: string }> = {
  add: { glyph: '+', color: '#7fc97f', label: 'added' },
  change: { glyph: '~', color: '#ffb84d', label: 'changed' },
  unlink: { glyph: '−', color: '#ff6b6b', label: 'removed' },
};

/**
 * Drift glyph cell — a React element, not an HTML string. AG Grid v33+ renders
 * a string returned from `cellRenderer` as escaped text, so an HTML string
 * shows up literally as `<span…>`. The value is the raw porcelain code; we
 * categorise it into add/change/unlink for the glyph.
 */
function DriftCell(params: { value?: string }): JSX.Element | null {
  if (!params.value) return null;
  const meta = DRIFT_GLYPH[categoriseDriftCode(params.value)];
  return (
    <span title={meta.label} style={{ color: meta.color, fontWeight: 700, fontSize: '0.95rem' }}>
      {meta.glyph}
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

export const FileGrid = forwardRef<FileGridHandle, Props>(function FileGrid(
  {
    scope,
    rows,
    selectedPath,
    onSelectPath,
    onOpenFolder,
    driftByPath,
    onIgnore,
    onDiff,
    hasSavePoint,
    apps,
    onOpenWith,
    onRevealInFinder,
  }: Props,
  forwardedRef,
): JSX.Element {
  const gridRef = useRef<AgGridReact<TreeNode>>(null);

  // Move keyboard focus into the grid. AG-Grid restores its last focused
  // cell if it had one; otherwise we land on the first row's `name`.
  useImperativeHandle(forwardedRef, () => ({
    focusMe: () => {
      const api = gridRef.current?.api;
      if (!api) return;
      const focused = api.getFocusedCell();
      if (focused) {
        api.setFocusedCell(focused.rowIndex, focused.column.getColId());
      } else if (api.getDisplayedRowCount() > 0) {
        api.setFocusedCell(0, 'name');
      }
    },
  }));

  const columns = useMemo<ColDef<TreeNode>[]>(
    () => [
      {
        headerName: '',
        colId: 'drift',
        width: 64,
        valueGetter: (p: ValueGetterParams<TreeNode>) =>
          p.data ? (driftByPath.get(p.data.path)?.code ?? '') : '',
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
      {
        // Kebab affordance — opens the same context menu the right-click does.
        // Pinned right so it stays visible regardless of grid width — without
        // this, AG-Grid's column virtualisation drops the column DOM when the
        // grid is narrower than the sum of its column widths (e.g. when the
        // leftRail is at its default 400px width and the grid only gets
        // ~150px after the tree column).
        colId: 'kebab',
        headerName: '',
        width: 36,
        pinned: 'right',
        sortable: false,
        filter: false,
        suppressMovable: true,
        suppressColumnsToolPanel: true,
        cellStyle: { padding: 0, textAlign: 'center' },
        cellRenderer: (params: {
          data?: TreeNode;
          node: { group?: boolean };
          api: { showContextMenu: (p: { rowNode: unknown; value: unknown; x: number; y: number }) => void };
        }): JSX.Element | null => {
          if (!params.data || params.node.group) return null;
          const row = params.data;
          const node = params.node;
          return (
            <RowKebab
              testId={`row-kebab-grid-${row.path}`}
              onActivate={(e) => {
                const ev = e as React.MouseEvent<HTMLButtonElement>;
                params.api.showContextMenu({
                  rowNode: node,
                  value: row,
                  x: ev.clientX,
                  y: ev.clientY,
                });
              }}
            />
          );
        },
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

  // Type-ahead buffer: printable keys accumulate and jump the row focus to
  // the first row whose `name` starts with the buffer (case-insensitive).
  // Idle for ~750ms resets the buffer; the user can keep typing to extend.
  const typeBuf = useRef('');
  const typeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typeAhead = useCallback((char: string) => {
    typeBuf.current = `${typeBuf.current}${char.toLowerCase()}`;
    if (typeTimer.current) clearTimeout(typeTimer.current);
    typeTimer.current = setTimeout(() => {
      typeBuf.current = '';
    }, 750);

    const api = gridRef.current?.api;
    if (!api) return;
    const buf = typeBuf.current;
    let foundIdx: number | null = null;
    api.forEachNodeAfterFilterAndSort((node, idx) => {
      if (foundIdx !== null) return;
      const name = node.data?.name?.toLowerCase() ?? '';
      if (name.startsWith(buf)) foundIdx = idx;
    });
    if (foundIdx !== null) {
      api.ensureIndexVisible(foundIdx, 'middle');
      api.setFocusedCell(foundIdx, 'name');
    }
  }, []);

  const onCellKeyDown = useCallback(
    (e: CellKeyDownEvent<TreeNode>) => {
      const keyEvent = e.event as KeyboardEvent;
      if (keyEvent.key === 'Enter' && e.data) {
        keyEvent.preventDefault();
        if (e.data.isDir) onOpenFolder(e.data.path);
        else void window.cockpit.openPath(e.data.path);
        return;
      }
      if (keyEvent.key === 'Escape') {
        typeBuf.current = '';
        if (typeTimer.current) clearTimeout(typeTimer.current);
        return;
      }
      // Printable single character — no modifiers — feeds the type-ahead buffer.
      if (keyEvent.key.length === 1 && !keyEvent.metaKey && !keyEvent.ctrlKey && !keyEvent.altKey) {
        typeAhead(keyEvent.key);
      }
    },
    [onOpenFolder, typeAhead],
  );

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
        animateRows={false}
        getContextMenuItems={(
          params: GetContextMenuItemsParams<TreeNode>,
        ): (MenuItemDef | string)[] => {
          const node = params.node?.data;
          if (!node) return [];
          return buildNodeContextMenu({
            node,
            apps,
            hasSavePoint,
            onRevealInFinder,
            onOpenWith,
            onDiff,
            onIgnore,
          });
        }}
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
        onCellKeyDown={onCellKeyDown}
      />
    </div>
  );
});

const containerStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: '100%',
};
