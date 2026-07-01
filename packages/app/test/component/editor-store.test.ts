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
  useCockpitStore.setState({ editorDocs: [], activeDocPath: null, editorBuffers: {} });
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

test('restoreDocs replaces the open set and honours the saved active doc', () => {
  const { openDoc, restoreDocs } = useCockpitStore.getState();
  openDoc(doc('/p/stale.ts'));
  restoreDocs([doc('/p/a.ts'), doc('/p/b.ts', 'diff')], '/p/b.ts');
  const s = useCockpitStore.getState();
  expect(s.editorDocs.map((d) => d.path)).toEqual(['/p/a.ts', '/p/b.ts']);
  expect(s.activeDocPath).toBe('/p/b.ts');
});

test('restoreDocs falls back to the first doc when the saved active is gone', () => {
  useCockpitStore.getState().restoreDocs([doc('/p/a.ts'), doc('/p/b.ts')], '/p/missing.ts');
  expect(useCockpitStore.getState().activeDocPath).toBe('/p/a.ts');
});

test('restoreDocs with an empty set clears the editor', () => {
  useCockpitStore.getState().openDoc(doc('/p/a.ts'));
  useCockpitStore.getState().restoreDocs([], null);
  const s = useCockpitStore.getState();
  expect(s.editorDocs).toEqual([]);
  expect(s.activeDocPath).toBeNull();
});

// ── Dirty / buffer slice (markdown authoring, P3) ────────────────────────────

test('setDocBuffer records the buffer and marks the doc dirty', () => {
  const { openDoc, setDocBuffer } = useCockpitStore.getState();
  openDoc(doc('/p/a.ts'));
  setDocBuffer('/p/a.ts', 'edited text');
  const s = useCockpitStore.getState();
  expect(s.editorBuffers['/p/a.ts']).toBe('edited text');
  expect(s.editorDocs.find((d) => d.path === '/p/a.ts')?.dirty).toBe(true);
});

test('clearDocBuffer drops the buffer and clears dirty (save, or undo-to-saved)', () => {
  const { openDoc, setDocBuffer, clearDocBuffer } = useCockpitStore.getState();
  openDoc(doc('/p/a.ts'));
  setDocBuffer('/p/a.ts', 'edited');
  clearDocBuffer('/p/a.ts');
  const s = useCockpitStore.getState();
  expect('/p/a.ts' in s.editorBuffers).toBe(false);
  expect(s.editorDocs.find((d) => d.path === '/p/a.ts')?.dirty).toBeFalsy();
});

test('closeDoc drops the closed doc’s unsaved buffer', () => {
  const { openDoc, setDocBuffer, closeDoc } = useCockpitStore.getState();
  openDoc(doc('/p/a.ts'));
  openDoc(doc('/p/b.ts'));
  setDocBuffer('/p/a.ts', 'unsaved');
  closeDoc('/p/a.ts');
  expect('/p/a.ts' in useCockpitStore.getState().editorBuffers).toBe(false);
});

test('a buffer on one doc leaves its siblings clean', () => {
  const { openDoc, setDocBuffer } = useCockpitStore.getState();
  openDoc(doc('/p/a.ts'));
  openDoc(doc('/p/b.ts'));
  setDocBuffer('/p/b.ts', 'only b');
  const s = useCockpitStore.getState();
  expect(s.editorDocs.find((d) => d.path === '/p/a.ts')?.dirty).toBeFalsy();
  expect(s.editorDocs.find((d) => d.path === '/p/b.ts')?.dirty).toBe(true);
  expect('/p/a.ts' in s.editorBuffers).toBe(false);
});
