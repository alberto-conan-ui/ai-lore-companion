/**
 * The state of the editor of the Files window (phase M5.5): the open
 * documents, each with its mode and its pinned point, and which one is
 * active. Pure functions and plain data, so the component and its tests share
 * one source, and so phase M5.7 can write the state to a file and give it
 * back: `FilesEditorState` is serialisable with `JSON.stringify` as it is.
 * Unsaved text is not part of it. Types only come from the shared IPC types.
 */

import type { BaselinePoint } from '../../../../shared/ipc/space/roots.types.js';
import { describePoint, formatAt, shortSha } from './baselinePickerModel.js';
import type { FilesOpenRequest } from './filesTypes.js';

/**
 * How a document is shown. `code`: the editor on the working-tree file.
 * `preview`: the same editor with the markdown live preview (markdown only).
 * `diff`: the diff of two points, with the file's history. `at-commit`: the
 * file as it was at a commit, read only, with the file's history.
 */
export type FilesDocMode = 'code' | 'preview' | 'diff' | 'at-commit';

/**
 * A point of a root a document is pinned to: one of the four kinds of
 * baseline point. A commit picked in the file's history is a `commit` point.
 * `label` is the point in the picker's words, kept so that a restored
 * document says what it is pinned to without reading the points again.
 */
export type FilesPin = { kind: BaselinePoint['kind']; commit: string; at: string; label: string };

/** One open document. A document is one root and one path. */
export type FilesDocState = {
  rootId: string;
  /** Relative to the root's folder, with `/`. */
  path: string;
  /** The path a renamed file had, for a diff read as a rename. */
  oldPath?: string;
  mode: FilesDocMode;
  /** The diff's older side. `null`: the root's baseline, whatever it is when the diff is read. */
  pin: FilesPin | null;
  /** The diff's newer side. `null`: the working tree. */
  against: FilesPin | null;
  /** The commit a document in `at-commit` mode shows. */
  atCommit: FilesPin | null;
};

/** Everything the editor keeps. `activeKey` is the `docKey` of the active document. */
export type FilesEditorState = { version: 1; docs: FilesDocState[]; activeKey: string | null };

export const EMPTY_EDITOR_STATE: FilesEditorState = { version: 1, docs: [], activeKey: null };

/** The key of a document: its root and its path. */
export function docKey(doc: { rootId: string; path: string }): string {
  return JSON.stringify([doc.rootId, doc.path]);
}

/** The file name of a path. */
export function baseName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

/** Whether a file is markdown, which gets the live preview. */
export function isMarkdown(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path);
}

export type FilesEditorAction =
  | { type: 'open'; request: FilesOpenRequest }
  | { type: 'activate'; key: string }
  | { type: 'close'; key: string }
  | { type: 'set-mode'; key: string; mode: FilesDocMode }
  | { type: 'pin'; key: string; pin: FilesPin | null }
  | { type: 'against'; key: string; against: FilesPin | null }
  | { type: 'open-at'; key: string; at: FilesPin };

function update(
  state: FilesEditorState,
  key: string,
  change: (doc: FilesDocState) => FilesDocState,
): FilesEditorState {
  let found = false;
  const docs = state.docs.map((doc) => {
    if (docKey(doc) !== key) return doc;
    found = true;
    return change(doc);
  });
  return found ? { ...state, docs } : state;
}

/**
 * The mode an open request asks for. `code` on a markdown file opens the
 * live-preview editor; the Code button shows the plain editor.
 */
export function modeForRequest(request: FilesOpenRequest): FilesDocMode {
  if (request.mode === 'diff') return 'diff';
  return isMarkdown(request.path) ? 'preview' : 'code';
}

