import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  type AppEntry,
  appsForNode,
  findDiffApp,
  isAppEntry,
  parseAppEntries,
  parseAppEntry,
} from '../src/index.js';

const vsCode: AppEntry = {
  id: 'vscode',
  label: 'VS Code',
  kind: 'app',
  target: 'both',
  appPath: '/Applications/Visual Studio Code.app',
};

const ksdiff: AppEntry = {
  id: 'ksdiff',
  label: 'Kaleidoscope',
  kind: 'cli',
  target: 'file',
  cliPath: '/usr/local/bin/ksdiff',
  argvTemplate: '{baseline} {current}',
  role: 'diff',
};

const finder: AppEntry = {
  id: 'finder',
  label: 'Finder',
  kind: 'app',
  target: 'folder',
  appPath: '/System/Library/CoreServices/Finder.app',
};

test('isAppEntry accepts a valid kind=app entry', () => {
  assert.equal(isAppEntry(vsCode), true);
});

test('isAppEntry accepts a valid kind=cli entry', () => {
  assert.equal(isAppEntry(ksdiff), true);
});

test('isAppEntry rejects an app entry missing appPath', () => {
  assert.equal(isAppEntry({ ...vsCode, appPath: undefined }), false);
});

test('isAppEntry rejects a cli entry missing cliPath or argvTemplate', () => {
  assert.equal(isAppEntry({ ...ksdiff, cliPath: undefined }), false);
  assert.equal(isAppEntry({ ...ksdiff, argvTemplate: undefined }), false);
});

test('isAppEntry rejects unknown kind / target / role values', () => {
  assert.equal(isAppEntry({ ...vsCode, kind: 'browser' }), false);
  assert.equal(isAppEntry({ ...vsCode, target: 'anything' }), false);
  assert.equal(isAppEntry({ ...ksdiff, role: 'merge' }), false);
});

test('parseAppEntry drops unknown fields but keeps the canonical shape', () => {
  const parsed = parseAppEntry({ ...vsCode, extra: 'ignored' });
  assert.equal(parsed?.id, 'vscode');
  assert.equal((parsed as unknown as { extra?: string }).extra, undefined);
});

test('parseAppEntries skips malformed entries silently', () => {
  const list = parseAppEntries([
    vsCode,
    null,
    { id: 'broken' }, // missing required fields
    ksdiff,
  ]);
  assert.equal(list.length, 2);
  assert.equal(list[0]?.id, 'vscode');
  assert.equal(list[1]?.id, 'ksdiff');
});

test('parseAppEntries returns [] for non-array input', () => {
  assert.deepEqual(parseAppEntries('not an array'), []);
  assert.deepEqual(parseAppEntries(null), []);
  assert.deepEqual(parseAppEntries(undefined), []);
});

test('findDiffApp returns the cli entry with role=diff', () => {
  const apps = [vsCode, finder, ksdiff];
  assert.equal(findDiffApp(apps)?.id, 'ksdiff');
});

test('findDiffApp returns null when no diff-role entry exists', () => {
  assert.equal(findDiffApp([vsCode, finder]), null);
});

test('findDiffApp ignores entries with role=diff but kind=app (only cli is diff-shaped)', () => {
  const wrongKind: AppEntry = {
    id: 'x',
    label: 'X',
    kind: 'app',
    target: 'file',
    appPath: '/Applications/X.app',
    role: 'diff',
  };
  assert.equal(findDiffApp([wrongKind]), null);
});

test('appsForNode returns entries whose target matches, excluding the diff role', () => {
  const apps = [vsCode, finder, ksdiff];
  // Files: VS Code (both) qualifies; Finder (folder) excluded; ksdiff (diff) excluded.
  const files = appsForNode(apps, 'file');
  assert.deepEqual(
    files.map((a) => a.id),
    ['vscode'],
  );
  // Folders: VS Code (both) + Finder (folder); ksdiff (file + diff) excluded.
  const folders = appsForNode(apps, 'folder');
  assert.deepEqual(
    folders.map((a) => a.id),
    ['vscode', 'finder'],
  );
});

test('appsForNode returns [] when no app matches the node kind', () => {
  assert.deepEqual(appsForNode([finder], 'file'), []);
  assert.deepEqual(appsForNode([], 'folder'), []);
});
