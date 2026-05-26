import type { AppEntry, ChangeEntry, TreeNode } from '@ai-lore-companion/core';
import type {
  CellKeyDownEvent,
  ColDef,
  GetContextMenuItemsParams,
  MenuItemDef,
  ValueGetterParams,
} from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import {
  type JSX,
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CommitListEntry } from '../../../shared/ipc.js';
import { type DriftKind, categoriseDriftCode } from '../store.js';
// Importing the theme also evaluates FileGrid.tsx, which registers the AG Grid
// modules and license — so this grid has them without repeating the setup.
import { cockpitGridTheme } from './FileGrid.js';
import { buildNodeContextMenu } from './nodeContextMenu.js';

/** Imperative handle the Pane uses to move keyboard focus into the panel. */
export type ChangesPanelHandle = {
  focusMe: () => void;
};

/**
 * One row of the Changes list. Wraps a `ChangeEntry` with the absolute
 * working-tree path the menu actions need.
 */
export type DriftRow = ChangeEntry & {
  /** Path relative to the project root — the form `displayPath` consumes. */
  projectRelPath: string;
  /** Absolute path — the form context-menu callbacks (revealInFinder, diff, openWith) consume. */
  absPath: string;
};

type Props = {
  label: string;
  entries: DriftRow[];
  /** Current baseline (commit SHA or `'HEAD'`). Drives the dropdown selection. */
  baseline: string;
  /** Recent commits + save-point badges for the dropdown. Newest first. */
  commitList: CommitListEntry[];
  /** Called when the user picks a new baseline from the dropdown. */
  onBaselineChange: (baseline: string) => void;
  onRowClick: (entry: DriftRow) => void;
  onRowDoubleClick: (entry: DriftRow) => void;
  /** Maps a project-relative path to its tab-relative display path. */
  displayPath: (relPath: string) => string;
  /** The Apps catalog — drives the *Open with* menu entries. */
  apps: AppEntry[];
  /** Whether a save-point is recorded — drives the Diff menu item's enabled state. */
  hasSavePoint: boolean;
  onOpenWith: (app: AppEntry, node: TreeNode) => void;
  onRevealInFinder: (node: TreeNode) => void;
  onDiff: (node: TreeNode) => void;
  onIgnore: (node: TreeNode) => void;
};

const KIND_GLYPH: Record<DriftKind, { glyph: string; color: string; label: string }> = {
  add: { glyph: '+', color: '#7fc97f', label: 'added' },
  change: { glyph: '~', color: '#ffb84d', label: 'changed' },
  unlink: { glyph: '−', color: '#ff6b6b', label: 'removed' },
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
  return i === -1 ? '/' : dir.slice(i + 1);
}

/** Short SHA for the dropdown — first 7 chars, the git convention. */
function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** The dropdown label for one commit. Save-points lead with their title; plain
 *  commits show short SHA + subject. */
function commitOptionLabel(c: CommitListEntry): string {
  return c.savePoint
    ? `★ ${c.savePoint.title} — ${shortSha(c.sha)}`
    : `${shortSha(c.sha)} ${c.subject}`;
}

/** Cell renderer for the per-row kind glyph. */
function KindCell(params: { value?: string }): JSX.Element | null {
  if (!params.value) return null;
  const kind = categoriseDriftCode(params.value);
  const meta = KIND_GLYPH[kind];
  return (
    <span title={meta.label} style={{ color: meta.color, fontWeight: 700, fontSize: '0.95rem' }}>
      {meta.glyph}
    </span>
  );
}

function nodeForRow(row: DriftRow): TreeNode {
  return { name: basename(row.projectRelPath), path: row.absPath, isDir: false };
}

/**
 * The pane's *Changes* surface — a baseline-aware view of what differs
 * between the working tree and a commit the user picks. Replaces the v0.6
 * Phase B v1 `PaneQueue` (which was hard-coded to HEAD). The baseline
 * dropdown carries recent commits plus save-point badges; the inline diff
 * preview (Phase B task 5) sits below this surface.
 */
