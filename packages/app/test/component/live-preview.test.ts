import { markdown } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import type { Decoration } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { computeLivePreviewDecorations } from '../../src/renderer/src/components/editor/livePreview.js';

/** A parsed markdown state with the cursor at `cursor` (default: end). */
function stateFor(doc: string, cursor = doc.length): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.single(cursor),
    extensions: [markdown()],
  });
}

type Deco = { from: number; to: number; kind: 'line' | 'mark' | 'hide'; cls?: string };

/** Flatten the decoration set to plain descriptors. A decoration with no `class`
 *  is a `Decoration.replace` (a hidden mark); a zero-length one with a class is a
 *  line decoration; a spanning one with a class is a styled mark. */
function decosFor(state: EditorState): Deco[] {
  const set = computeLivePreviewDecorations(state);
  const out: Deco[] = [];
  const cur = set.iter();
  while (cur.value) {
    const cls = (cur.value as Decoration).spec.class as string | undefined;
    const kind = !cls ? 'hide' : cur.from === cur.to ? 'line' : 'mark';
    out.push({ from: cur.from, to: cur.to, kind, cls });
    cur.next();
  }
  return out;
}

describe('markdown live-preview decorations', () => {
  it('never touches the document (byte-identical round-trip)', () => {
    const doc = '# Title\n\nSome **bold** and `code`.\n';
    const state = stateFor(doc, doc.length);
    computeLivePreviewDecorations(state);
    expect(state.doc.toString()).toBe(doc);
  });

  it('styles a heading line and hides its `# ` mark when the cursor is elsewhere', () => {
    const doc = '# Title\n\nbody';
    const decos = decosFor(stateFor(doc, doc.length)); // cursor on line 3
    const heading = decos.find((d) => d.kind === 'line' && d.cls?.includes('cm-md-h1'));
    expect(heading).toBeTruthy();
    expect(heading?.from).toBe(0); // line 1 start
    // The `# ` (mark + following space) is hidden — a replace over [0, 2).
    const hide = decos.find((d) => d.kind === 'hide' && d.from === 0);
    expect(hide).toBeTruthy();
    expect(hide?.to).toBe(2);
  });

  it('reveals the marks on the cursor’s line (Typora-style)', () => {
    const doc = '# Title\n\nbody';
    // Cursor on line 1 (the heading) → its `#` mark is NOT hidden.
    const decos = decosFor(stateFor(doc, 1));
    expect(decos.some((d) => d.kind === 'hide')).toBe(false);
    // The heading line style still applies while editing it.
    expect(decos.some((d) => d.kind === 'line' && d.cls?.includes('cm-md-h1'))).toBe(true);
  });

  it('styles bold and hides its `**` marks off the active line', () => {
    const doc = '**bold**\n\nbody';
    const decos = decosFor(stateFor(doc, doc.length)); // cursor on line 3
    expect(decos.some((d) => d.kind === 'mark' && d.cls === 'cm-md-strong')).toBe(true);
    // Two `**` marks hidden (open + close), each a 2-char replace on line 1.
    const hides = decos.filter((d) => d.kind === 'hide');
    expect(hides.length).toBe(2);
    expect(hides.every((h) => h.to - h.from === 2)).toBe(true);
  });

  it('styles inline code and hides its backticks off the active line', () => {
    const doc = 'text `code` here\n\nbody';
    const decos = decosFor(stateFor(doc, doc.length));
    expect(decos.some((d) => d.kind === 'mark' && d.cls === 'cm-md-code')).toBe(true);
    const hides = decos.filter((d) => d.kind === 'hide');
    expect(hides.length).toBe(2); // the two backticks
  });
});
