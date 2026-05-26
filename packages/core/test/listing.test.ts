import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { listMemoryDir } from '../src/index.js';

function makeScratch(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'listing-test-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('listMemoryDir returns parsed entries sorted by filename', () => {
  const { dir, cleanup } = makeScratch();
  try {
    writeFileSync(
      join(dir, 'b.md'),
      '---\ntype: save-point\ntitle: B\nupdated: 2026-05-26\nreferences: []\ndate: 2026-05-26\nlore_commit: bbb\npayload_commit: beef\n---\n\nB body\n',
    );
    writeFileSync(
      join(dir, 'a.md'),
      '---\ntype: save-point\ntitle: A\nupdated: 2026-05-25\nreferences: []\ndate: 2026-05-25\nlore_commit: aaa\npayload_commit: cafe\n---\n\nA body\n',
    );

    const entries = listMemoryDir(dir);
    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.name, 'a.md');
    assert.equal(entries[1]?.name, 'b.md');
    assert.equal(entries[0]?.frontmatter?.title, 'A');
    assert.equal(entries[1]?.frontmatter?.title, 'B');
  } finally {
    cleanup();
  }
});

test('listMemoryDir skips *.index.md files', () => {
  const { dir, cleanup } = makeScratch();
  try {
    writeFileSync(
      join(dir, 'contracts.index.md'),
      '---\ntype: index\ntitle: idx\nupdated: 2026-05-26\nreferences: []\n---\n\nindex\n',
    );
    writeFileSync(
      join(dir, 'one.md'),
      '---\ntype: blueprint\ntitle: one\nupdated: 2026-05-26\nreferences: []\nbranch: contracts\n---\n\nbody\n',
    );
    const entries = listMemoryDir(dir);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.name, 'one.md');
  } finally {
    cleanup();
  }
});

test('listMemoryDir returns [] for a non-existent directory', () => {
  const entries = listMemoryDir('/tmp/this-does-not-exist-listing-12345');
  assert.deepEqual(entries, []);
});

test('listMemoryDir returns [] for an empty directory', () => {
  const { dir, cleanup } = makeScratch();
  try {
    assert.deepEqual(listMemoryDir(dir), []);
  } finally {
    cleanup();
  }
});

test('listMemoryDir skips non-.md files', () => {
  const { dir, cleanup } = makeScratch();
  try {
    writeFileSync(join(dir, 'note.txt'), 'plain text');
    writeFileSync(
      join(dir, 'real.md'),
      '---\ntype: save-point\ntitle: t\nupdated: 2026-05-26\nreferences: []\ndate: 2026-05-26\nlore_commit: x\npayload_commit: y\n---\n\nbody\n',
    );
    const entries = listMemoryDir(dir);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.name, 'real.md');
  } finally {
    cleanup();
  }
});

test('listMemoryDir surfaces files with missing/malformed frontmatter (frontmatter null)', () => {
  const { dir, cleanup } = makeScratch();
  try {
    writeFileSync(join(dir, 'bare.md'), '# Just a body\n\nNo YAML.\n');
    const entries = listMemoryDir(dir);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.frontmatter, null);
    assert.match(entries[0]?.body ?? '', /Just a body/);
  } finally {
    cleanup();
  }
});

test('listMemoryDir does not recurse into sub-directories', () => {
  const { dir, cleanup } = makeScratch();
  try {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(
      join(dir, 'sub', 'nested.md'),
      '---\ntype: save-point\ntitle: n\nupdated: 2026-05-26\nreferences: []\ndate: 2026-05-26\nlore_commit: a\npayload_commit: b\n---\n',
    );
    writeFileSync(
      join(dir, 'top.md'),
      '---\ntype: save-point\ntitle: t\nupdated: 2026-05-26\nreferences: []\ndate: 2026-05-26\nlore_commit: a\npayload_commit: b\n---\n',
    );
    const entries = listMemoryDir(dir);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.name, 'top.md');
  } finally {
    cleanup();
  }
});
