import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { registerSettings } from '../../src/main/ipc/settings.js';
import { resetElectronStub } from './electron-stub.js';
import { type Harness, fakeContext, harnessFor } from './harness.js';

let h: Harness;
let root: string;
let lorePath: string;

beforeEach(() => {
  resetElectronStub();
  h = harnessFor(registerSettings);
  root = mkdtempSync(join(tmpdir(), 'cockpit-settings-'));
  lorePath = join(root, '.ai-lore-proj');
  mkdirSync(join(lorePath, 'memory', 'status'), { recursive: true });
  h.setCtx(fakeContext({ root, lorePath }));
});

afterEach(() => {
  h.cleanup();
  rmSync(root, { recursive: true, force: true });
});

test('settingsGet returns the snapshot', () => {
  assert.equal(h.invoke('settingsGet'), h.settingsSnapshot);
});

test('settingsSet rejects an unknown key without persisting or broadcasting', () => {
  const result = h.invoke('settingsSet', { tier: 'global', key: '__nope__', value: 1 });
  assert.equal(result, h.settingsSnapshot);
  assert.equal(h.broadcasts.settings.calls.length, 0);
});

test('settingsSetIgnores broadcasts and returns the snapshot', () => {
  const result = h.invoke('settingsSetIgnores', { tier: 'global', rules: [] });
  assert.equal(result, h.settingsSnapshot);
  assert.equal(h.broadcasts.settings.calls.length, 1);
});

test('setRegister writes the posture to the status frontmatter', () => {
  const statusPath = join(lorePath, 'memory', 'status', 'status.index.md');
  writeFileSync(
    statusPath,
    ['---', 'posture: execute', 'dials:', '  altitude: high', '---', '', '# Status', ''].join('\n'),
  );
  h.invoke('setRegister', { field: 'posture', value: 'chat' });
  assert.match(readFileSync(statusPath, 'utf8'), /posture: chat/);
});

test('setRegister is a no-op with no project context', () => {
  h.setCtx(undefined);
  assert.equal(h.invoke('setRegister', { field: 'posture', value: 'chat' }), undefined);
});

test('focusRead refuses a path that escapes the project', () => {
  assert.deepEqual(h.invoke('focusRead', { path: '../../etc/passwd' }), {
    error: 'path is outside the project',
  });
});

test('focusRead fails cleanly with no project context', () => {
  h.setCtx(undefined);
  assert.deepEqual(h.invoke('focusRead', { path: 'x.md' }), { error: 'no project context' });
});

test('focusRead parses a focus file in the project into frontmatter + sections', () => {
  const file = join(root, 'demo.focus.md');
  writeFileSync(
    file,
    [
      '---',
      'type: focus',
      'title: Demo',
      'updated: 2026-05-29',
      'references: []',
      'status: Active',
      'focus_type: build',
      '---',
      '',
      '# Demo',
      '',
      '## Gate',
      '',
      'a gate',
      '',
    ].join('\n'),
  );
  const result = h.invoke('focusRead', { path: file }) as {
    error?: string;
    frontmatter?: Record<string, unknown>;
  };
  assert.equal(result.error, undefined);
  assert.equal(result.frontmatter?.type, 'focus');
  assert.equal(result.frontmatter?.title, 'Demo');
});
