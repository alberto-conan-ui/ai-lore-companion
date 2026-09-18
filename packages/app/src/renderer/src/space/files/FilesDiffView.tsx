import { type JSX, useEffect, useRef, useState } from 'react';
import type {
  RootBaselinePoints,
  RootFileContent,
  RootSummary,
} from '../../../../shared/ipc/space/roots.types.js';
import { makeCodeView, makeDiffView, makeNoticeView } from '../../components/editor/codemirror.js';
import { onEffectiveTheme } from '../../theme.js';
import { BaselinePointTree } from './BaselinePointTree.js';
import { FilesFileHistory } from './FilesFileHistory.js';
import {
  describeBaseline,
  limitSentences,
  mergedPullRequestSentences,
} from './baselinePickerModel.js';
import {
  type FilesDocState,
  type FilesPin,
  baseName,
  describePin,
  diffSentence,
  notTextSentence,
  pinOfPoint,
} from './filesEditorModel.js';
import {
  bodyStyle,
  buttonStyle,
  hostStyle,
  noticeStyle,
  pinPanelStyle,
  sentenceStyle,
  splitStyle,
  toolbarStyle,
} from './filesEditorStyles.js';

export type FilesDiffViewProps = {
  doc: FilesDocState;
  /** The document's root, or `undefined` when the Space no longer has it. */
  summary: RootSummary | undefined;
  onPin: (pin: FilesPin | null) => void;
  onAgainst: (against: FilesPin | null) => void;
  onOpenAt: (at: FilesPin) => void;
};

/** What the surface shows once read: a two-sided diff, a file read only, or a sentence. */
type Shown =
  | { kind: 'diff'; before: string; after: string }
  | { kind: 'file'; text: string }
  | { kind: 'notice'; text: string };

type PointsState =
  | { kind: 'closed' }
  | { kind: 'loading' }
  | { kind: 'ready'; points: RootBaselinePoints }
  | { kind: 'failed'; message: string };

type Failed = { ok: false; error: { message: string } };

async function call<T>(
  promise: Promise<{ ok: true; value: T } | Failed>,
): Promise<{ ok: true; value: T } | Failed> {
  try {
    return await promise;
  } catch (caught) {
    return { ok: false, error: { message: String(caught) } };
  }
}

/** A file's content as text, or the sentence that says why it is not text. `absent` is empty text when allowed. */
function textOf(
  content: RootFileContent,
  where: string,
  absentIsEmpty: boolean,
): { text: string } | { sentence: string } {
  if (content.kind === 'text') return { text: content.text };
  if (content.kind === 'absent' && absentIsEmpty) return { text: '' };
  return { sentence: notTextSentence(content, where) };
}

