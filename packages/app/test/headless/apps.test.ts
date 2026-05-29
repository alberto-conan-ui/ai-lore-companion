import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { registerApps } from '../../src/main/ipc/apps.js';
import { loadGlobalSettings } from '../../src/main/settings.js';
import { type Harness, fakeContext, harnessFor } from './harness.js';

let h: Harness;

beforeEach(() => {
  h = harnessFor(registerApps);
  h.setCtx(fakeContext({ root: '/proj', lorePath: '/proj/.ai-lore-proj' }));
});

afterEach(() => {
  h.cleanup();
});

const validApp = {
  id: 'a1',
  label: 'My App',
  kind: 'app',
  target: 'file',
  appPath: '/Applications/Foo.app',
};

test('appsInvoke returns not-found when the app id is unknown', () => {
  assert.deepEqual(h.invoke('appsInvoke', { appId: 'nope', path: '/x' }), { kind: 'not-found' });
});

test('appsSave persists the catalog, broadcasts, and returns the snapshot', () => {
  const snapshot = h.invoke('appsSave', [validApp]);
  assert.equal(snapshot, h.settingsSnapshot, 'returns the settings snapshot');
  assert.equal(h.broadcasts.settings.calls.length, 1, 'broadcastSettings fired once');
  const persisted = loadGlobalSettings(h.userDataDir).apps ?? [];
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0]?.id, 'a1');
  assert.equal(persisted[0]?.appPath, '/Applications/Foo.app');
});

test('appsSave drops entries that fail the parse gate', () => {
  // A valid app, an app-kind entry missing appPath, and a non-entry — only the
  // first survives `parseAppEntries`.
  h.invoke('appsSave', [
    validApp,
    { id: 'a2', label: 'No Path', kind: 'app', target: 'file' },
    { nope: 1 },
  ]);
  const persisted = loadGlobalSettings(h.userDataDir).apps ?? [];
  assert.equal(persisted.length, 1, 'malformed entries dropped');
  assert.equal(persisted[0]?.id, 'a1');
});