export const ChangesPanel = forwardRef<ChangesPanelHandle, Props>(function ChangesPanel(
  {
    label,
    entries,
    baseline,
    commitList,
    onBaselineChange,
    onRowClick,
    onRowDoubleClick,
    displayPath,
    apps,
    hasSavePoint,
    onOpenWith,
    onRevealInFinder,
    onDiff,
    onIgnore,
  }: Props,
  forwardedRef,
): JSX.Element {
  const [quickFilter, setQuickFilter] = useState('');
  const gridRef = useRef<AgGridReact<DriftRow>>(null);

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

  // Keyboard activation parity with mouse: `Enter` reveals (single-click),
  // `⌘+Enter` opens (double-click).
  const onCellKeyDown = useCallback(
    (e: CellKeyDownEvent<DriftRow>) => {
      const keyEvent = e.event as KeyboardEvent;
      if (!e.data) return;
      if (keyEvent.key === 'Enter') {
        keyEvent.preventDefault();
        if (keyEvent.metaKey) onRowDoubleClick(e.data);
        else onRowClick(e.data);
      }
    },
    [onRowClick, onRowDoubleClick],
  );

  const columns = useMemo<ColDef<DriftRow>[]>(
    () => [
      {
        headerName: '',
        colId: 'code',
        width: 56,
        valueGetter: (p: ValueGetterParams<DriftRow>) => p.data?.code ?? '',
        cellRenderer: KindCell,
        filter: 'agSetColumnFilter',
        cellStyle: { textAlign: 'center' },
      },
      {
        colId: 'location',
        headerName: 'Location',
        width: 140,
        valueGetter: (p: ValueGetterParams<DriftRow>) =>
          p.data ? firstSegment(displayPath(p.data.projectRelPath)) : '',
        rowGroup: true,
        filter: 'agSetColumnFilter',
      },
      {
        colId: 'name',
        headerName: 'Name',
        flex: 2,
        minWidth: 160,
        valueGetter: (p: ValueGetterParams<DriftRow>) =>
          p.data ? basename(p.data.projectRelPath) : '',
        filter: 'agTextColumnFilter',
        floatingFilter: true,
      },
      {
        colId: 'folder',
        headerName: 'Folder',
        flex: 3,
        minWidth: 140,
        valueGetter: (p: ValueGetterParams<DriftRow>) =>
          p.data ? folderRest(displayPath(p.data.projectRelPath)) : '',
        filter: 'agTextColumnFilter',
        floatingFilter: true,
      },
    ],
    [displayPath],
  );

  // `HEAD` is always the first option; recent commits follow with save-point
  // badges where they apply. The selected value is the SHA (or `'HEAD'`).
  const dropdownOptions = useMemo(
    () => [
      { value: 'HEAD', label: 'HEAD (working tree drift)' },
      ...commitList.map((c) => ({ value: c.sha, label: commitOptionLabel(c) })),
    ],
    [commitList],
  );

  return (
    <section style={containerStyle} data-testid={`changes-${label.toLowerCase()}`}>
      <header style={headerStyle}>
        <span style={labelStyle}>{label} changes</span>
        <span style={countStyle}>{entries.length}</span>
        <select
          value={baseline}
          onChange={(e) => onBaselineChange(e.target.value)}
          style={baselineSelectStyle}
          data-testid={`changes-baseline-${label.toLowerCase()}`}
          aria-label="Compare against"
        >
          {dropdownOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          type="search"
          value={quickFilter}
          onChange={(e) => setQuickFilter(e.target.value)}
          placeholder="Search changes…"
          style={searchStyle}
          data-testid={`changes-search-${label.toLowerCase()}`}
        />
      </header>
      <div style={gridWrapStyle}>
        <AgGridReact<DriftRow>
          ref={gridRef}
          theme={cockpitGridTheme}
          rowData={entries}
          columnDefs={columns}
          defaultColDef={{ sortable: true, resizable: true, enableRowGroup: true }}
          getRowId={(p) => p.data.projectRelPath}
          quickFilterText={quickFilter}
          rowGroupPanelShow="always"
          groupDisplayType="groupRows"
          groupDefaultExpanded={1}
          rowSelection={{ mode: 'singleRow', checkboxes: false }}
          animateRows={false}
          headerHeight={28}
          rowHeight={26}
          overlayNoRowsTemplate="No changes."
          getContextMenuItems={(
            params: GetContextMenuItemsParams<DriftRow>,
          ): (MenuItemDef | string)[] => {
            const row = params.node?.data;
            if (!row) return [];
            return buildNodeContextMenu({
              node: nodeForRow(row),
              apps,
              hasSavePoint,
              onRevealInFinder,
              onOpenWith,
              onDiff,
              onIgnore,
            });
          }}
          onRowClicked={(e) => {
            if (e.data) onRowClick(e.data);
          }}
          onRowDoubleClicked={(e) => {
            if (e.data) onRowDoubleClick(e.data);
          }}
          onCellKeyDown={onCellKeyDown}
        />
      </div>
    </section>
  );
});

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

const baselineSelectStyle: React.CSSProperties = {
  flex: 'none',
  maxWidth: '20rem',
  padding: '0.2rem 0.4rem',
  background: '#0c121a',
  border: '1px solid #2f3a45',
  borderRadius: '4px',
  color: '#dde3ea',
  fontSize: '0.72rem',
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

const gridWrapStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
};
