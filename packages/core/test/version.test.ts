import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { compareVersions, readCoreVersion, versionMeetsMinimum } from '../src/index.js';

function makeLoreDir(manifest: string | null): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'version-test-'));
  if (manifest !== null) writeFileSync(join(dir, 'workspace.yaml'), manifest);
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('readCoreVersion parses a quoted version', () => {
  const { dir, cleanup } = makeLoreDir('project_name: foo\ncore_version: "0.5.1"\n');
  try {
    assert.equal(readCoreVersion(dir), '0.5.1');
  } finally {
    cleanup();
  }
});

test('readCoreVersion parses an unquoted version', () => {
  const { dir, cleanup } = makeLoreDir('project_name: foo\ncore_version: 0.4\n');
  try {
    assert.equal(readCoreVersion(dir), '0.4');
  } finally {
    cleanup();
  }
});

test('readCoreVersion returns null when workspace.yaml is missing', () => {
  const { dir, cleanup } = makeLoreDir(null);
  try {
    assert.equal(readCoreVersion(dir), null);
  } finally {
    cleanup();
  }
});

test('readCoreVersion returns null when core_version is absent', () => {
  const { dir, cleanup } = makeLoreDir('project_name: foo\n');
  try {
    assert.equal(readCoreVersion(dir), null);
  } finally {
    cleanup();
  }
});

test('compareVersions handles equal and ordered pairs', () => {
  assert.equal(compareVersions('0.5.1', '0.5.1'), 0);
  assert.ok(compareVersions('0.4', '0.5.1') < 0);
  assert.ok(compareVersions('0.5', '0.5.1') < 0);
  assert.ok(compareVersions('0.5.1', '0.5') > 0);
  assert.ok(compareVersions('0.6', '0.5.1') > 0);
  assert.ok(compareVersions('0.10', '0.5.1') > 0);
});

test('compareVersions treats trailing missing components as zero', () => {
  assert.equal(compareVersions('0.5.0', '0.5'), 0);
  assert.equal(compareVersions('0.5', '0.5.0.0'), 0);
});

test('versionMeetsMinimum is true at and above the floor, false below', () => {
  assert.equal(versionMeetsMinimum('0.5.1', '0.5.1'), true);
  assert.equal(versionMeetsMinimum('0.6', '0.5.1'), true);
  assert.equal(versionMeetsMinimum('0.5', '0.5.1'), false);
  assert.equal(versionMeetsMinimum('0.4', '0.5.1'), false);
});
