import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BaselinePoint,
  RootBaselinePoints,
  RootBaselineSet,
  SpaceRootsResult,
} from '../../../../shared/ipc/space/roots.types.js';
import { PopoverShell } from '../../components/overlay/PopoverShell.js';
import { BaselinePointTree } from './BaselinePointTree.js';
import {
  describeBaseline,
  describeDefault,
  describePoint,
  limitSentences,
  mergedPullRequestSentences,
  pointKey,
  sameCommit,
} from './baselinePickerModel.js';
import type { TrackedRootSummary } from './filesTypes.js';

export type RootBaselinePickerProps = {
  /** The selected root. Always a root tracked by git. `summary.baseline` is what its changes are read against now. */
  summary: TrackedRootSummary;
  /** Read the list of roots again, after the baseline was set or reset (the default baseline and its notice are in the list). */
  reloadRoots: () => void;
};

type PointsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; value: RootBaselinePoints }
  | { status: 'failed'; message: string };

/** What a channel gives when it could not be called at all. */
function thrown<T>(caught: unknown): SpaceRootsResult<T> {
  return { ok: false, error: { kind: 'git-failed', message: String(caught) } };
}

/**
 * The baseline picker of the selected root (phase M5.4). It states the
 * present baseline in words, lists the root's baseline points (reviewed marks,
 * merged pull requests, session closes and commits, newest first, commits
 * grouped under their session), sets the baseline to a chosen point, and sets
 * it back to the default. It calls `spaceRootBaselinePoints`,
 * `spaceRootSetBaseline` and `spaceRootResetBaseline` itself; the new snapshot
 * reaches the layout through `onSpaceRootChanges`, and `reloadRoots` reads the
 * default baseline and its notice again.
 */
export function RootBaselinePicker({ summary, reloadRoots }: RootBaselinePickerProps): JSX.Element {
  /** The point chosen last on each root, so that the baseline is described by it. */
  const [chosen, setChosen] = useState<Readonly<Record<string, BaselinePoint>>>({});
  // Keyed by root: what was read and said for one root is not kept for another.
  return (
    <PickerForRoot
      key={summary.root.id}
      summary={summary}
      reloadRoots={reloadRoots}
      chosen={chosen}
      setChosen={setChosen}
    />
  );
}

type Chosen = Readonly<Record<string, BaselinePoint>>;

