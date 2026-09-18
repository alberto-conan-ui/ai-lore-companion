import { strict as assert } from 'node:assert';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  type SpaceManifest,
  copyTree,
  readSpaceManifest,
  spacePaths,
  writeSpaceManifest,
} from '../../src/index.js';
import { loreTemplateDir, useTempDir } from '../support/index.js';

const MANIFEST: SpaceManifest = {
  format: 1,
  name: 'example-space',
  github: { repository: 'example-owner/example-space', project: 4 },
  repositories: [{ name: 'example-app', github: 'example-owner/example-app' }],
  publishAreas: [
    { name: 'publish', path: 'publish' },
    { name: 'handbook', path: null },
  ],
};

test('readSpaceManifest says when the file is missing, also when lore is not a folder', async (t) => {
  const root = useTempDir(t);
  const missing = await readSpaceManifest(root);
  assert.equal(!missing.ok && missing.error.kind, 'manifest-missing');

  writeFileSync(join(root, 'lore'), 'a file named lore');
  const notAFolder = await readSpaceManifest(root);
  assert.equal(!notAFolder.ok && notAFolder.error.kind, 'manifest-missing');
});

test('readSpaceManifest says when the path cannot be read as a file', async (t) => {
  const root = useTempDir(t);
  mkdirSync(join(root, 'lore', 'space.md'), { recursive: true });
  const result = await readSpaceManifest(root);
  assert.equal(!result.ok && result.error.kind, 'manifest-unreadable');
  assert.match(result.ok ? '' : result.error.message, /is not a file/);
});

test('a file far larger than a manifest is not read, and a write does not replace it', async (t) => {
  const root = useTempDir(t);
  const path = spacePaths(root).manifest;
  mkdirSync(join(root, 'lore'));
  writeFileSync(path, '---\ntype: space\n---\n');
  truncateSync(path, 50 * 1024 * 1024);
  const started = Date.now();
  const read = await readSpaceManifest(root);
  assert.ok(Date.now() - started < 500);
  assert.equal(!read.ok && read.error.kind, 'manifest-unreadable');
  assert.match(read.ok ? '' : read.error.message, /52428800 bytes/);
  const written = await writeSpaceManifest(root, MANIFEST);
  assert.equal(!written.ok && written.error.kind, 'manifest-unreadable');
  assert.equal(statSync(path).size, 50 * 1024 * 1024);
});

test('writeSpaceManifest creates the file with its folder, and readSpaceManifest reads it back', async (t) => {
  const root = useTempDir(t);
  assert.deepEqual(await writeSpaceManifest(root, MANIFEST), { ok: true, value: undefined });
  assert.deepEqual(await readSpaceManifest(root), { ok: true, value: MANIFEST });
  const text = readFileSync(spacePaths(root).manifest, 'utf8');
  assert.match(text, /^---\ntype: space\nformat: 1\nname: example-space\n/);
  assert.match(text, /# The Space's manifest/);
  // The write is atomic: no temporary file is left beside the manifest.
  assert.deepEqual(readdirSync(join(root, 'lore')), ['space.md']);
});

test('writeSpaceManifest keeps the prose of the template below the new frontmatter', async (t) => {
  const root = useTempDir(t);
  const copied = await copyTree(loreTemplateDir(), root);
  assert.equal(copied.ok, true);
  const path = spacePaths(root).manifest;
  const before = readFileSync(path, 'utf8');
  const bodyBefore = before.slice(before.indexOf('\n---\n', 4) + 5);

  assert.equal((await writeSpaceManifest(root, MANIFEST)).ok, true);
  const after = readFileSync(path, 'utf8');
  assert.equal(after.slice(after.indexOf('\n---\n', 4) + 5), bodyBefore);
  assert.match(bodyBefore, /## The keys/);
  assert.deepEqual(await readSpaceManifest(root), { ok: true, value: MANIFEST });
});

test('writeSpaceManifest writes nothing when the manifest could not be read back', async (t) => {
  const root = useTempDir(t);
  const result = await writeSpaceManifest(root, {
    ...MANIFEST,
    repositories: [{ name: '../escape', github: 'o/n' }],
  });
  assert.equal(!result.ok && result.error.kind, 'invalid-manifest');
  assert.equal(existsSync(join(root, 'lore')), false);
});

test('the manifest is neither read nor written through a symbolic link that leaves the Space', async (t) => {
  const root = useTempDir(t);
  const outside = useTempDir(t);
  mkdirSync(join(outside, 'lore'));
  assert.equal((await writeSpaceManifest(outside, MANIFEST)).ok, true);
  const outsideText = readFileSync(join(outside, 'lore', 'space.md'), 'utf8');

  // The whole lore folder is a link to a folder outside the Space.
  symlinkSync(join(outside, 'lore'), join(root, 'lore'));
  const read = await readSpaceManifest(root);
  assert.equal(!read.ok && read.error.kind, 'manifest-outside-space');
  const written = await writeSpaceManifest(root, { ...MANIFEST, name: 'changed' });
  assert.equal(!written.ok && written.error.kind, 'manifest-outside-space');
  assert.equal(readFileSync(join(outside, 'lore', 'space.md'), 'utf8'), outsideText);

  // Only the file is a link to a file outside the Space.
  const second = useTempDir(t);
  mkdirSync(join(second, 'lore'));
  symlinkSync(join(outside, 'lore', 'space.md'), join(second, 'lore', 'space.md'));
  const readFile = await readSpaceManifest(second);
  assert.equal(!readFile.ok && readFile.error.kind, 'manifest-outside-space');
});

test('a link that stays inside the Space is read', async (t) => {
  const root = useTempDir(t);
  assert.equal((await writeSpaceManifest(root, MANIFEST)).ok, true);
  mkdirSync(join(root, 'elsewhere'));
  const path = spacePaths(root).manifest;
  const moved = join(root, 'elsewhere', 'space.md');
  writeFileSync(moved, readFileSync(path, 'utf8'));
  // Replace the file by a link to the copy inside the same folder.
  rmSync(path);
  symlinkSync(moved, path);
  assert.deepEqual(await readSpaceManifest(root), { ok: true, value: MANIFEST });
});
