import { beforeEach, expect, test } from 'vitest';
import { type EditorDoc, useCockpitStore } from '../../src/renderer/src/store.js';

/** The in-app editor's open-docs slice (Read-only IDE). Drives the nav | editor
 *  split: non-empty → the editor column shows; empty → it collapses. */

const doc = (path: string, mode: EditorDoc['mode'] = 'code'): EditorDoc => ({
  path,
  scope: 'payload',
  name: path.slice(path.lastIndexOf('/') + 1),
  mode,
});

beforeEach(() => {
  useCockpitStore.setState({ editorDocs: [], activeDocPath: null });
});

test('openDoc adds a doc and focuses it', () => {
  useCockpitStore.getState().openDoc(doc('/p/a.ts'));
  const s = useCockpitStore.getState();
  expect(s.editorDocs.map((d) => d.path)).toEqual(['/p/a.ts']);
  expect(s.activeDocPath).toBe('/p/a.ts');
});

test('re-opening updates the mode and refocuses without duplicating', () => {
  const { openDoc } = useCockpitStore.getState();
  openDoc(doc('/p/a.ts'));
  openDoc(doc('/p/b.ts'));
  openDoc(doc('/p/a.ts', 'diff'));
  const s = useCockpitStore.getState();
  expect(s.editorDocs.length).toBe(2);
  expect(s.editorDocs.find((d) => d.path === '/p/a.ts')?.mode).toBe('diff');
  expect(s.activeDocPath).toBe('/p/a.ts');
});

test('closeDoc focuses the neighbour, then clears when the last closes', () => {
  const { openDoc, closeDoc } = useCockpitStore.getState();
  openDoc(doc('/p/a.ts'));
  openDoc(doc('/p/b.ts'));
  closeDoc('/p/b.ts');
  expect(useCockpitStore.getState().activeDocPath).toBe('/p/a.ts');
  closeDoc('/p/a.ts');
  const s = useCockpitStore.getState();
  expect(s.editorDocs).toEqual([]);
  expect(s.activeDocPath).toBeNull();
});

test('setDocMode flips one doc; setActiveDoc moves focus', () => {
  const { openDoc, setDocMode, setActiveDoc } = useCockpitStore.getState();
  openDoc(doc('/p/a.ts'));
  openDoc(doc('/p/b.ts'));
  setDocMode('/p/a.ts', 'diff');
  setActiveDoc('/p/a.ts');
  const s = useCockpitStore.getState();
  expect(s.editorDocs.find((d) => d.path === '/p/a.ts')?.mode).toBe('diff');
  expect(s.editorDocs.find((d) => d.path === '/p/b.ts')?.mode).toBe('code');
  expect(s.activeDocPath).toBe('/p/a.ts');
});
