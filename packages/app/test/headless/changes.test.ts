import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { registerChanges } from '../../src/main/ipc/changes.js';
import type { Wiring } from '../../src/main/ipc/types.js';
import { type Harness, type Spy, fakeContext, harnessFor, spy } from './harness.js';

let h: Harness;
let setBaseline: Spy<[string, string]>;

/** A wiring stub whose only live part is a spied `changes.setBaseline`. */
function fakeWiring(): Wiring {
  setBaseline = spy<[string, string]>();
  return {
    watcher: {} as unknown as Wiring['watcher'],
    changes: { setBaseline } as unknown as Wiring['changes'],
    pushCommits: () => {},
    pushSavePoints: () => {},
  };
}

beforeEach(() => {
  h = harnessFor(registerChanges);
  h.setCtx(fakeContext({ root: '/proj', lorePath: '/proj/.ai-lore-proj', wiring: fakeWiring() }));
});

afterEach(() => {
  h.cleanup();
});

test('setBaseline forwards scope + baseline to the changes tracker', () => {
  h.invoke('setBaseline', { scope: 'payload', baseline: 'abc123' });
  assert.deepEqual(setBaseline.calls, [['payload', 'abc123']]);
});

test('diffText fails cleanly with no project context', () => {
  h.setCtx(undefined);
  assert.deepEqual(h.invoke('diffText', { scope: 'payload', relPath: 'a.ts', baseline: 'HEAD' }), {
    kind: 'failed',
    message: 'no project context',
  });
});

test('openDiff fails cleanly with no project context', () => {
  h.setCtx(undefined);
  assert.deepEqual(h.invoke('openDiff', { scope: 'payload', relPath: 'a.ts', baseline: 'HEAD' }), {
    kind: 'failed',
    message: 'no project context',
  });
});

test('openDiff returns no-cli when no diff app is configured', () => {
  const result = h.invoke('openDiff', { scope: 'payload', relPath: 'a.ts', baseline: 'abc123' });
  assert.deepEqual(result, { kind: 'no-cli' });
});

test('readFileBaseline fails cleanly with no project context', () => {
  h.setCtx(undefined);
  assert.deepEqual(
    h.invoke('readFileBaseline', { scope: 'payload', relPath: 'a.ts', baseline: 'HEAD' }),
    { kind: 'failed', message: 'no project context' },
  );
});

test('readFileBaseline reports no-save-point when HEAD resolves to none', () => {
  // The fake context's lore dir has no save-point ledger, so HEAD has nothing
  // to fall back to — same resolution openDiff uses.
  assert.deepEqual(
    h.invoke('readFileBaseline', { scope: 'payload', relPath: 'a.ts', baseline: 'HEAD' }),
    { kind: 'no-save-point' },
  );
});

test('fileHistory fails cleanly with no project context', () => {
  h.setCtx(undefined);
  assert.deepEqual(h.invoke('fileHistory', { scope: 'payload', relPath: 'a.ts' }), {
    kind: 'failed',
    message: 'no project context',
  });
});

test('readFileBaseline refuses a path that escapes the repo working tree', () => {
  const r = h.invoke('readFileBaseline', {
    scope: 'payload',
    relPath: '../../../etc/passwd',
    baseline: 'abc123',
  }) as { kind: string };
  assert.equal(r.kind, 'failed');
});
