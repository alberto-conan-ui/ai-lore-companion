import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  UiBaselinesState,
  UiFilesEditorState,
} from '../../../../shared/ipc/space/ui.types.js';
import { EMPTY_EDITOR_STATE, type FilesEditorState, docKey } from './filesEditorModel.js';
import { type RootSummary, isTrackedRoot } from './filesTypes.js';

/** What the Files window restores and saves besides the selected root (phase M5.7). */
export type FilesMemory = {
  /** Whether what was remembered has been read and checked; the editor is shown only then. */
  ready: boolean;
  /** The documents to open the editor with. */
  editorInitial: FilesEditorState;
  /** One sentence per entry that could not be restored, and per file that could not be read. */
  notices: string[];
  dismissNotices: () => void;
  /** Save the editor's documents. */
  saveEditor: (state: FilesEditorState) => void;
};

/**
 * The baseline the Human Lead picked for each root: a root whose baseline is
 * not its default. A root on its default is left out, so that a later reviewed
 * mark moves it as usual.
 */
export function pickedBaselines(roots: RootSummary[]): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const summary of roots) {
    if (!isTrackedRoot(summary)) continue;
    const byDefault = summary.defaultBaseline?.baseline ?? 'HEAD';
    if (summary.baseline !== byDefault) picked[summary.root.id] = summary.baseline;
  }
  return picked;
}

/** The notice for a remembered document whose root the Space no longer has. */
export function missingRootDocNotice(rootId: string, path: string): string {
  return `${path} was open in the root ${rootId}, which this Space no longer has. It was not reopened.`;
}

/** The notice for a remembered document whose file is gone. */
export function missingFileNotice(rootName: string, path: string): string {
  return `${path} was open in ${rootName} and no longer exists. It was not reopened.`;
}

/** The notice for a remembered selected root the Space no longer has. */
export function missingSelectedRootNotice(rootId: string): string {
  return `The root ${rootId} was selected, and this Space no longer has it. The first root is shown.`;
}

/** The notice for a remembered baseline that could not be set again. */
export function baselineNotRestoredNotice(rootId: string, reason: string): string {
  return `The baseline chosen for ${rootId} was not restored: ${reason}`;
}

type Remembered = { editor: UiFilesEditorState | null; baselines: UiBaselinesState | null };

/**
 * Restore what the Files window remembered once the roots are read: the
 * documents (a document of a root the Space no longer has, or a document in
 * Code or Preview whose file is gone, is dropped with a notice; a document in
 * Diff or At commit is kept, because a deleted file has a diff), the baseline
 * the Human Lead picked for each root (set again through main's roots
 * service; a root that is gone or a commit that is gone is dropped with a
 * notice), and the selected root (dropped with a notice when it is gone).
 * After that, the picked baselines are saved whenever they change.
 */
