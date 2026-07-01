/**
 * Markdown **live-preview** for the editable editor (P3, de-risked by S0 Probe B).
 *
 * A **decoration-only** CodeMirror extension that renders markdown inline at
 * Typora/Obsidian grade *without touching the document*: syntax marks (`#`,
 * `**`, `` ` ``) are hidden on every line except the one the cursor is on, and
 * headings / bold / italic / inline-code get styled. Because decorations never
 * edit the text, the document stays the raw markdown byte-for-byte — a save
 * round-trips clean and git diffs stay honest.
 *
 * Per the S0 build note, decorations are collected into `Decoration.set(ranges,
 * true)` (the sorting form) — line, mark, and replace decorations that share a
 * position must sort by `from` **and** `startSide`, which only the sorted set
 * does; `RangeSetBuilder.add` in tree order would throw.
 */

import { syntaxTree } from '@codemirror/language';
import type { EditorState, Range } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';

/** The lezer-markdown mark nodes we hide off the active line. */
const MARK_NODES = new Set(['HeaderMark', 'EmphasisMark', 'CodeMark']);

/** A styled span over a node's content (bold / italic / inline-code). */
const STYLE_NODES: Record<string, string> = {
  StrongEmphasis: 'cm-md-strong',
  Emphasis: 'cm-md-em',
  InlineCode: 'cm-md-code',
};

/** Hides an inline syntax mark (the raw `#` / `**` / `` ` ``). */
const hideMark = Decoration.replace({});

/** The line numbers (1-based) any selection range touches — marks on these lines
 *  are *revealed* so you can edit the raw source where the cursor sits. */
function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
}

/** The heading level (1–6) for an `ATXHeading{n}` node name, or 0 if not one. */
function headingLevel(name: string): number {
  const m = /^ATXHeading([1-6])$/.exec(name);
  return m ? Number(m[1]) : 0;
}

/**
 * Compute the live-preview decorations for a document state: heading line
 * styles, bold/italic/code content styles, and hidden syntax marks (except on
 * the cursor's line). Pure over `state` — the ViewPlugin below just caches it —
 * so it can be unit-tested directly. Never mutates the document.
 */
export function computeLivePreviewDecorations(state: EditorState): DecorationSet {
  const active = activeLines(state);
  const ranges: Range<Decoration>[] = [];
  const tree = syntaxTree(state);
  tree.iterate({
    enter: (node) => {
      const level = headingLevel(node.name);
      if (level > 0) {
        const line = state.doc.lineAt(node.from);
        ranges.push(Decoration.line({ class: `cm-md-heading cm-md-h${level}` }).range(line.from));
        return;
      }
      const styleClass = STYLE_NODES[node.name];
      if (styleClass && node.to > node.from) {
        ranges.push(Decoration.mark({ class: styleClass }).range(node.from, node.to));
        return;
      }
      if (MARK_NODES.has(node.name) && node.to > node.from) {
        // Reveal the raw marks on the line the cursor is on; hide them elsewhere.
        const line = state.doc.lineAt(node.from);
        if (!active.has(line.number)) {
          let to = node.to;
          // A HeaderMark is just the `#`s — swallow the space(s) after it too, so
          // the rendered heading isn't indented by a stray leading space.
          if (node.name === 'HeaderMark') {
            const rest = state.doc.sliceString(node.to, line.to);
            to = node.to + (rest.length - rest.trimStart().length);
          }
          ranges.push(hideMark.range(node.from, to));
        }
      }
    },
  });
  // The sorting form — line / mark / replace decorations sharing a position must
  // sort by `from` AND `startSide`, which only `Decoration.set(ranges, true)` does.
  return Decoration.set(ranges, true);
}

/** The plugin: rebuild the decorations whenever the doc, selection, or viewport
 *  changes (selection change is what reveals/hides marks as the cursor moves). */
const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = computeLivePreviewDecorations(view.state);
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.selectionSet || u.viewportChanged) {
        this.decorations = computeLivePreviewDecorations(u.state);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** Editor styling for the live-preview classes. Uses the app's `--color-*`
 *  tokens so it follows light / dark automatically — no per-theme reconfigure. */
const livePreviewTheme = EditorView.baseTheme({
  '.cm-md-heading': { fontWeight: '700', lineHeight: '1.3' },
  '.cm-md-h1': { fontSize: '1.7em' },
  '.cm-md-h2': { fontSize: '1.5em' },
  '.cm-md-h3': { fontSize: '1.3em' },
  '.cm-md-h4': { fontSize: '1.15em' },
  '.cm-md-h5': { fontSize: '1.05em' },
  '.cm-md-h6': { fontSize: '1em', color: 'var(--color-text-muted)' },
  '.cm-md-strong': { fontWeight: '700' },
  '.cm-md-em': { fontStyle: 'italic' },
  '.cm-md-code': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.92em',
    background: 'var(--color-panel)',
    borderRadius: '3px',
    padding: '0 0.2em',
  },
});

/** The markdown live-preview extension — the decoration plugin plus its styling.
 *  Add it to a markdown editor to render inline; drop it to see raw source. */
export function markdownLivePreview(): [typeof livePreviewPlugin, typeof livePreviewTheme] {
  return [livePreviewPlugin, livePreviewTheme];
}