/** Read what a document in `diff` or `at-commit` mode shows. */
async function readShown(doc: FilesDocState, rootBaseline: string): Promise<Shown> {
  const { rootId, path } = doc;
  const olderPath = doc.oldPath ?? path;
  if (doc.mode === 'at-commit' && doc.atCommit !== null) {
    const where = describePin(doc.atCommit);
    const at = await call(
      window.cockpit.spaceRootFileAt({ rootId, path, commit: doc.atCommit.commit }),
    );
    if (!at.ok) return { kind: 'notice', text: `The file could not be read: ${at.error.message}` };
    const read = textOf(at.value, where, false);
    return 'text' in read
      ? { kind: 'file', text: read.text }
      : { kind: 'notice', text: read.sentence };
  }
  if (doc.against === null) {
    // The working tree against the pinned point, or against the root's baseline when unpinned.
    const diff = await call(
      window.cockpit.spaceRootDiff({
        rootId,
        path,
        ...(doc.oldPath === undefined ? {} : { oldPath: doc.oldPath }),
        ...(doc.pin === null ? {} : { baseline: doc.pin.commit }),
      }),
    );
    if (!diff.ok)
      return { kind: 'notice', text: `The diff could not be read: ${diff.error.message}` };
    const value = diff.value;
    if (value.kind === 'binary')
      return { kind: 'notice', text: notTextSentence(value, 'the diff') };
    if (value.kind === 'too-large') {
      return { kind: 'notice', text: notTextSentence(value, 'the diff') };
    }
    if (value.text === '') return { kind: 'notice', text: 'No differences.' };
    const [older, newer] = await Promise.all([
      call(window.cockpit.spaceRootFileAt({ rootId, path: olderPath, commit: value.baseline })),
      call(window.cockpit.spaceRootReadFile({ rootId, path })),
    ]);
    if (!older.ok)
      return { kind: 'notice', text: `The file could not be read: ${older.error.message}` };
    if (!newer.ok)
      return { kind: 'notice', text: `The file could not be read: ${newer.error.message}` };
    const before = textOf(older.value, 'the older point', true);
    if ('sentence' in before) return { kind: 'notice', text: before.sentence };
    const working = newer.value;
    const after =
      working.kind === 'text' ? { text: working.text } : textOf(working, 'the working tree', true);
    if ('sentence' in after) return { kind: 'notice', text: after.sentence };
    return { kind: 'diff', before: before.text, after: after.text };
  }
  // Two points: both sides read at their commits.
  const fromCommit = doc.pin?.commit ?? rootBaseline;
  const [older, newer] = await Promise.all([
    call(window.cockpit.spaceRootFileAt({ rootId, path: olderPath, commit: fromCommit })),
    call(window.cockpit.spaceRootFileAt({ rootId, path, commit: doc.against.commit })),
  ]);
  if (!older.ok)
    return { kind: 'notice', text: `The file could not be read: ${older.error.message}` };
  if (!newer.ok)
    return { kind: 'notice', text: `The file could not be read: ${newer.error.message}` };
  if (older.value.kind === 'absent' && newer.value.kind === 'absent') {
    return { kind: 'notice', text: 'There is no file at this path at either point.' };
  }
  const before = textOf(older.value, 'the older point', true);
  if ('sentence' in before) return { kind: 'notice', text: before.sentence };
  const after = textOf(newer.value, describePin(doc.against), true);
  if ('sentence' in after) return { kind: 'notice', text: after.sentence };
  if (before.text === after.text) return { kind: 'notice', text: 'No differences.' };
  return { kind: 'diff', before: before.text, after: after.text };
}

/**
 * A document in `diff` or `at-commit` mode: the sentence of what is shown,
 * the control that pins the diff to another point, the file's history, and
 * the v0.8 side-by-side diff (`makeDiffView`) or a read-only file view.
 *
 * Pinning never moves the root's baseline: the pin is kept on the document
 * and sent as the `baseline` argument of `spaceRootDiff`, which compares
 * against it for this one read. An unpinned document follows the root's
 * baseline and is read again when the root's changes move.
 */
