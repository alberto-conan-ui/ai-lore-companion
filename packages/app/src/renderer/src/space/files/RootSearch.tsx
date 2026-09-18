import { type JSX, useCallback, useMemo, useState } from 'react';
import {
  ROOT_SEARCH_CONTENT_LIMIT,
  ROOT_SEARCH_NAME_LIMIT,
  type SpaceRootSearchResult,
} from '../../../../shared/ipc/space/root-search.types.js';
import type {
  SearchScope,
  SearchSource,
  SearchSourceGroup,
} from '../../components/SearchDialog.js';
import { SearchDialog } from '../../components/SearchDialog.js';
import type { RootSummary } from './filesTypes.js';

/** The sentence under the dialog's scopes: what is searched and the caps. */
export const ROOT_SEARCH_NOTE = `Each root is searched by file name and inside files, without .git, node_modules, build output and what its .gitignore files leave out. Each root shows at most ${ROOT_SEARCH_NAME_LIMIT} file names and ${ROOT_SEARCH_CONTENT_LIMIT} lines found inside files.`;

/** The sentences shown under a root's heading for one result, or `null` when the result is to be dropped. */
export function rootSearchNotices(result: SpaceRootSearchResult): string[] | null {
  if (!result.ok) return [`This root was not searched: ${result.error.message}`];
  const group = result.value;
  if (group.outcome === 'cancelled') return null;
  const notices: string[] = [];
  if (group.outcome === 'timed-out') {
    notices.push(
      `The search of this root stopped after ${Math.round(group.timeLimitMs / 1000)} seconds; the results shown are those found by then.`,
    );
  }
  if (group.names.truncated) {
    notices.push(
      `More than ${group.names.limit} file names match; the ${group.names.limit} best are shown.`,
    );
  }
  if (group.content.truncated) {
    notices.push(
      `More than ${group.content.limit} lines inside files match; the first ${group.content.limit} are shown.`,
    );
  }
  if (group.indexTruncated) {
    notices.push(
      `This root holds more than ${group.indexLimit} files; the file names beyond them are not searched.`,
    );
  }
  return notices;
}

/** A root's result as the search dialog's group, or `null` when it is to be dropped. */
export function rootSearchGroup(
  rootId: string,
  result: SpaceRootSearchResult,
): SearchSourceGroup | null {
  const notices = rootSearchNotices(result);
  if (notices === null) return null;
  if (!result.ok) {
    return { scopeId: rootId, names: [], content: [], ripgrepMissing: false, notices };
  }
  return {
    scopeId: rootId,
    names: result.value.names.hits,
    content: result.value.content.hits,
    ripgrepMissing: result.value.ripgrepMissing,
    notices,
  };
}

/**
 * The search dialog's source for the roots of a Space: one `spaceRootSearch`
 * per checked root, all at once, each root's results given as they arrive.
 * Stopping it drops the results still to come and asks main to stop the
 * window's running searches.
 */
export const rootSearchSource: SearchSource = (query, scopeIds, onGroup) => {
  let stopped = false;
  let pending = scopeIds.length;
  for (const rootId of scopeIds) {
    void window.cockpit
      .spaceRootSearch({ rootId, query })
      .catch(
        (caught: unknown): SpaceRootSearchResult => ({
          ok: false,
          error: {
            kind: 'roots-unavailable',
            message: caught instanceof Error ? caught.message : String(caught),
          },
        }),
      )
      .then((result) => {
        pending -= 1;
        if (stopped) return;
        const group = rootSearchGroup(rootId, result);
        if (group !== null) onGroup(group);
      });
  }
  return () => {
    if (stopped) return;
    stopped = true;
    if (pending > 0) void window.cockpit.spaceRootSearchCancel().catch(() => undefined);
  };
};

type Props = {
  /** The roots, in the order of the Files window's tabs. */
  roots: RootSummary[];
  /** Open a result: select its root's tab and open the file in the editor. */
  onOpenResult: (rootId: string, path: string) => void;
  /**
   * Whether the dialog is open, when the host decides it (the Files window
   * opens it on the find shortcut). Without it the component keeps its own.
   */
  open?: boolean;
  /** Told when the button opens the dialog or the dialog closes, with `open`. */
  onOpenChange?: (open: boolean) => void;
};

/**
 * Search in the Files window (phase M5.6): a "Search" button that opens the
 * v0.8 search dialog over every root of the Space, results grouped by root in
 * the order of the tabs, each with its path relative to its root. A root whose
 * folder is not known is not offered.
 */
export function RootSearch({
  roots,
  onOpenResult,
  open: openProp,
  onOpenChange,
}: Props): JSX.Element {
  const [openOwn, setOpenOwn] = useState(false);
  const open = openProp ?? openOwn;
  const setOpen = useCallback(
    (next: boolean): void => {
      setOpenOwn(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const scopes = useMemo<SearchScope[]>(
    () =>
      roots
        .filter((summary) => summary.root.path !== '')
        .map((summary) => ({ id: summary.root.id, label: summary.root.name, dirs: [] })),
    [roots],
  );
  const close = useCallback(() => setOpen(false), [setOpen]);
  const pick = useCallback(
    (path: string, scopeId?: string): void => {
      if (scopeId !== undefined) onOpenResult(scopeId, path);
    },
    [onOpenResult],
  );

  return (
    <>
      <button
        type="button"
        style={buttonStyle}
        onClick={() => setOpen(true)}
        disabled={scopes.length === 0}
        data-testid="files-search-open"
      >
        Search
      </button>
      {open && scopes.length > 0 ? (
        <SearchDialog
          scopes={scopes}
          source={rootSearchSource}
          label="Search the roots of the Space"
          note={ROOT_SEARCH_NOTE}
          displayPath={(path) => path}
          onPick={pick}
          onClose={close}
        />
      ) : null}
    </>
  );
}

const buttonStyle: React.CSSProperties = {
  padding: '0.2rem 0.7rem',
  fontSize: '0.8rem',
  color: 'var(--color-text)',
  background: 'var(--color-panel)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '4px',
  cursor: 'pointer',
};
