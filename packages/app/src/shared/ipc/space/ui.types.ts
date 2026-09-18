/**
 * Types of the channels that read and save what the Files window remembers
 * across a restart (phase M5.7). Plain data only. Re-exported by
 * `./files.types.ts`.
 *
 * Each concern is one file under `<userData>/spaces/<key>/ui/`, versioned. No
 * concern holds a file's content or an absolute path: a document is a root id
 * and a path relative to that root. The positions of the two windows are
 * concerns too, but main reads and writes them itself, so no channel carries
 * them.
 */

/** A point a document is pinned to, as the editor keeps it (`filesEditorModel.ts`). */
export type UiFilesPin = {
  kind: 'reviewed-mark' | 'merged-pull-request' | 'session-close' | 'commit';
  commit: string;
  at: string;
  label: string;
};

/** One open document of the editor. */
export type UiFilesDoc = {
  rootId: string;
  path: string;
  oldPath?: string;
  mode: 'code' | 'preview' | 'diff' | 'at-commit';
  pin: UiFilesPin | null;
  against: UiFilesPin | null;
  atCommit: UiFilesPin | null;
};

/** `files-editor.json`: the open documents, their modes and pins, and the active one. */
export type UiFilesEditorState = { version: 1; docs: UiFilesDoc[]; activeKey: string | null };

/** `selected-root.json`: the root the Files window shows. */
export type UiSelectedRootState = { version: 1; rootId: string | null };

/**
 * `baselines.json`: the baseline the Human Lead picked for a root, by root id
 * (`HEAD` or a full commit). A root on its default baseline has no entry, so a
 * later reviewed mark still moves it.
 */
export type UiBaselinesState = { version: 1; roots: Record<string, string> };

/** `space-window.json` and `files-window.json`: where the window was and its size. */
export type UiWindowBoundsState = {
  version: 1;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** The state of each concern the renderer reads and saves. */
export type UiRendererConcerns = {
  'files-editor': UiFilesEditorState;
  'selected-root': UiSelectedRootState;
  baselines: UiBaselinesState;
};

/** A concern the renderer reads and saves. */
export type UiRendererConcern = keyof UiRendererConcerns;

export type SpaceUiReadArg = { concern: UiRendererConcern };

/**
 * What a read gives. `state` is `null` when nothing was saved, or when the
 * file could not be used; `notice` then says why in one sentence (a file set
 * aside, a file a newer build wrote).
 */
export type SpaceUiRead<C extends UiRendererConcern = UiRendererConcern> = {
  state: UiRendererConcerns[C] | null;
  notice: string | null;
};

export type SpaceUiSaveArg = {
  [C in UiRendererConcern]: { concern: C; state: UiRendererConcerns[C] };
}[UiRendererConcern];

/**
 * What a save gives. `scheduled`: the file is written shortly. `not-focused`:
 * another window of the Space has the focus, and only the focused window
 * writes. `not-writable`: another running instance owns the desk, or a newer
 * build wrote the file; nothing is written.
 */
export type SpaceUiSaved = { outcome: 'scheduled' | 'not-focused' | 'not-writable' };

/**
 * `not-a-space-window`: the call did not come from a Files window of an open Space.
 * `invalid-argument`: the argument does not have the concern's shape.
 */
export type SpaceUiFailure = { kind: 'not-a-space-window' | 'invalid-argument'; message: string };

/** What both channels return. A handler never rejects. */
export type SpaceUiResult<T> = { ok: true; value: T } | { ok: false; error: SpaceUiFailure };
