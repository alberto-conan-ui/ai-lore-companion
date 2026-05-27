import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readProjectShape } from '../src/index.js';

function makeLoreDir(manifest: string | null): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'shape-test-'));
  if (manifest !== null) writeFileSync(join(dir, 'workspace.yaml'), manifest);
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('readProjectShape returns default + coreVersion for a minimal manifest', () => {
  const { dir, cleanup } = makeLoreDir('project_name: foo\ncore_version: "0.5.1"\n');
  try {
    const result = readProjectShape(dir);
    assert.equal(result.shape, 'default');
    assert.equal(result.coreVersion, '0.5.1');
    assert.equal(result.publish, undefined);
  } finally {
    cleanup();
  }
});

test('readProjectShape returns publishing when a publish: block declares a path', () => {
  const yaml = [
    'project_name: foo',
    'core_version: "0.5.1"',
    '',
    'publish:',
    '  path: ./publish',
    '',
  ].join('\n');
  const { dir, cleanup } = makeLoreDir(yaml);
  try {
    const result = readProjectShape(dir);
    assert.equal(result.shape, 'publishing');
    assert.equal(result.coreVersion, '0.5.1');
    assert.deepEqual(result.publish, { path: './publish' });
  } finally {
    cleanup();
  }
});

test('readProjectShape carries the optional publish.target through', () => {
  const yaml = [
    'project_name: foo',
    'core_version: "0.5.1"',
    'publish:',
    '  path: ./publish',
    '  target: ~/Drive/foo',
  ].join('\n');
  const { dir, cleanup } = makeLoreDir(yaml);
  try {
    const result = readProjectShape(dir);
    assert.equal(result.shape, 'publishing');
    assert.deepEqual(result.publish, { path: './publish', target: '~/Drive/foo' });
  } finally {
    cleanup();
  }
});

test('readProjectShape treats a publish: block missing path as default shape', () => {
  // Malformed block — declared but no `path:`. The caller falls back to
  // default shape rather than guessing.
  const yaml = ['project_name: foo', 'core_version: "0.5.1"', 'publish:', '  target: ~/foo'].join(
    '\n',
  );
  const { dir, cleanup } = makeLoreDir(yaml);
  try {
    const result = readProjectShape(dir);
    assert.equal(result.shape, 'default');
    assert.equal(result.publish, undefined);
  } finally {
    cleanup();
  }
});

test('readProjectShape returns coreVersion: null for a manifest with no core_version', () => {
  const { dir, cleanup } = makeLoreDir('project_name: foo\n');
  try {
    const result = readProjectShape(dir);
    assert.equal(result.coreVersion, null);
    assert.equal(result.shape, 'default');
  } finally {
    cleanup();
  }
});

test('readProjectShape returns default + coreVersion: null on a missing manifest', () => {
  const { dir, cleanup } = makeLoreDir(null);
  try {
    const result = readProjectShape(dir);
    assert.equal(result.coreVersion, null);
    assert.equal(result.shape, 'default');
  } finally {
    cleanup();
  }
});

test('readProjectShape ignores comments and whitespace inside the publish: block', () => {
  const yaml = [
    'project_name: foo',
    'core_version: "0.5.1"',
    '',
    'publish:',
    '  path: ./publish    # local mirror',
    '  target: "/Volumes/Drive/foo"   # optional symlink',
    '',
    'some_other_top_level: value',
  ].join('\n');
  const { dir, cleanup } = makeLoreDir(yaml);
  try {
    const result = readProjectShape(dir);
    assert.equal(result.shape, 'publishing');
    assert.deepEqual(result.publish, { path: './publish', target: '/Volumes/Drive/foo' });
  } finally {
    cleanup();
  }
});
