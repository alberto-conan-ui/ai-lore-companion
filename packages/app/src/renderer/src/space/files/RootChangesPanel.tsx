import { type JSX, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { RootMarkedReviewed, RootSnapshot } from '../../../../shared/ipc/space/roots.types.js';
import { RootChangesList } from './RootChangesList.js';
import type { FilesOpenFile, TrackedRootSummary } from './filesTypes.js';
import { type RootChangeRow, countText, filterRows, linesOf, rowsOf } from './rootChangesModel.js';

export type RootChangesPanelProps = {
  /** The selected root. Always a root tracked by git: the layout says itself why an untracked root has no changes list. */
  summary: TrackedRootSummary;
  /** Whether this instance may write the desk's records; with false, Mark as reviewed is refused. */
  deskWritable: boolean;
  /** Why the desk is not writable, or `null`. The layout already shows it above the tabs. */
  deskNotice: string | null;
  /** Reveal a file of this root in the tree above (single click on a change). */
  onRevealFile: (path: string) => void;
  /** Open a file of this root in the editor (double click on a change opens it in `diff`). */
  onOpenFile: FilesOpenFile;
  /** Read the list of roots again, after an action that changes more than the snapshot (a mark). */
  reloadRoots: () => void;
};

/** What Mark as reviewed does, shown beside the button. */
export const MARK_REVIEWED_SENTENCE =
  "Mark as reviewed records the root's current commit as the reviewed mark. Committed changes then clear; files changed and not committed stay listed.";
/** Why Mark as reviewed is disabled when the desk is not writable and main gave no notice. */
export const MARK_REVIEWED_DESK_REASON =
  "This instance of the companion cannot write the desk's records, so it cannot record a mark.";
/** Why Mark as reviewed is disabled in a repository with no commit. */
export const MARK_REVIEWED_NO_COMMITS_REASON =
  'The repository has no commit, so there is nothing committed to mark.';
/** Why Mark as reviewed is disabled when the present commit is already the mark. */
export const MARK_REVIEWED_ALREADY_REASON =
  "The root's current commit is already the reviewed mark, so there is nothing committed to mark.";

type MarkState =
  | { status: 'idle' }
  | { status: 'marking' }
  | { status: 'marked'; result: RootMarkedReviewed; over: RootSnapshot }
  | { status: 'failed'; message: string };

/**
 * The Changes panel of the selected root (phase M5.3): the changes against the
 * root's baseline, under `committed` (in commits made since the baseline) and
 * `uncommitted` (only in the working tree), with a count, a text filter, the
 * index-files switch and Mark as reviewed. A click on a change reveals it in
 * the tree; a double click or Enter opens its diff; "Open code" opens the file.
 * The snapshot in `summary` is kept current by the layout from `onSpaceRootChanges`.
 */
export function RootChangesPanel({
  summary,
  deskWritable,
  deskNotice,
  onRevealFile,
  onOpenFile,
  reloadRoots,
}: RootChangesPanelProps): JSX.Element {
  const rootId = summary.root.id;
  const [filter, setFilter] = useState('');
  const [showIndexFiles, setShowIndexFiles] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [mark, setMark] = useState<MarkState>({ status: 'idle' });
  const reasonId = useId();

  // Another root: forget the selection and the last mark's result.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the root changes.
  useEffect(() => {
    setSelectedPath(null);
    setMark({ status: 'idle' });
  }, [rootId]);

  // The mark's snapshot is shown until the layout's snapshot moves on from the one it replaced.
  const snapshot =
    mark.status === 'marked' && mark.over === summary.snapshot && mark.result.rootId === rootId
      ? mark.result.snapshot
      : summary.snapshot;
  const changes = snapshot.status === 'ok' ? snapshot.changes : null;

  const allRows = useMemo(() => (changes ? rowsOf(changes) : []), [changes]);
  const { rows, hiddenIndexFiles } = useMemo(
    () => filterRows(allRows, filter, showIndexFiles),
    [allRows, filter, showIndexFiles],
  );
  const lines = useMemo(() => linesOf(rows), [rows]);
  const selected = rows.find((row) => row.path === selectedPath) ?? null;

  const markedCommit =
    mark.status === 'marked' && mark.result.rootId === rootId
      ? mark.result.mark.commit
      : summary.defaultBaseline?.source === 'reviewed-mark'
        ? summary.defaultBaseline.baseline
        : null;
  const disabledReason = !deskWritable
    ? (deskNotice ?? MARK_REVIEWED_DESK_REASON)
    : changes !== null && changes.head === null
      ? MARK_REVIEWED_NO_COMMITS_REASON
      : changes !== null && markedCommit !== null && changes.head === markedCommit
        ? MARK_REVIEWED_ALREADY_REASON
        : null;
  const marking = mark.status === 'marking';

  // A second click that arrives before the button re-renders disabled must not mark twice.
  const markInFlight = useRef(false);
  const onMark = useCallback(async (): Promise<void> => {
    if (markInFlight.current) return;
    markInFlight.current = true;
    const over = summary.snapshot;
    setMark({ status: 'marking' });
    let result: Awaited<ReturnType<typeof window.cockpit.spaceRootMarkReviewed>>;
    try {
      result = await window.cockpit.spaceRootMarkReviewed({ rootId });
    } catch (caught) {
      setMark({ status: 'failed', message: String(caught) });
      return;
    } finally {
      markInFlight.current = false;
    }
    if (!result.ok) {
      setMark({ status: 'failed', message: result.error.message });
      return;
    }
    setMark({ status: 'marked', result: result.value, over });
    reloadRoots();
  }, [rootId, summary.snapshot, reloadRoots]);

  const reveal = useCallback(
    (row: RootChangeRow) => {
      setSelectedPath(row.path);
      onRevealFile(row.path);
    },
    [onRevealFile],
  );
  const openDiff = useCallback(
    (row: RootChangeRow) => {
      setSelectedPath(row.path);
      onOpenFile(
        row.oldPath === undefined
          ? { path: row.path, mode: 'diff' }
          : { path: row.path, mode: 'diff', oldPath: row.oldPath },
      );
    },
    [onOpenFile],
  );
  const select = useCallback((row: RootChangeRow) => setSelectedPath(row.path), []);

  const total = changes?.total ?? 0;

  return (
    <section style={containerStyle} aria-label="Changes" data-testid="root-changes-panel">
      <header style={headerStyle}>
        <span style={labelStyle}>Changes</span>
        <output style={countStyle} data-testid="root-changes-count">
          {changes === null ? '' : countText(rows.length)}
        </output>
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter changes"
          aria-label="Filter changes"
          style={searchStyle}
          data-testid="root-changes-filter"
        />
        <button
          type="button"
          role="switch"
          aria-checked={showIndexFiles}
          onClick={() => setShowIndexFiles((value) => !value)}
          style={showIndexFiles ? switchOnStyle : switchStyle}
          title="index.md and <name>.index.md files"
          data-testid="root-changes-index-switch"
        >
          index files: {showIndexFiles ? 'shown' : 'hidden'}
        </button>
      </header>

      <div style={markRowStyle}>
        <button
          type="button"
          onClick={() => void onMark()}
          disabled={disabledReason !== null || marking}
          aria-busy={marking}
          aria-describedby={reasonId}
          style={disabledReason !== null || marking ? markButtonDisabledStyle : markButtonStyle}
          data-testid="root-mark-reviewed"
        >
          {marking ? 'Marking as reviewed…' : 'Mark as reviewed'}
        </button>
        <p id={reasonId} style={sentenceStyle} data-testid="root-mark-reviewed-sentence">
          {MARK_REVIEWED_SENTENCE}
          {disabledReason === null ? null : (
            <>
              {' '}
              <strong data-testid="root-mark-reviewed-reason">
                Not available: {disabledReason}
              </strong>
            </>
          )}
        </p>
      </div>
      {mark.status === 'marked' ? (
        <output style={resultStyle} data-testid="root-mark-reviewed-result">
          Marked commit {mark.result.mark.commit.slice(0, 7)} as reviewed at{' '}
          {mark.result.mark.markedAt}.{' '}
          {mark.result.snapshot.status === 'ok'
            ? `Files changed and not committed stay listed: ${mark.result.snapshot.changes.total}.`
            : null}
        </output>
      ) : null}
      {mark.status === 'failed' ? (
        <p role="alert" style={errorStyle} data-testid="root-mark-reviewed-error">
          {mark.message}
        </p>
      ) : null}

      <div style={toolbarStyle}>
        <button
          type="button"
          disabled={selected === null}
          onClick={() => selected && reveal(selected)}
          style={toolButtonStyle}
          data-testid="root-change-reveal"
        >
          Reveal in tree
        </button>
        <button
          type="button"
          disabled={selected === null}
          onClick={() => selected && openDiff(selected)}
          style={toolButtonStyle}
          data-testid="root-change-open-diff"
        >
          Open diff
        </button>
        <button
          type="button"
          disabled={selected === null || selected.kind === 'deleted'}
          onClick={() => selected && onOpenFile({ path: selected.path, mode: 'code' })}
          style={toolButtonStyle}
          data-testid="root-change-open-code"
        >
          Open code
        </button>
        {hiddenIndexFiles > 0 ? (
          <span style={noteStyle} data-testid="root-changes-hidden-index">
            {hiddenIndexFiles} index {hiddenIndexFiles === 1 ? 'file' : 'files'} hidden
          </span>
        ) : null}
      </div>

      {snapshot.status === 'unread' ? (
        <output style={noteBlockStyle} data-testid="root-changes-unread">
          Reading the changes of {summary.root.name}.
        </output>
      ) : null}
      {snapshot.status === 'failed' ? (
        <p role="alert" style={errorStyle} data-testid="root-changes-error">
          {snapshot.error.message}
        </p>
      ) : null}
      {snapshot.status === 'untracked' ? <p style={noteBlockStyle}>{snapshot.message}</p> : null}
      {changes?.truncated ? (
        <p style={noteBlockStyle} data-testid="root-changes-truncated">
          Showing the first {changes.limit} of {total} changes.
        </p>
      ) : null}
      {changes !== null && rows.length === 0 ? (
        <p style={noteBlockStyle} data-testid="root-changes-empty">
          {allRows.length === 0 ? 'No changes against the baseline.' : 'No change matches.'}
        </p>
      ) : null}
      {changes !== null && rows.length > 0 ? (
        <RootChangesList
          lines={lines}
          changeCount={rows.length}
          selectedPath={selectedPath}
          onSelect={select}
          onReveal={reveal}
          onOpenDiff={openDiff}
        />
      ) : null}
    </section>
  );
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  height: '100%',
  background: 'var(--color-panel)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  padding: '0.4rem 0.7rem',
  borderBottom: '1px solid var(--color-border)',
  background: 'var(--color-header)',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  fontWeight: 600,
  letterSpacing: '0.04em',
  color: 'var(--color-text)',
  textTransform: 'uppercase',
};

const countStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: 'var(--color-text-secondary)',
};

const searchStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  maxWidth: '14rem',
  padding: '0.2rem 0.5rem',
  background: 'var(--color-panel)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '4px',
  color: 'var(--color-text)',
  fontSize: '0.72rem',
};

const switchStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  padding: '0.15rem 0.5rem',
  borderRadius: '999px',
  border: '1px solid var(--color-border-strong)',
  background: 'transparent',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
};

const switchOnStyle: React.CSSProperties = {
  ...switchStyle,
  background: 'var(--color-border)',
  color: 'var(--color-text)',
};

const markRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '0.6rem',
  padding: '0.45rem 0.7rem',
  borderBottom: '1px solid var(--color-border)',
};

const markButtonStyle: React.CSSProperties = {
  flex: '0 0 auto',
  fontSize: '0.75rem',
  padding: '0.25rem 0.7rem',
  borderRadius: '4px',
  border: '1px solid var(--color-border-strong)',
  background: 'var(--color-header)',
  color: 'var(--color-text)',
  cursor: 'pointer',
};

const markButtonDisabledStyle: React.CSSProperties = {
  ...markButtonStyle,
  cursor: 'not-allowed',
  opacity: 0.55,
  borderStyle: 'dashed',
};

const sentenceStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.72rem',
  color: 'var(--color-text-secondary)',
};

const resultStyle: React.CSSProperties = {
  display: 'block',
  padding: '0.35rem 0.7rem',
  fontSize: '0.72rem',
  color: 'var(--color-text)',
  borderBottom: '1px solid var(--color-border)',
};

const errorStyle: React.CSSProperties = {
  margin: 0,
  padding: '0.35rem 0.7rem',
  fontSize: '0.72rem',
  color: 'var(--color-danger)',
  whiteSpace: 'pre-wrap',
};

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.3rem 0.7rem',
  borderBottom: '1px solid var(--color-border)',
};

const toolButtonStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  padding: '0.1rem 0.45rem',
  borderRadius: '4px',
  border: '1px solid var(--color-border-strong)',
  background: 'transparent',
  color: 'var(--color-text)',
};

const noteStyle: React.CSSProperties = {
  marginLeft: 'auto',
  fontSize: '0.7rem',
  color: 'var(--color-text-muted)',
};

const noteBlockStyle: React.CSSProperties = {
  display: 'block',
  margin: 0,
  padding: '0.5rem 0.8rem',
  fontSize: '0.76rem',
  color: 'var(--color-text-muted)',
};
