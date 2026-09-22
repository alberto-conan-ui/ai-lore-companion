import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  DESK_FILES,
  SPACE_LAYOUT,
  deskFile,
  deskKeyPath,
  deskPaths,
  spaceKey,
  spacePaths,
  spacesDir,
} from '../../src/index.js';
import { useTempDir } from '../support/temp.js';

test('spacePaths spells out the fixed layout of a Space', () => {
  const p = spacePaths('/tmp/some-space');
  assert.equal(p.root, resolve('/tmp/some-space'));
  assert.equal(p.aiReadme, join(p.root, 'ai_readme.md'));
  assert.equal(p.lore, join(p.root, 'lore'));
  assert.equal(p.manifest, join(p.root, 'lore', 'space.md'));
  assert.equal(p.publish, join(p.root, 'publish'));
  assert.equal(p.repos, join(p.root, 'repos'));
  assert.equal(p.workbench, join(p.root, 'workbench'));
  assert.equal(p.drafts, join(p.root, 'workbench', 'drafts'));
  assert.equal(p.journal, join(p.root, 'workbench', 'journal'));
  assert.equal(p.scratch, join(p.root, 'workbench', 'scratch'));
});

test('spacePaths resolves a relative folder and SPACE_LAYOUT names every entry', () => {
  const p = spacePaths('relative/space');
  assert.equal(p.root, resolve('relative/space'));
  assert.deepEqual(
    Object.keys(SPACE_LAYOUT).sort(),
    Object.keys(p)
      .filter((k) => k !== 'root')
      .sort(),
  );
});

test('spaceKey is the SHA-1 of the real absolute path', (t) => {
  const base = realpathSync.native(useTempDir(t));
  const space = join(base, 'some-space');
  const expected = createHash('sha1').update(space).digest('hex');
  assert.equal(deskKeyPath(space), space);
  assert.equal(spaceKey(space), expected);
  assert.equal(spaceKey(join(base, 'x', '..', 'some-space')), expected);
  assert.equal(spaceKey(`${space}/`), expected);
  assert.notEqual(spaceKey(join(base, 'other-space')), expected);
});

test('spaceKey is one key for every spelling of one folder, before and after it exists', (t) => {
  const base = realpathSync.native(useTempDir(t));
  mkdirSync(join(base, 'real'));
  symlinkSync(join(base, 'real'), join(base, 'link'));
  const viaReal = join(base, 'real', 'my-space');
  const viaLink = join(base, 'link', 'my-space');

  // The folder does not exist yet: the nearest existing parent decides.
  const before = spaceKey(viaReal);
  assert.equal(spaceKey(viaLink), before);
  assert.equal(deskKeyPath(viaLink), viaReal);

  mkdirSync(viaReal);
  assert.equal(spaceKey(viaReal), before, 'creating the folder does not change its key');
  assert.equal(spaceKey(viaLink), before);
  assert.equal(spaceKey(`${viaLink}/`), before);

  // A link to the Space's folder itself.
  symlinkSync(viaReal, join(base, 'shortcut'));
  assert.equal(spaceKey(join(base, 'shortcut')), before);
  assert.equal(deskPaths('/tmp/user-data', join(base, 'shortcut')).dir.endsWith(before), true);

  // Letter case, where the filesystem takes both spellings for one folder.
  const upper = join(base, 'real', 'MY-SPACE');
  if (existsSync(upper)) assert.equal(spaceKey(upper), before);
  else assert.notEqual(spaceKey(upper), before);
});

test('spaceKey uses the path as written when it cannot be resolved', (t) => {
  const base = realpathSync.native(useTempDir(t));
  symlinkSync(join(base, 'b'), join(base, 'a'));
  symlinkSync(join(base, 'a'), join(base, 'b'));
  const looped = join(base, 'a', 'space');
  assert.equal(deskKeyPath(looped), looped);
  assert.equal(spaceKey(looped), createHash('sha1').update(looped).digest('hex'));
});

test('deskPaths places a desk under <userData>/spaces/<key>/', () => {
  const p = deskPaths('/tmp/user-data', '/tmp/some-space');
  const dir = join(resolve('/tmp/user-data'), 'spaces', spaceKey('/tmp/some-space'));
  assert.equal(spacesDir('/tmp/user-data'), join(resolve('/tmp/user-data'), 'spaces'));
  assert.deepEqual(p, {
    dir,
    desk: join(dir, 'desk'),
    install: join(dir, 'install'),
    sessions: join(dir, 'sessions'),
    ui: join(dir, 'ui'),
  });
});

test('deskFile names each of the desk records', () => {
  const p = deskPaths('/tmp/user-data', '/tmp/some-space');
  assert.equal(deskFile(p, 'claims'), join(p.desk, 'claims.json'));
  assert.equal(deskFile(p, 'sessions'), join(p.desk, 'sessions.json'));
  assert.equal(deskFile(p, 'gateAnswers'), join(p.desk, 'gate-answers.json'));
  assert.deepEqual(Object.values(DESK_FILES).sort(), [
    'claims.json',
    'first-seen.json',
    'gate-answers.json',
    'migration.json',
    'pending-writes.json',
    'project-cache.json',
    'reviewed-marks.json',
    'session-closes.json',
    'sessions.json',
    'status-writes.json',
    'unattended-tags.json',
  ]);
});
