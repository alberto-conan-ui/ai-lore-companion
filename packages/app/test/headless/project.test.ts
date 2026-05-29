import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { registerProject } from '../../src/main/ipc/project.js';
import { resetElectronStub, setFakeWindow, shell } from './electron-stub.js';
import { type Harness, fakeContext, harnessFor } from './harness.js';

let h: Harness;

beforeEach(() => {
  resetElectronStub();
  h = harnessFor(registerProject);
  h.setCtx(fakeContext({ root: '/proj', lorePath: '/proj/.ai-lore-proj' }));
});

afterEach(() => {
  h.cleanup();
});

test('openProject with a path routes through showProject', async () => {
  await h.invoke('openProject', '/some/project');
  assert.equal(h.actions.showProject.calls.length, 1);
  assert.equal(h.actions.showProject.calls[0]?.[1], '/some/project');
  assert.equal(h.actions.promptAndOpenProject.calls.length, 0);
});

test('openProject with no path prompts for a folder', async () => {
  await h.invoke('openProject', '');
  assert.equal(h.actions.promptAndOpenProject.calls.length, 1);
  assert.equal(h.actions.showProject.calls.length, 0);
});

test('reload reloads the calling window', async () => {
  await h.invoke('reload');
  assert.equal(h.actions.reloadWindow.calls.length, 1);
});

test('reload is a no-op when the sender has no window', async () => {
  setFakeWindow(null);
  await h.invoke('reload');
  assert.equal(h.actions.reloadWindow.calls.length, 0);
});

test('openExternal delegates to shell.openExternal', () => {
  h.invoke('openExternal', 'https://example.com');
  assert.deepEqual(shell.openExternal.calls, [['https://example.com']]);
});
