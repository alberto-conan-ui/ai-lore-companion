/**
 * CodeMirror 6 builders for the in-app editor.
 *
 * Two postures. The **diff** + **triple** surfaces are read-only views, built
 * `readOnly` + non-editable, comparing a file against a save-point/ack (via
 * `@codemirror/merge`). The **edit** surface (`makeEditView`, markdown authoring
 * P3) is a live, editable document that saves back to disk and re-themes in
 * place — it is **persistent** (theme rides a `Compartment`, not a rebuild) so a
 * cursor / undo history / unsaved buffer survive a theme toggle.
 */

import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { yaml } from '@codemirror/lang-yaml';
import { MergeView } from '@codemirror/merge';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { markdownLivePreview } from './livePreview.js';

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

/** The editor theme. Dark rides `oneDark`; light uses CodeMirror's built-in
 *  light styling (basicSetup's default highlight) so the editor matches the
 *  app's light palette. Threaded from the caller's effective theme. */
export type EditorTheme = 'dark' | 'light';

/** Shared read-only extension set for one document. */
function readOnlyExtensions(name: string, theme: EditorTheme = 'dark'): Extension[] {
  return [
    basicSetup,
    ...languageFor(name),
    ...(theme === 'light' ? [] : [oneDark]),
    fitTheme,
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
  ];
}

/** Build a read-only single-document view of `text` into `parent`. */
export function makeCodeView(
  parent: HTMLElement,
  name: string,
  text: string,
  theme: EditorTheme = 'dark',
): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({ doc: text, extensions: readOnlyExtensions(name, theme) }),
  });
}

/** The dark-vs-light editor styling, as a single extension — `oneDark` when
 *  dark, CodeMirror's built-in light highlighting (nothing extra) when light.
 *  Held in a `Compartment` by the edit view so a theme toggle reconfigures in
 *  place instead of rebuilding the editor. */
function themeExtension(theme: EditorTheme): Extension {
  return theme === 'light' ? [] : oneDark;
}

/** A live editable document, returned by {@link makeEditView}. The view persists
 *  across theme + live-preview toggles — both reconfigure in place, so the
 *  cursor / undo / unsaved buffer survive. */
export type EditView = {
  view: EditorView;
  /** Reconfigure the palette without rebuilding (preserves cursor / undo). */
  setTheme: (theme: EditorTheme) => void;
  /** Turn the markdown live-preview on/off in place (markdown docs only). */
  setLivePreview: (on: boolean) => void;
  destroy: () => void;
};

/**
 * Build a live, **editable** document of `text` into `parent` (markdown
 * authoring, P3). Unlike {@link makeCodeView} this is not read-only: edits flow
 * to `onChange` (the raw document string, for the dirty/buffer model) and
 * `Cmd/Ctrl-S` calls `onSave` with the current text. The view is persistent —
 * the theme rides a `Compartment`, so `setTheme` re-themes in place and the
 * cursor, undo history, and unsaved buffer all survive. Long prose lines wrap.
 */
export function makeEditView(opts: {
  parent: HTMLElement;
  name: string;
  text: string;
  theme?: EditorTheme;
  /** Start with markdown live-preview on (markdown docs only). */
  livePreview?: boolean;
  onChange: (text: string) => void;
  onSave: (text: string) => void;
}): EditView {
  const themeComp = new Compartment();
  const previewComp = new Compartment();
  const view = new EditorView({
    parent: opts.parent,
    state: EditorState.create({
      doc: opts.text,
      extensions: [
        // The save keymap sits above basicSetup so Cmd/Ctrl-S is ours, not the
        // browser's; `preventDefault` stops Electron's native save dialog.
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: (v) => {
              opts.onSave(v.state.doc.toString());
              return true;
            },
          },
        ]),
        basicSetup,
        ...languageFor(opts.name),
        EditorView.lineWrapping,
        themeComp.of(themeExtension(opts.theme ?? 'dark')),
        previewComp.of(opts.livePreview ? markdownLivePreview() : []),
        fitTheme,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) opts.onChange(u.state.doc.toString());
        }),
      ],
    }),
  });
  return {
    view,
    setTheme: (theme) => view.dispatch({ effects: themeComp.reconfigure(themeExtension(theme)) }),
    setLivePreview: (on) =>
      view.dispatch({ effects: previewComp.reconfigure(on ? markdownLivePreview() : []) }),
    destroy: () => view.destroy(),
  };
}