export function FilesDiffView({
  doc,
  summary,
  onPin,
  onAgainst,
  onOpenAt,
}: FilesDiffViewProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => onEffectiveTheme(setTheme), []);
  const [loading, setLoading] = useState(true);
  const [points, setPoints] = useState<PointsState>({ kind: 'closed' });
  const [pickerOpen, setPickerOpen] = useState(false);

  const tracked = summary?.root.tracking.tracked === true;
  const rootBaseline = summary?.baseline ?? 'HEAD';
  const snapshot = summary?.snapshot;
  const pinCommit = doc.pin?.commit;
  const againstCommit = doc.against?.commit;
  const atCommit = doc.atCommit?.commit;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the snapshot is a deliberate re-read trigger (the root's changes moved); the pinned commits stand for the pins.
  useEffect(() => {
    const el = hostRef.current;
    if (!el || !tracked) return;
    let cancelled = false;
    let view: { destroy: () => void } | null = null;
    setLoading(true);
    void readShown(doc, rootBaseline)
      .catch(
        (caught: unknown): Shown => ({
          kind: 'notice',
          text: `The file could not be read: ${String(caught)}`,
        }),
      )
      .then((shown) => {
        if (cancelled || !hostRef.current) return;
        el.replaceChildren();
        const name = baseName(doc.path);
        view =
          shown.kind === 'diff'
            ? makeDiffView(el, name, shown.before, shown.after, theme)
            : shown.kind === 'file'
              ? makeCodeView(el, name, shown.text, theme)
              : makeNoticeView(el, shown.text);
        el.setAttribute('data-shown', shown.kind);
        if (shown.kind === 'notice') el.setAttribute('data-notice', shown.text);
        else el.removeAttribute('data-notice');
        setLoading(false);
      });
    return () => {
      cancelled = true;
      view?.destroy();
      el.replaceChildren();
    };
  }, [
    doc.rootId,
    doc.path,
    doc.oldPath,
    doc.mode,
    pinCommit,
    againstCommit,
    atCommit,
    rootBaseline,
    snapshot,
    tracked,
    theme,
  ]);

  const openPicker = (): void => {
    setPickerOpen(true);
    setPoints({ kind: 'loading' });
    Promise.resolve()
      .then(() => window.cockpit.spaceRootBaselinePoints({ rootId: doc.rootId }))
      .then(
        (result) =>
          setPoints(
            result.ok
              ? { kind: 'ready', points: result.value }
              : { kind: 'failed', message: result.error.message },
          ),
        (caught: unknown) => setPoints({ kind: 'failed', message: String(caught) }),
      );
  };

  const readyPoints = points.kind === 'ready' ? points.points : null;
  const rootBaselineWords = describeBaseline({
    baseline: rootBaseline,
    defaultBaseline: summary?.defaultBaseline ?? null,
    points: readyPoints?.points.points ?? null,
    chosen: null,
  }).text;

  if (!tracked) {
    return (
      <p style={sentenceStyle} data-testid="files-diff-untracked">
        {summary === undefined
          ? 'The Space has no root of this id now.'
          : 'This root is not tracked by git, so a file of it has no diff and no history.'}
      </p>
    );
  }

  const sentence =
    doc.mode === 'at-commit' && doc.atCommit !== null
      ? `${doc.path} as it was at ${describePin(doc.atCommit)}. Read only.`
      : diffSentence({
          path: doc.path,
          pin: doc.pin,
          against: doc.against,
          rootBaseline: rootBaselineWords,
        });

  const marked = [pinCommit, againstCommit, doc.mode === 'at-commit' ? atCommit : undefined].filter(
    (sha): sha is string => sha !== undefined,
  );

  return (
    <>
      <p style={sentenceStyle} data-testid="files-diff-against" aria-live="polite">
        {sentence}
      </p>
      {doc.mode === 'diff' ? (
        <div style={toolbarStyle}>
          <button
            type="button"
            style={buttonStyle}
            aria-expanded={pickerOpen}
            aria-controls="files-pin-panel"
            data-testid="files-diff-pin"
            onClick={() => (pickerOpen ? setPickerOpen(false) : openPicker())}
          >
            Pin this diff to a point
          </button>
          {doc.pin !== null ? (
            <button
              type="button"
              style={buttonStyle}
              data-testid="files-diff-unpin"
              onClick={() => onPin(null)}
            >
              Unpin: diff against the root's baseline
            </button>
          ) : null}
        </div>
      ) : null}
      {doc.mode === 'diff' && pickerOpen ? (
        <section
          id="files-pin-panel"
          style={pinPanelStyle}
          aria-label="Points to pin this diff to"
          data-testid="files-pin-panel"
        >
          <p style={{ margin: 0, fontSize: '0.74rem' }}>
            Pin this document's diff to a point. The root's baseline does not move.
          </p>
          {points.kind === 'loading' ? <output>Reading the points…</output> : null}
          {points.kind === 'failed' ? (
            <p role="alert" data-testid="files-pin-error">
              The points could not be read: {points.message}
            </p>
          ) : null}
          {readyPoints !== null ? (
            <>
              {[
                ...mergedPullRequestSentences(readyPoints.points.mergedPullRequests),
                ...limitSentences(readyPoints.points),
              ].map((text) => (
                <p key={text} style={{ margin: 0, fontSize: '0.72rem' }}>
                  {text}
                </p>
              ))}
              <BaselinePointTree
                rows={readyPoints.rows}
                selectedId={
                  doc.pin === null ? null : `${doc.pin.kind}:${doc.pin.commit}:${doc.pin.at}`
                }
                busy={false}
                onChoose={(point) => {
                  onPin(pinOfPoint(point));
                  setPickerOpen(false);
                }}
              />
            </>
          ) : null}
        </section>
      ) : null}
      <div style={splitStyle}>
        <FilesFileHistory
          rootId={doc.rootId}
          path={doc.path}
          marked={marked}
          against={doc.against}
          onOpenAt={onOpenAt}
          onDiffFrom={(pin) => onPin(pin)}
          onDiffTo={onAgainst}
        />
        <div style={bodyStyle}>
          <div ref={hostRef} style={hostStyle} data-testid="files-diff-host" />
          {loading ? (
            <output style={noticeStyle} data-testid="files-diff-loading">
              Reading…
            </output>
          ) : null}
        </div>
      </div>
    </>
  );
}
