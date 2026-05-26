import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  type AppEntry,
  appsForNode,
  cleanAppLabel,
  dedupApps,
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

test('cleanAppLabel strips "Open … in X" verb prefix to leave the app name', () => {
  assert.equal(cleanAppLabel('Open project in WebStorm'), 'WebStorm');
  assert.equal(cleanAppLabel('Open Lore in Obsidian'), 'Obsidian');
  assert.equal(cleanAppLabel('Open the Lore in Obsidian'), 'Obsidian');
});

test('cleanAppLabel falls back to stripping leading "Open " when no "in X"', () => {
  assert.equal(cleanAppLabel('Open Finder'), 'Finder');
});

test('cleanAppLabel leaves already-clean labels untouched', () => {
  assert.equal(cleanAppLabel('WebStorm'), 'WebStorm');
  assert.equal(cleanAppLabel('VS Code'), 'VS Code');
  assert.equal(cleanAppLabel('Kaleidoscope'), 'Kaleidoscope');
});

test('cleanAppLabel is idempotent — running it twice gives the same result', () => {
  const once = cleanAppLabel('Open project in WebStorm');
  const twice = cleanAppLabel(once);
  assert.equal(once, twice);
});

test('cleanAppLabel trims whitespace', () => {
  assert.equal(cleanAppLabel('  Open project in WebStorm  '), 'WebStorm');
  assert.equal(cleanAppLabel('   WebStorm   '), 'WebStorm');
});

test('dedupApps collapses entries with the same identity tuple', () => {
  const a: AppEntry = {
    id: '1',
    label: 'Obsidian',
    kind: 'app',
    target: 'folder',
    appPath: '/Applications/Obsidian.app',
  };
  const b: AppEntry = { ...a, id: '2' }; // same tuple, different id
  const c: AppEntry = { ...a, id: '3', label: 'obsidian' }; // case-insensitive match
  const deduped = dedupApps([a, b, c]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]?.id, '1'); // first occurrence wins
});

test('dedupApps keeps entries with different paths', () => {
  const obsidian: AppEntry = {
    id: '1',
    label: 'Obsidian',
    kind: 'app',
    target: 'folder',
    appPath: '/Applications/Obsidian.app',
  };
  const webstorm: AppEntry = {
    id: '2',
    label: 'WebStorm',
    kind: 'app',
    target: 'folder',
    appPath: '/Applications/WebStorm.app',
  };
  assert.equal(dedupApps([obsidian, webstorm]).length, 2);
});

test('dedupApps keeps entries with the same path but different target', () => {
  const folder: AppEntry = {
    id: '1',
    label: 'VS Code',
    kind: 'app',
    target: 'folder',
    appPath: '/Applications/Visual Studio Code.app',
  };
  const file: AppEntry = { ...folder, id: '2', target: 'file' };
  assert.equal(dedupApps([folder, file]).length, 2);
});

test('dedupApps distinguishes diff-role from non-role entries with same path', () => {
  const code: AppEntry = {
    id: '1',
    label: 'code',
    kind: 'cli',
    target: 'file',
    cliPath: '/usr/local/bin/code',
    argvTemplate: '{path}',
  };
  const codeDiff: AppEntry = {
    ...code,
    id: '2',
    argvTemplate: '--diff {baseline} {current}',
    role: 'diff',
  };
  assert.equal(dedupApps([code, codeDiff]).length, 2);
});

test('dedupApps is order-preserving', () => {
  const a: AppEntry = {
    id: 'a',
    label: 'A',
    kind: 'app',
    target: 'folder',
    appPath: '/A.app',
  };
  const b: AppEntry = {
    id: 'b',
    label: 'B',
    kind: 'app',
    target: 'folder',
    appPath: '/B.app',
  };
  const c: AppEntry = {
    id: 'c',
    label: 'C',
    kind: 'app',
    target: 'folder',
    appPath: '/C.app',
  };
  assert.deepEqual(
    dedupApps([c, a, b]).map((x: AppEntry) => x.id),
    ['c', 'a', 'b'],
  );
});

test('dedupApps is idempotent', () => {
  const a: AppEntry = {
    id: '1',
    label: 'Obsidian',
    kind: 'app',
    target: 'folder',
    appPath: '/Applications/Obsidian.app',
  };
  const b: AppEntry = { ...a, id: '2' };
  const once = dedupApps([a, b]);
  const twice = dedupApps(once);
  assert.deepEqual(once, twice);
});
