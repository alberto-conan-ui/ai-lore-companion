import { type JSX, useEffect, useRef, useState } from 'react';
import type { RootWorkingFile } from '../../../../shared/ipc/space/root-file-edit.types.js';
import { type EditView, makeEditView } from '../../components/editor/codemirror.js';
import { onEffectiveTheme } from '../../theme.js';
import { baseName, notTextSentence } from './filesEditorModel.js';
import {
  bodyStyle,
  hostStyle,
  noticeStyle,
  saveErrorStyle,
  savedStyle,
} from './filesEditorStyles.js';

/** Unsaved text of the open documents, by document key, kept while a document is not shown. */
export type FilesBuffers = {
  get(key: string): string | undefined;
  set(key: string, text: string | null): void;
};

export type FilesCodeViewProps = {
  docKey: string;
  rootId: string;
  path: string;
  /** Turn the markdown live preview on (the Preview mode). */
  livePreview: boolean;
  buffers: FilesBuffers;
};

type Status =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'not-text'; sentence: string }
  | { kind: 'failed'; message: string };

/**
 * The editor of the working-tree file of a document: the v0.8 live editor
 * (`makeEditView`), plain for Code and with the markdown live preview for
 * Preview. The view is built once per document, so a switch between Code and
 * Preview keeps the cursor, the undo history and the unsaved text. Cmd/Ctrl-S
 * saves through `spaceRootWriteFile`, which refuses a file changed on disk
 * since it was read. Edits go to `buffers`, so the text survives a switch to
 * another document.
 */
export function FilesCodeView({
  docKey,
  rootId,
  path,
  livePreview,
  buffers,
}: FilesCodeViewProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditView | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => onEffectiveTheme(setTheme), []);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const livePreviewRef = useRef(livePreview);
  livePreviewRef.current = livePreview;
  const buffersRef = useRef(buffers);
  buffersRef.current = buffers;
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    let cancelled = false;
    setStatus({ kind: 'loading' });
    setSaveError(null);
    void (async () => {
      let read: Awaited<ReturnType<typeof window.cockpit.spaceRootReadFile>>;
      try {
        read = await window.cockpit.spaceRootReadFile({ rootId, path });
      } catch (caught) {
        read = { ok: false, error: { kind: 'read-failed', message: String(caught) } };
      }
      if (cancelled || !hostRef.current) return;
      if (!read.ok) {
        setStatus({ kind: 'failed', message: read.error.message });
        return;
      }
      const file: RootWorkingFile = read.value;
      if (file.kind !== 'text') {
        setStatus({ kind: 'not-text', sentence: notTextSentence(file, 'the working tree') });
        return;
      }
      // The editor holds lines ending in `\n`; a file whose lines mostly end in
      // `\r\n` is saved with `\r\n`, so a save does not change its line endings.
      const crlf = file.text.match(/\r\n/g)?.length ?? 0;
      const lf = (file.text.match(/\n/g)?.length ?? 0) - crlf;
      const eol = crlf > lf ? '\r\n' : '\n';
      const toDisk = (text: string): string => (eol === '\n' ? text : text.replace(/\n/g, '\r\n'));
      let saved = file.text.replace(/\r\n/g, '\n');
      let mtimeMs = file.mtimeMs;
      const buffered = buffersRef.current.get(docKey);
      viewRef.current = makeEditView({
        parent: el,
        name: baseName(path),
        text: buffered ?? saved,
        theme: themeRef.current,
        livePreview: livePreviewRef.current,
        onChange: (text) => {
          buffersRef.current.set(docKey, text === saved ? null : text);
          setSavedNote(false);
        },
        onSave: (text) => {
          void window.cockpit
            .spaceRootWriteFile({ rootId, path, text: toDisk(text), expectedMtimeMs: mtimeMs })
            .then(
              (result) => {
                if (result.ok) {
                  saved = text;
                  mtimeMs = result.value.mtimeMs;
                  buffersRef.current.set(docKey, null);
                  setSaveError(null);
                  setSavedNote(true);
                } else {
                  setSaveError(result.error.message);
                }
              },
              (caught: unknown) => setSaveError(String(caught)),
            );
        },
      });
      setStatus({ kind: 'ready' });
    })();
    return () => {
      cancelled = true;
      viewRef.current?.destroy();
      viewRef.current = null;
      el.replaceChildren();
    };
  }, [docKey, rootId, path]);

  useEffect(() => {
    viewRef.current?.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    viewRef.current?.setLivePreview(livePreview);
  }, [livePreview]);

  return (
    <div style={bodyStyle}>
      <div ref={hostRef} style={hostStyle} data-testid="files-editor-cm-host" />
      {status.kind !== 'ready' ? (
        <output style={noticeStyle} data-testid={`files-editor-status-${status.kind}`}>
          {status.kind === 'loading'
            ? 'Reading…'
            : status.kind === 'not-text'
              ? status.sentence
              : `The file could not be read: ${status.message}`}
        </output>
      ) : null}
      {saveError !== null ? (
        <div style={saveErrorStyle} data-testid="files-editor-save-error" role="alert">
          Not saved: {saveError}
        </div>
      ) : null}
      {savedNote && saveError === null ? (
        <output style={savedStyle} data-testid="files-editor-saved">
          Saved.
        </output>
      ) : null}
    </div>
  );
}