export function useFilesMemory(arg: {
  spaceKey: string;
  roots: RootSummary[] | null;
  selectedId: string | null;
  select: (rootId: string) => void;
}): FilesMemory {
  const { spaceKey, roots, selectedId, select } = arg;
  const [remembered, setRemembered] = useState<Remembered | null>(null);
  const [ready, setReady] = useState(false);
  const [editorInitial, setEditorInitial] = useState<FilesEditorState>(EMPTY_EDITOR_STATE);
  const [notices, setNotices] = useState<string[]>([]);
  const restoring = useRef(false);
  const lastBaselines = useRef<string | null>(null);
  const expectedBaselines = useRef<string>('{}');

  // biome-ignore lint/correctness/useExhaustiveDependencies: read once per Space.
  useEffect(() => {
    let alive = true;
    const read = async (): Promise<void> => {
      const [editor, baselines] = await Promise.all([
        window.cockpit.spaceUiRead({ concern: 'files-editor' }),
        window.cockpit.spaceUiRead({ concern: 'baselines' }),
      ]);
      if (!alive) return;
      const found: string[] = [];
      for (const result of [editor, baselines]) {
        if (result.ok && result.value.notice !== null) found.push(result.value.notice);
      }
      if (found.length > 0) setNotices((previous) => [...previous, ...found]);
      setRemembered({
        editor: editor.ok ? (editor.value.state as UiFilesEditorState | null) : null,
        baselines: baselines.ok ? (baselines.value.state as UiBaselinesState | null) : null,
      });
    };
    read().catch(() => {
      if (alive) setRemembered({ editor: null, baselines: null });
    });
    return () => {
      alive = false;
    };
  }, [spaceKey]);

  // Restore once, when both the roots and what was remembered are there.
  useEffect(() => {
    if (roots === null || remembered === null || restoring.current) return;
    restoring.current = true;
    const known = new Map(roots.map((summary) => [summary.root.id, summary]));
    const found: string[] = [];

    const restoreEditor = async (): Promise<FilesEditorState> => {
      const saved = remembered.editor;
      if (saved === null) return EMPTY_EDITOR_STATE;
      const docs: FilesEditorState['docs'] = [];
      for (const doc of saved.docs) {
        const summary = known.get(doc.rootId);
        if (!summary) {
          found.push(missingRootDocNotice(doc.rootId, doc.path));
          continue;
        }
        if (doc.mode === 'code' || doc.mode === 'preview') {
          const file = await window.cockpit
            .spaceRootReadFile({ rootId: doc.rootId, path: doc.path })
            .catch(() => null);
          if (file?.ok && file.value.kind === 'absent') {
            found.push(missingFileNotice(summary.root.name, doc.path));
            continue;
          }
        }
        docs.push({
          rootId: doc.rootId,
          path: doc.path,
          ...(doc.oldPath === undefined ? {} : { oldPath: doc.oldPath }),
          mode: doc.mode,
          pin: doc.pin,
          against: doc.against,
          atCommit: doc.atCommit,
        });
      }
      const keys = docs.map(docKey);
      const activeKey =
        saved.activeKey !== null && keys.includes(saved.activeKey)
          ? saved.activeKey
          : (keys[0] ?? null);
      return { version: 1, docs, activeKey };
    };

    /** Set each remembered baseline again; gives the entries that were restored. */
    const restoreBaselines = async (): Promise<Record<string, string>> => {
      const saved = remembered.baselines?.roots ?? {};
      const kept: Record<string, string> = {};
      for (const [rootId, baseline] of Object.entries(saved)) {
        const summary = known.get(rootId);
        if (!summary || !isTrackedRoot(summary)) {
          found.push(baselineNotRestoredNotice(rootId, 'this Space no longer has that root.'));
          continue;
        }
        if (summary.baseline === baseline) {
          kept[rootId] = baseline;
          continue;
        }
        const set = await window.cockpit
          .spaceRootSetBaseline({ rootId, baseline })
          .catch((caught: unknown) => ({
            ok: false as const,
            error: { kind: 'roots-unavailable' as const, message: String(caught) },
          }));
        if (set.ok) kept[rootId] = set.value.baseline;
        else found.push(baselineNotRestoredNotice(summary.root.name, set.error.message));
      }
      return kept;
    };

    void (async () => {
      const [editor, kept] = await Promise.all([restoreEditor(), restoreBaselines()]);
      expectedBaselines.current = JSON.stringify(kept);
      setEditorInitial(editor);
      if (found.length > 0) setNotices((previous) => [...previous, ...found]);
      setReady(true);
    })();
  }, [roots, remembered]);

  // A remembered selected root the Space no longer has is dropped, and the first root shown.
  const reportedRoot = useRef<string | null>(null);
  useEffect(() => {
    if (roots === null || selectedId === null || reportedRoot.current === selectedId) return;
    if (roots.some((summary) => summary.root.id === selectedId)) return;
    reportedRoot.current = selectedId;
    setNotices((previous) => [...previous, missingSelectedRootNotice(selectedId)]);
    const first = roots[0];
    if (first) select(first.root.id);
  }, [roots, selectedId, select]);

  // After the restore, save the picked baselines whenever they change.
  useEffect(() => {
    if (!ready || roots === null) return;
    const text = JSON.stringify(pickedBaselines(roots));
    const first = lastBaselines.current === null;
    if (text === lastBaselines.current) return;
    lastBaselines.current = text;
    if (first) {
      // The first reading after the restore: write only to drop what could not be restored,
      // and only once the roots show what was restored.
      const savedText = JSON.stringify(remembered?.baselines?.roots ?? {});
      if (text !== expectedBaselines.current || text === savedText) return;
    }
    void window.cockpit
      .spaceUiSave({ concern: 'baselines', state: { version: 1, roots: pickedBaselines(roots) } })
      .catch(() => undefined);
  }, [ready, roots, remembered]);

  const saveEditor = useCallback(
    (state: FilesEditorState): void => {
      if (!ready) return;
      void window.cockpit.spaceUiSave({ concern: 'files-editor', state }).catch(() => undefined);
    },
    [ready],
  );

  const dismissNotices = useCallback((): void => setNotices([]), []);

  return { ready, editorInitial, notices, dismissNotices, saveEditor };
}
