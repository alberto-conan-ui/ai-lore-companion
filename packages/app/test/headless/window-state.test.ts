import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { projectDataDir } from '../../src/main/db-path.js';
import { loadWindowBounds, saveWindowBounds } from '../../src/main/window-state.js';

let userDataDir: string;
const root = '/some/project/root';

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'cockpit-winstate-'));
});
afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true });
});

test('saveWindowBounds then loadWindowBounds round-trips', () => {
  const bounds = { x: 120, y: 80, width: 1440, height: 900 };
  saveWindowBounds(userDataDir, root, bounds);
  assert.deepEqual(loadWindowBounds(userDataDir, root), bounds);
});

test('loadWindowBounds returns null when none is stored', () => {
  assert.equal(loadWindowBounds(userDataDir, root), null);
});

test('loadWindowBounds rejects corrupt / degenerate bounds', () => {
  const path = join(projectDataDir(userDataDir, root), 'window-state.json');
  // Non-positive extent → rejected.
  saveWindowBounds(userDataDir, root, { x: 0, y: 0, width: 1000, height: 700 });
  writeFileSync(path, JSON.stringify({ x: 0, y: 0, width: 0, height: 700 }));
  assert.equal(loadWindowBounds(userDataDir, root), null);
  // Garbage JSON → rejected, not thrown.
  writeFileSync(path, 'not json');
  assert.equal(loadWindowBounds(userDataDir, root), null);
});
