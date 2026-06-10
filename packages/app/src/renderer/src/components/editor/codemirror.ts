/**
 * CodeMirror 6 builders for the in-app read-only viewer + diff (Read-only IDE).
 *
 * The app is **read-only** — every view here is built `readOnly` + non-editable,
 * so a file is *viewed*, never written back to disk. Two surfaces: a single
 * read-only document (`makeCodeView`) and a side-by-side diff against the
 * selected save-point/ack (`makeDiffView`, via `@codemirror/merge`).
 */

import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { yaml } from '@codemirror/lang-yaml';
import { MergeView } from '@codemirror/merge';
import { EditorState, type Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';

/** Language support for a filename, by extension. Falls back to plain text. */
export function languageFor(name: string): Extension[] {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  switch (ext) {
    case 'md':
    case 'markdown':
      return [markdown()];
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return [javascript({ jsx: true, typescript: ext === 'ts' || ext === 'tsx' })];
    case 'json':
      return [json()];
    case 'yaml':
    case 'yml':
      return [yaml()];
    default:
      return [];
  }
}

/** Sit the editor flush in its container and let the cockpit chrome show through
 *  oneDark's panel — a slightly darker scroller to match the app. */
const fitTheme = EditorView.theme({
  '&': { height: '100%' },
  '.cm-scroller': { overflow: 'auto' },
});

/** Shared read-only extension set for one document. */
function readOnlyExtensions(name: string): Extension[] {
  return [
    basicSetup,
    ...languageFor(name),
    oneDark,
    fitTheme,
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
  ];
}

/** Build a read-only single-document view of `text` into `parent`. */
export function makeCodeView(parent: HTMLElement, name: string, text: string): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({ doc: text, extensions: readOnlyExtensions(name) }),
  });
}

/**
 * Build a side-by-side read-only diff of the baseline (`a`, left) against the
 * current contents (`b`, right). Unchanged stretches collapse so the changes
 * read at a glance.
 */
export function makeDiffView(
  parent: HTMLElement,
  name: string,
  baselineText: string,
  currentText: string,
): MergeView {
  return new MergeView({
    parent,
    a: { doc: baselineText, extensions: readOnlyExtensions(name) },
    b: { doc: currentText, extensions: readOnlyExtensions(name) },
    collapseUnchanged: { margin: 3, minSize: 4 },
    highlightChanges: true,
    gutter: true,
  });
}