export function filesEditorReducer(
  state: FilesEditorState,
  action: FilesEditorAction,
): FilesEditorState {
  switch (action.type) {
    case 'open': {
      const { request } = action;
      const key = docKey(request);
      const mode = modeForRequest(request);
      const existing = state.docs.find((doc) => docKey(doc) === key);
      if (existing !== undefined) {
        const next = update(state, key, (doc) => ({
          ...doc,
          mode,
          ...(request.oldPath === undefined ? {} : { oldPath: request.oldPath }),
        }));
        return { ...next, activeKey: key };
      }
      const doc: FilesDocState = {
        rootId: request.rootId,
        path: request.path,
        ...(request.oldPath === undefined ? {} : { oldPath: request.oldPath }),
        mode,
        pin: null,
        against: null,
        atCommit: null,
      };
      return { ...state, docs: [...state.docs, doc], activeKey: key };
    }
    case 'activate':
      return state.docs.some((doc) => docKey(doc) === action.key)
        ? { ...state, activeKey: action.key }
        : state;
    case 'close': {
      const index = state.docs.findIndex((doc) => docKey(doc) === action.key);
      if (index === -1) return state;
      const docs = state.docs.filter((_, i) => i !== index);
      let activeKey = state.activeKey;
      if (activeKey === action.key) {
        const neighbour = docs[Math.min(index, docs.length - 1)];
        activeKey = neighbour === undefined ? null : docKey(neighbour);
      }
      return { ...state, docs, activeKey };
    }
    case 'set-mode':
      return update(state, action.key, (doc) => ({ ...doc, mode: action.mode }));
    case 'pin':
      return update(state, action.key, (doc) => ({ ...doc, pin: action.pin, mode: 'diff' }));
    case 'against':
      return update(state, action.key, (doc) => ({
        ...doc,
        against: action.against,
        mode: 'diff',
      }));
    case 'open-at':
      return update(state, action.key, (doc) => ({
        ...doc,
        atCommit: action.at,
        mode: 'at-commit',
      }));
  }
}

/** A baseline point as a pin, labelled as the picker labels it. */
export function pinOfPoint(point: BaselinePoint): FilesPin {
  return { kind: point.kind, commit: point.commit, at: point.at, label: describePoint(point) };
}

/** A commit of the file's history as a pin, labelled as the picker labels a commit point. */
export function pinOfHistoryEntry(entry: {
  sha: string;
  subject: string;
  timestamp: number;
}): FilesPin {
  const at = new Date(entry.timestamp).toISOString();
  return pinOfPoint({ kind: 'commit', commit: entry.sha, at, subject: entry.subject });
}

/** A pin in words, with its short commit. */
export function describePin(pin: FilesPin): string {
  return pin.kind === 'commit' ? pin.label : `${pin.label} (${shortSha(pin.commit)})`;
}

/**
 * The sentence that says what a diff compares. `rootBaseline` is the root's
 * present baseline in words.
 */
export function diffSentence(arg: {
  path: string;
  pin: FilesPin | null;
  against: FilesPin | null;
  rootBaseline: string;
}): string {
  const newer = arg.against === null ? 'the working tree' : describePin(arg.against);
  if (arg.pin === null) {
    return `${arg.path}: ${newer} against the root's baseline, ${arg.rootBaseline}.`;
  }
  return `${arg.path}: ${newer} against ${describePin(arg.pin)}, pinned for this document only. The root's baseline stays ${arg.rootBaseline}.`;
}

/** What a file that is not shown as text is, in words. */
export function notTextSentence(
  content:
    | { kind: 'binary'; bytes?: number }
    | { kind: 'too-large'; bytes: number; limit: number }
    | { kind: 'absent' },
  where: string,
): string {
  switch (content.kind) {
    case 'binary':
      return `The file is binary${content.bytes === undefined ? '' : ` (${content.bytes} bytes)`} in ${where}. It is not shown as text.`;
    case 'too-large':
      return `The file is ${content.bytes} bytes in ${where}, more than the ${content.limit} bytes the editor shows.`;
    case 'absent':
      return `There is no file at this path in ${where}.`;
  }
}

/** A history entry's time in words. */
export function formatHistoryTime(timestamp: number): string {
  return formatAt(new Date(timestamp).toISOString());
}
