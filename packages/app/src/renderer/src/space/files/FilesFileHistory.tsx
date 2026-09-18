import { type JSX, useEffect, useState } from 'react';
import type { RootFileHistory } from '../../../../shared/ipc/space/roots.types.js';
import { shortSha } from './baselinePickerModel.js';
import {
  type FilesPin,
  describePin,
  formatHistoryTime,
  pinOfHistoryEntry,
} from './filesEditorModel.js';
import {
  historyActionsStyle,
  historyHeadStyle,
  historyItemOnStyle,
  historyItemStyle,
  historyListStyle,
  historyMetaStyle,
  historyNoteStyle,
  historyStyle,
  smallButtonStyle,
} from './filesEditorStyles.js';

export type FilesFileHistoryProps = {
  rootId: string;
  path: string;
  /** The commits the document shows now, marked in the list. */
  marked: readonly string[];
  /** The diff's newer side, when it is a commit; the list offers to go back to the working tree. */
  against: FilesPin | null;
  onOpenAt: (pin: FilesPin) => void;
  onDiffFrom: (pin: FilesPin) => void;
  onDiffTo: (pin: FilesPin | null) => void;
};

type Loaded =
  | { kind: 'loading' }
  | { kind: 'ready'; history: RootFileHistory }
  | { kind: 'failed'; message: string };

/**
 * The commits that touched one file, newest first, following renames
 * (`spaceRootFileHistory`). Each commit can be opened (the file as it was at
 * that commit), taken as the diff's older side ("Diff from") or as its newer
 * side ("Diff to"), so that any two points of the file can be compared. The
 * root's baseline is not changed by any of these.
 */
export function FilesFileHistory({
  rootId,
  path,
  marked,
  against,
  onOpenAt,
  onDiffFrom,
  onDiffTo,
}: FilesFileHistoryProps): JSX.Element {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setLoaded({ kind: 'loading' });
    Promise.resolve()
      .then(() => window.cockpit.spaceRootFileHistory({ rootId, path }))
      .then(
        (result) => {
          if (cancelled) return;
          setLoaded(
            result.ok
              ? { kind: 'ready', history: result.value }
              : { kind: 'failed', message: result.error.message },
          );
        },
        (caught: unknown) => {
          if (!cancelled) setLoaded({ kind: 'failed', message: String(caught) });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [rootId, path]);

  return (
    <section style={historyStyle} aria-label={`History of ${path}`} data-testid="files-history">
      <h3 style={historyHeadStyle}>History</h3>
      {against !== null ? (
        <p style={historyNoteStyle}>
          Diff to: {describePin(against)}.{' '}
          <button
            type="button"
            style={smallButtonStyle}
            data-testid="files-history-diff-to-working-tree"
            onClick={() => onDiffTo(null)}
          >
            Diff to the working tree
          </button>
        </p>
      ) : null}
      {loaded.kind === 'loading' ? (
        <output style={{ ...historyNoteStyle, display: 'block' }}>Reading the history…</output>
      ) : loaded.kind === 'failed' ? (
        <p style={historyNoteStyle} role="alert" data-testid="files-history-error">
          The history could not be read: {loaded.message}
        </p>
      ) : loaded.history.entries.length === 0 ? (
        <p style={historyNoteStyle} data-testid="files-history-empty">
          No commit touched this file.
        </p>
      ) : (
        <>
          <ul style={historyListStyle} data-testid="files-history-list">
            {loaded.history.entries.map((entry) => {
              const pin = pinOfHistoryEntry(entry);
              const sha = shortSha(entry.sha);
              const isMarked = marked.includes(entry.sha);
              return (
                <li
                  key={entry.sha}
                  style={isMarked ? historyItemOnStyle : historyItemStyle}
                  data-testid={`files-history-${sha}`}
                  aria-current={isMarked ? 'true' : undefined}
                >
                  <span>{entry.subject}</span>
                  <span style={historyMetaStyle}>
                    commit {sha} · {formatHistoryTime(entry.timestamp)}
                    {entry.author ? ` · ${entry.author}` : ''}
                  </span>
                  <span style={historyActionsStyle}>
                    <button
                      type="button"
                      style={smallButtonStyle}
                      aria-label={`Open ${path} at commit ${sha}`}
                      data-testid={`files-history-open-${sha}`}
                      onClick={() => onOpenAt(pin)}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      style={smallButtonStyle}
                      aria-label={`Diff from commit ${sha}`}
                      data-testid={`files-history-from-${sha}`}
                      onClick={() => onDiffFrom(pin)}
                    >
                      Diff from
                    </button>
                    <button
                      type="button"
                      style={smallButtonStyle}
                      aria-label={`Diff to commit ${sha}`}
                      data-testid={`files-history-to-${sha}`}
                      onClick={() => onDiffTo(pin)}
                    >
                      Diff to
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          {loaded.history.truncated ? (
            <p style={historyNoteStyle} data-testid="files-history-truncated">
              The newest {loaded.history.limit} commits are shown; older ones are not.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