function PickerForRoot({
  summary,
  reloadRoots,
  chosen,
  setChosen,
}: RootBaselinePickerProps & {
  chosen: Chosen;
  setChosen: (update: (previous: Chosen) => Chosen) => void;
}): JSX.Element {
  const rootId = summary.root.id;
  const [points, setPoints] = useState<PointsState>({ status: 'idle' });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const loadPoints = useCallback((): void => {
    setPoints({ status: 'loading' });
    void Promise.resolve()
      .then(() => window.cockpit.spaceRootBaselinePoints({ rootId }))
      .catch((caught: unknown) => thrown<RootBaselinePoints>(caught))
      .then((result) => {
        if (!alive.current) return;
        setPoints(
          result.ok
            ? { status: 'ready', value: result.value }
            : { status: 'failed', message: result.error.message },
        );
      });
  }, [rootId]);

  const chosenHere = chosen[rootId] ?? null;
  const readyPoints = points.status === 'ready' ? points.value : null;
  const current = describeBaseline({
    baseline: summary.baseline,
    defaultBaseline: summary.defaultBaseline,
    points: readyPoints?.points.points ?? null,
    chosen: chosenHere,
  });

  // A baseline that is not the default and not the point chosen here is
  // described by the points, so they are read to name it.
  const needsPoints =
    !current.isDefault &&
    !(chosenHere !== null && sameCommit(summary.baseline, chosenHere.commit)) &&
    summary.baseline !== 'HEAD';
  useEffect(() => {
    if (needsPoints && points.status === 'idle') loadPoints();
  }, [needsPoints, points.status, loadPoints]);

  const onOpenChange = (next: boolean): void => {
    setOpen(next);
    if (next) loadPoints();
  };

  const selectedId = useMemo((): string | null => {
    if (readyPoints === null) return null;
    if (chosenHere !== null && sameCommit(summary.baseline, chosenHere.commit)) {
      return pointKey(chosenHere);
    }
    const found = readyPoints.points.points.find((point) =>
      sameCommit(summary.baseline, point.commit),
    );
    return found === undefined ? null : pointKey(found);
  }, [readyPoints, chosenHere, summary.baseline]);

  const apply = async (
    call: () => Promise<SpaceRootsResult<RootBaselineSet>>,
    said: string,
    point: BaselinePoint | null,
  ): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await Promise.resolve()
      .then(call)
      .catch((caught: unknown) => thrown<RootBaselineSet>(caught));
    if (result.ok) {
      setChosen((previous) => {
        const next = { ...previous };
        if (point === null) delete next[rootId];
        else next[rootId] = point;
        return next;
      });
      reloadRoots();
    }
    // Another root was selected meanwhile: nothing more is said here.
    if (!alive.current) return;
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setAnnouncement(said);
    setOpen(false);
  };

  const choose = (point: BaselinePoint): void => {
    void apply(
      () => window.cockpit.spaceRootSetBaseline({ rootId, baseline: point.commit }),
      `Baseline set to ${describePoint(point)}.`,
      point,
    );
  };

  const reset = (): void => {
    const fallback = summary.defaultBaseline;
    void apply(
      () => window.cockpit.spaceRootResetBaseline({ rootId }),
      fallback === null
        ? 'Baseline set back to the default.'
        : `Baseline set back to the default, ${describeDefault(fallback)}.`,
      null,
    );
  };

  const sentences =
    readyPoints === null
      ? []
      : [
          ...mergedPullRequestSentences(readyPoints.points.mergedPullRequests),
          ...limitSentences(readyPoints.points),
        ];

  return (
    <div style={wrapStyle} data-testid="files-baseline-picker">
      <div style={lineStyle}>
        <span style={labelStyle}>Baseline</span>
        <PopoverShell
          open={open}
          onOpenChange={onOpenChange}
          align="start"
          label="Baseline points"
          testId="files-baseline-popover"
          contentStyle={popoverStyle}
          trigger={
            <button
              type="button"
              style={triggerStyle}
              disabled={busy}
              aria-label={`Baseline: ${current.text}${current.isDefault ? ' (default)' : ''}. Choose another baseline point.`}
              data-testid="files-baseline-trigger"
            >
              <span style={triggerTextStyle} data-testid="files-baseline">
                {current.text}
              </span>
              {current.isDefault ? <span style={defaultTagStyle}>default</span> : null}
              <span aria-hidden="true" style={caretStyle}>
                ▾
              </span>
            </button>
          }
        >
          {points.status === 'loading' || points.status === 'idle' ? (
            <output
              style={{ ...messageStyle, display: 'block' }}
              data-testid="files-baseline-loading"
            >
              Reading the baseline points.
            </output>
          ) : null}
          {points.status === 'failed' ? (
            <p role="alert" style={errorStyle} data-testid="files-baseline-points-error">
              {points.message}
            </p>
          ) : null}
          {sentences.map((sentence) => (
            <p key={sentence} style={messageStyle} data-testid="files-baseline-sentence">
              {sentence}
            </p>
          ))}
          {readyPoints !== null ? (
            <BaselinePointTree
              rows={readyPoints.rows}
              selectedId={selectedId}
              busy={busy}
              onChoose={choose}
            />
          ) : null}
        </PopoverShell>
        <button
          type="button"
          style={resetStyle}
          onClick={reset}
          disabled={busy || current.isDefault}
          data-testid="files-baseline-reset"
        >
          Back to the default
        </button>
      </div>
      {summary.baselineNotice !== null ? (
        <p style={noticeStyle} data-testid="files-baseline-notice">
          {summary.baselineNotice}
        </p>
      ) : null}
      {error !== null ? (
        <p role="alert" style={errorStyle} data-testid="files-baseline-error">
          {error}
        </p>
      ) : null}
      <output aria-live="polite" style={messageStyle} data-testid="files-baseline-status">
        {announcement}
      </output>
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
  padding: '0.4rem 0.6rem',
  height: '100%',
  boxSizing: 'border-box',
  overflowY: 'auto',
};

const lineStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  minWidth: 0,
};

const labelStyle: React.CSSProperties = {
  flexShrink: 0,
  fontSize: '0.75rem',
  color: 'var(--color-text-muted)',
};

const triggerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  minWidth: 0,
  flex: 1,
  padding: '0.2rem 0.5rem',
  fontSize: '0.8rem',
  color: 'var(--color-text)',
  background: 'var(--color-panel)',
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  cursor: 'pointer',
  textAlign: 'left',
};

const triggerTextStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const defaultTagStyle: React.CSSProperties = {
  flexShrink: 0,
  fontSize: '0.7rem',
  color: 'var(--color-text-muted)',
};

const caretStyle: React.CSSProperties = { flexShrink: 0, color: 'var(--color-text-muted)' };

const resetStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: '0.2rem 0.5rem',
  fontSize: '0.75rem',
  color: 'var(--color-text)',
  background: 'transparent',
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  cursor: 'pointer',
};

const popoverStyle: React.CSSProperties = {
  width: '32rem',
  maxWidth: '90vw',
  padding: '0.5rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
  background: 'var(--color-panel)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: 6,
  zIndex: 50,
};

const messageStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.75rem',
  color: 'var(--color-text-muted)',
};

const noticeStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.75rem',
  color: 'var(--color-warn-fg)',
};

const errorStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.75rem',
  color: 'var(--color-danger-fg)',
};