/** One column of the "All 3" view: either a read-only code pane (`text`) or a
 *  full-pane description of a structural change (`note`) — a move/add/delete,
 *  where showing the file's text would be a blank or a confusing duplicate. */
export type TriplePane = { label: string; text?: string; note?: string };

/** A `note` pane: a centred, muted message that fills the column. */
const noteCss =
  'flex:1;display:flex;align-items:center;justify-content:center;padding:1.25rem;text-align:center;white-space:pre-wrap;color:var(--color-text-dim);font-size:0.78rem;line-height:1.55;';

/**
 * Build three labelled read-only panes side by side (e.g. parent · commit ·
 * current) — the "All 3" history view. CodeMirror's merge addon is two-way, so
 * the text panes are plain read-only views (no cross-pane highlighting); the
 * value is seeing the three versions of the file at once. A pane carrying a
 * `note` instead of `text` renders that message full-pane — used when the picked
 * commit *moved*, *added*, or *deleted* the file, so the pane explains the
 * structural change rather than showing a blank or a duplicate. Returns a
 * disposer.
 */
export function makeTripleView(
  parent: HTMLElement,
  name: string,
  panes: TriplePane[],
  theme: EditorTheme = 'dark',
): { destroy: () => void } {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex:1;min-width:0;min-height:0;height:100%;';
  // Build the column DOM first, collecting each host with its pane spec.
  const slots: { host: HTMLDivElement; pane: TriplePane }[] = [];
  panes.forEach((p, i) => {
    const col = document.createElement('div');
    col.style.cssText = `display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;${
      i < panes.length - 1 ? 'border-right:1px solid var(--color-border);' : ''
    }`;
    const head = document.createElement('div');
    head.textContent = p.label;
    head.style.cssText =
      'flex:none;padding:0.3rem 0.6rem;font-size:0.62rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--color-text-muted);background:var(--color-header);border-bottom:1px solid var(--color-border);';
    const host = document.createElement('div');
    host.style.cssText = 'flex:1;min-width:0;min-height:0;overflow:hidden;';
    col.appendChild(head);
    col.appendChild(host);
    wrap.appendChild(col);
    slots.push({ host, pane: p });
  });
  // Attach to the document *before* creating the editors — CodeMirror measures
  // on construction, so a detached host would render blank until a later resize.
  parent.appendChild(wrap);
  const views: EditorView[] = [];
  for (const { host, pane } of slots) {
    if (pane.note != null) {
      const msg = document.createElement('div');
      msg.style.cssText = noteCss;
      msg.textContent = pane.note;
      host.appendChild(msg);
    } else {
      views.push(makeCodeView(host, name, pane.text ?? '', theme));
    }
  }
  return {
    destroy: () => {
      for (const v of views) v.destroy();
      wrap.remove();
    },
  };
}

/**
 * A full-surface muted notice. Used when a two-way diff's two sides are
 * byte-identical: `@codemirror/merge` collapses every line into an "N unchanged
 * lines" stub, which reads as a broken or empty diff. This says so plainly —
 * e.g. "no differences", or that the picked commit only *moved* the file.
 */
export function makeNoticeView(parent: HTMLElement, message: string): { destroy: () => void } {
  const el = document.createElement('div');
  el.style.cssText =
    'height:100%;width:100%;display:flex;align-items:center;justify-content:center;padding:1.25rem;text-align:center;white-space:pre-wrap;color:var(--color-text-dim);font-size:0.82rem;line-height:1.6;';
  el.textContent = message;
  parent.appendChild(el);
  return { destroy: () => el.remove() };
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
  theme: EditorTheme = 'dark',
): MergeView {
  return new MergeView({
    parent,
    a: { doc: baselineText, extensions: readOnlyExtensions(name, theme) },
    b: { doc: currentText, extensions: readOnlyExtensions(name, theme) },
    collapseUnchanged: { margin: 3, minSize: 4 },
    highlightChanges: true,
    gutter: true,
  });
}

