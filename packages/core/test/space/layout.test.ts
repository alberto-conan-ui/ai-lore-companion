import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  DESK_FILES,
  SPACE_LAYOUT,
  deskFile,
  deskPaths,
  spaceKey,
  spacePaths,
  spacesDir,
} from '../../src/index.js';

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

test('spaceKey is the SHA-1 of the resolved absolute path', () => {
  const expected = createHash('sha1').update(resolve('/tmp/some-space')).digest('hex');
  assert.equal(spaceKey('/tmp/some-space'), expected);
  assert.equal(spaceKey('/tmp/x/../some-space'), expected);
  assert.notEqual(spaceKey('/tmp/other-space'), expected);
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
    'project-cache.json',
    'reviewed-marks.json',
    'session-closes.json',
    'sessions.json',
    'unattended-tags.json',
  ]);
});
