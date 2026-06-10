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
 * Build three labelled read-only panes side by side (e.g. parent · commit ·
 * current) — the "All 3" history view. CodeMirror's merge addon is two-way, so
 * these panes are plain read-only views (no cross-pane highlighting); the value
 * is seeing the three versions of the file at once. Returns a disposer.
 */
export function makeTripleView(
  parent: HTMLElement,
  name: string,
  panes: { label: string; text: string }[],
): { destroy: () => void } {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex:1;min-width:0;min-height:0;height:100%;';
  // Build the column DOM first, collecting each host with its text.
  const slots: { host: HTMLDivElement; text: string }[] = [];
  panes.forEach((p, i) => {
    const col = document.createElement('div');
    col.style.cssText = `display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;${
      i < panes.length - 1 ? 'border-right:1px solid #1f2933;' : ''
    }`;
    const head = document.createElement('div');
    head.textContent = p.label;
    head.style.cssText =
      'flex:none;padding:0.3rem 0.6rem;font-size:0.62rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6c7783;background:#0f1620;border-bottom:1px solid #1f2933;';
    const host = document.createElement('div');
    host.style.cssText = 'flex:1;min-width:0;min-height:0;overflow:hidden;';
    col.appendChild(head);
    col.appendChild(host);
    wrap.appendChild(col);
    slots.push({ host, text: p.text });
  });
  // Attach to the document *before* creating the editors — CodeMirror measures
  // on construction, so a detached host would render blank until a later resize.
  parent.appendChild(wrap);
  const views = slots.map(({ host, text }) => makeCodeView(host, name, text));
  return {
    destroy: () => {
      for (const v of views) v.destroy();
      wrap.remove();
    },
  };
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
