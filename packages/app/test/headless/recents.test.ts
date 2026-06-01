import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { addRecent, loadRecents, recentMenuLabel, removeRecent } from '../../src/main/recents.js';

test('recentMenuLabel folds the parent path into the label, tilde-abbreviated', () => {
  const home = homedir();
  // Two same-named projects in different parents are now distinguishable.
  assert.equal(
    recentMenuLabel(join(home, 'work', 'clients', 'acme', 'Iberia_2026')),
    'Iberia_2026 — ~/work/clients/acme',
  );
  assert.equal(recentMenuLabel(join(home, 'personal', 'Iberia_2026')), 'Iberia_2026 — ~/personal');
});

test('recentMenuLabel shows a bare ~ when the project sits directly in home', () => {
  assert.equal(recentMenuLabel(join(homedir(), 'my-project')), 'my-project — ~');
});

test('recentMenuLabel leaves a path outside home un-abbreviated', () => {
  assert.equal(recentMenuLabel('/opt/work/widget'), 'widget — /opt/work');
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cockpit-recents-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test('removeRecent drops one entry and leaves the rest, returning the new list', () => {
  addRecent(dir, '/a/one');
  addRecent(dir, '/a/two');
  addRecent(dir, '/a/three');
  const next = removeRecent(dir, '/a/two');
  assert.deepEqual(
    next.map((r) => r.path),
    ['/a/three', '/a/one'],
  );
  // Persisted, not just returned.
  assert.deepEqual(
    loadRecents(dir).map((r) => r.path),
    ['/a/three', '/a/one'],
  );
});

test('removeRecent is a no-op for a path that is not in the list', () => {
  addRecent(dir, '/a/one');
  const next = removeRecent(dir, '/a/missing');
  assert.deepEqual(
    next.map((r) => r.path),
    ['/a/one'],
  );
});