/** Column header styling, shared by the triple views. */
const paneHeadCss =
  'flex:none;padding:0.3rem 0.6rem;font-size:0.62rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--color-text-muted);background:var(--color-header);border-bottom:1px solid var(--color-border);';
const paneBorderR = 'border-right:1px solid var(--color-border);';

/**
 * The "All 3" view with a **diff lens**: three columns (before · this commit ·
 * current), but one *boundary* is a highlighted two-way diff while the third
 * column sits plain beside it for reference. `boundary: 'before'` highlights
 * before↔commit (what the commit changed); `'current'` highlights
 * commit↔current (what changed since). `@codemirror/merge` is two-way, so only
 * one boundary can be highlighted at a time — the toggle moves the lens. A pane
 * carrying a `note` (move/add/delete) renders that message instead of text.
 * Returns a disposer.
 */
export function makeTripleDiffView(
  parent: HTMLElement,
  name: string,
  panes: { before: TriplePane; commit: TriplePane; current: TriplePane },
  boundary: 'before' | 'current',
  theme: EditorTheme = 'dark',
): { destroy: () => void } {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex:1;min-width:0;min-height:0;height:100%;';
  // CodeMirror measures on construction, so build the DOM, attach, *then* run
  // these constructors against hosts already in the document.
  const builders: (() => { destroy: () => void })[] = [];

  const fillHost = (host: HTMLDivElement, p: TriplePane): void => {
    if (p.note != null) {
      const msg = document.createElement('div');
      msg.style.cssText =
        'flex:1;display:flex;align-items:center;justify-content:center;padding:1.25rem;text-align:center;white-space:pre-wrap;color:var(--color-text-dim);font-size:0.78rem;line-height:1.55;';
      builders.push(() => {
        host.appendChild(msg);
        return { destroy: () => msg.remove() };
      });
    } else {
      const text = p.text ?? '';
      builders.push(() => {
        const v = makeCodeView(host, name, text, theme);
        return { destroy: () => v.destroy() };
      });
    }
  };

  // A single plain column: header + (code or note).
  const plainColumn = (p: TriplePane, withBorder: boolean): HTMLDivElement => {
    const col = document.createElement('div');
    col.style.cssText = `display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;${withBorder ? paneBorderR : ''}`;
    const head = document.createElement('div');
    head.textContent = p.label;
    head.style.cssText = paneHeadCss;
    const host = document.createElement('div');
    host.style.cssText = 'flex:1;min-width:0;min-height:0;overflow:hidden;';
    col.append(head, host);
    fillHost(host, p);
    return col;
  };

  // The highlighted pair: two headers over one MergeView (a | b).
  const mergedPair = (a: TriplePane, b: TriplePane, withBorder: boolean): HTMLDivElement => {
    const group = document.createElement('div');
    group.style.cssText = `display:flex;flex-direction:column;flex:2;min-width:0;min-height:0;${withBorder ? paneBorderR : ''}`;
    const heads = document.createElement('div');
    heads.style.cssText = 'display:flex;flex:none;';
    const h1 = document.createElement('div');
    h1.textContent = a.label;
    h1.style.cssText = `${paneHeadCss}flex:1;${paneBorderR}`;
    const h2 = document.createElement('div');
    h2.textContent = b.label;
    h2.style.cssText = `${paneHeadCss}flex:1;`;
    heads.append(h1, h2);
    const host = document.createElement('div');
    host.style.cssText = 'flex:1;min-width:0;min-height:0;overflow:hidden;';
    group.append(heads, host);
    builders.push(() => {
      const mv = makeDiffView(host, name, a.text ?? '', b.text ?? '', theme);
      return { destroy: () => mv.destroy() };
    });
    return group;
  };

  if (boundary === 'before') {
    wrap.append(mergedPair(panes.before, panes.commit, true), plainColumn(panes.current, false));
  } else {
    wrap.append(plainColumn(panes.before, true), mergedPair(panes.commit, panes.current, false));
  }
  parent.appendChild(wrap);
  const built = builders.map((b) => b());
  return {
    destroy: () => {
      for (const x of built) x.destroy();
      wrap.remove();
    },
  };
}
