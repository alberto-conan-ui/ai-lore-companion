/**
 * The pure part of the Changes panel of a root (phase M5.3): the kind of each
 * change, whether it is committed, the index-files rule, the filter and the
 * rows of the list. The change codes are read with the v0.8 `categoriseDriftCode`,
 * so the panel and the tree above it name a change the same way; a rename is
 * told apart here because the v0.8 grouping folds it into `change`.
 */

import type { ChangeEntry } from '@ai-lore-companion/core';
import type { RootChanges } from '../../../../shared/ipc/space/roots.types.js';
import { categoriseDriftCode } from '../../store.js';

/** The kind of a change, as its label reads. */
export type RootChangeKind = 'added' | 'changed' | 'deleted' | 'renamed';

/** Whether a change is in a commit made since the baseline, or only in the working tree. */
export type RootChangeState = 'committed' | 'uncommitted';

/** One change as the list shows it. */
export type RootChangeRow = {
  code: string;
  path: string;
  oldPath?: string;
  kind: RootChangeKind;
  state: RootChangeState;
};

/** The groups of the list, in the order they are shown. */
export const ROOT_CHANGE_STATES: readonly RootChangeState[] = ['committed', 'uncommitted'];

/** A line of the list: a group's heading or a change. */
export type RootChangesLine =
  | { type: 'group'; state: RootChangeState; count: number }
  | { type: 'change'; row: RootChangeRow; index: number };

/** The kind of a change from its two-character code. */
export function changeKindOf(entry: ChangeEntry): RootChangeKind {
  if (entry.oldPath !== undefined && /R/.test(entry.code)) return 'renamed';
  const drift = categoriseDriftCode(entry.code);
  if (drift === 'add') return 'added';
  if (drift === 'unlink') return 'deleted';
  return 'changed';
}

/**
 * Whether a path is an AI-Lore index file: a file named `index.md` (the 1.0
 * Lore's `lore/index.md`) or `<name>.index.md` (the v0.8 status and memory
 * indexes). The comparison is on the file's name only.
 */
export function isIndexFile(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name === 'index.md' || name.endsWith('.index.md');
}

/**
 * The changes of a root as rows, sorted by path. A change is `uncommitted`
 * when its path is in `changes.uncommitted`. A snapshot read before that field
 * existed counts every change as uncommitted when the baseline is the present
 * commit, and only untracked files otherwise.
 */
export function rowsOf(changes: RootChanges): RootChangeRow[] {
  const atHead = changes.baselineCommit === changes.head;
  const named = (changes as { uncommitted?: string[] }).uncommitted;
  const uncommitted = named === undefined ? null : new Set(named);
  const rows = changes.entries.map((entry): RootChangeRow => {
    const notCommitted =
      uncommitted === null ? atHead || entry.code === '??' : uncommitted.has(entry.path);
    const row: RootChangeRow = {
      code: entry.code,
      path: entry.path,
      kind: changeKindOf(entry),
      state: notCommitted ? 'uncommitted' : 'committed',
    };
    if (entry.oldPath !== undefined) row.oldPath = entry.oldPath;
    return row;
  });
  rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return rows;
}

/** What the filter and the switch leave, and what they hid. */
export type FilteredRows = {
  rows: RootChangeRow[];
  /** Index files left out because the switch is off. */
  hiddenIndexFiles: number;
};

/** Apply the index-files switch and the text filter (case-insensitive, on the path and the old path). */
export function filterRows(
  rows: readonly RootChangeRow[],
  filter: string,
  showIndexFiles: boolean,
): FilteredRows {
  const query = filter.trim().toLowerCase();
  let hiddenIndexFiles = 0;
  const out: RootChangeRow[] = [];
  for (const row of rows) {
    if (!showIndexFiles && isIndexFile(row.path)) {
      hiddenIndexFiles += 1;
      continue;
    }
    if (
      query !== '' &&
      !row.path.toLowerCase().includes(query) &&
      !(row.oldPath ?? '').toLowerCase().includes(query)
    ) {
      continue;
    }
    out.push(row);
  }
  return { rows: out, hiddenIndexFiles };
}

/** The lines of the list: each group that has changes, its heading, then its changes. */
export function linesOf(rows: readonly RootChangeRow[]): RootChangesLine[] {
  const lines: RootChangesLine[] = [];
  let index = 0;
  for (const state of ROOT_CHANGE_STATES) {
    const inGroup = rows.filter((row) => row.state === state);
    if (inGroup.length === 0) continue;
    lines.push({ type: 'group', state, count: inGroup.length });
    for (const row of inGroup) {
      lines.push({ type: 'change', row, index });
      index += 1;
    }
  }
  return lines;
}

/** How many changes, as the count reads. */
export function countText(n: number): string {
  return n === 1 ? '1 change' : `${n} changes`;
}
