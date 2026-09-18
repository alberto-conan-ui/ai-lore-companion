import { strict as assert } from 'node:assert';
import { createHash, randomBytes } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  ATOMIC_TEMP_SUFFIX,
  copyTree,
  isAtomicTempName,
  isInsideLexically,
  isPathInside,
  realpathNearest,
  safeJoin,
  sha256File,
  toPosixRelative,
  writeFileAtomic,
  writeFileAtomicSync,
} from '../../src/index.js';
import { useTempDir } from '../support/temp.js';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

// ---------- safeJoin and containment ----------

test('safeJoin joins a path inside the base, existing or not', (t) => {
  const base = useTempDir(t);
  mkdirSync(join(base, 'lore'));
  writeFileSync(join(base, 'lore', 'index.md'), 'x');
  assert.deepEqual(safeJoin(base, 'lore/index.md'), {
    ok: true,
    value: join(base, 'lore', 'index.md'),
  });
  assert.deepEqual(safeJoin(base, 'lore/new/deep/file.md'), {
    ok: true,
    value: join(base, 'lore', 'new', 'deep', 'file.md'),
  });
  assert.deepEqual(safeJoin(base, '.'), { ok: true, value: base });
});

test('safeJoin refuses a path that climbs out of the base', (t) => {
  const base = useTempDir(t);
  for (const bad of ['..', '../sibling', 'lore/../../etc/passwd', '/etc/passwd']) {
    const r = safeJoin(base, bad);
    assert.equal(r.ok, false, bad);
    if (!r.ok) assert.equal(r.error.kind, 'outside-base');
  }
});

test('safeJoin accepts an absolute path that is inside the base', (t) => {
  const base = useTempDir(t);
  const r = safeJoin(base, join(base, 'a', 'b.md'));
  assert.deepEqual(r, { ok: true, value: join(base, 'a', 'b.md') });
});

test('safeJoin refuses a symbolic link that leaves the base, also for a file not there yet', (t) => {
  const root = useTempDir(t);
  const base = join(root, 'space');
  const outside = join(root, 'outside');
  mkdirSync(join(base, 'workbench'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.md'), 's');
  symlinkSync(outside, join(base, 'workbench', 'link'));

  const existing = safeJoin(base, 'workbench/link/secret.md');
  assert.equal(existing.ok, false);
  if (!existing.ok) assert.equal(existing.error.kind, 'outside-base');

  const missing = safeJoin(base, 'workbench/link/new/file.md');
  assert.equal(missing.ok, false);
});

test('safeJoin refuses a dangling symbolic link whose target is outside the base', (t) => {
  const root = useTempDir(t);
  const base = join(root, 'space');
  mkdirSync(base);
  symlinkSync(join(root, 'not-there-yet.md'), join(base, 'dangling.md'));
  const r = safeJoin(base, 'dangling.md');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.kind, 'outside-base');
});

test('safeJoin accepts a symbolic link that stays inside the base', (t) => {
  const base = useTempDir(t);
  mkdirSync(join(base, 'lore'));
  symlinkSync(join(base, 'lore'), join(base, 'alias'));
  assert.equal(safeJoin(base, 'alias/card.md').ok, true);
});

test('safeJoin accepts a base that is itself reached through a symbolic link', (t) => {
  const root = useTempDir(t);
  mkdirSync(join(root, 'real'));
  symlinkSync(join(root, 'real'), join(root, 'via-link'));
  const r = safeJoin(join(root, 'via-link'), 'file.md');
  assert.deepEqual(r, { ok: true, value: join(root, 'via-link', 'file.md') });
});

test('safeJoin refuses an empty base and a NUL character', (t) => {
  const base = useTempDir(t);
  for (const r of [safeJoin('', 'a'), safeJoin(base, 'a\0b')]) {
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.kind, 'invalid-path');
  }
});

test('safeJoin reports a path it cannot resolve instead of accepting it', (t) => {
  const base = useTempDir(t);
  symlinkSync(join(base, 'b'), join(base, 'a'));
  symlinkSync(join(base, 'a'), join(base, 'b'));
  const r = safeJoin(base, 'a/file.md');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.kind, 'unresolvable-path');
});

test('realpathNearest resolves the nearest existing parent of a missing path', (t) => {
  const root = useTempDir(t);
  mkdirSync(join(root, 'real'));
  symlinkSync(join(root, 'real'), join(root, 'link'));
  assert.equal(realpathNearest(join(root, 'link', 'x', 'y.md')), join(root, 'real', 'x', 'y.md'));
  assert.equal(realpathNearest(join(root, 'real')), join(root, 'real'));
});

test('isInsideLexically compares texts and does not take a name prefix for a parent', () => {
  assert.equal(isInsideLexically('/a/b', '/a/b'), true);
  assert.equal(isInsideLexically('/a/b', '/a/b/c/d'), true);
  assert.equal(isInsideLexically('/a/b', '/a/bc'), false);
  assert.equal(isInsideLexically('/a/b', '/a'), false);
  assert.equal(isInsideLexically('/a/b', '/a/b/../c'), false);
  assert.equal(isInsideLexically('/a/b', '/a/b/..c'), true);
});

test('isPathInside resolves links on both sides', (t) => {
  const root = useTempDir(t);
  mkdirSync(join(root, 'in'));
  mkdirSync(join(root, 'out'));
  symlinkSync(join(root, 'out'), join(root, 'in', 'escape'));
  assert.deepEqual(isPathInside(join(root, 'in'), join(root, 'in', 'file.md')), {
    ok: true,
    value: true,
  });
  assert.deepEqual(isPathInside(join(root, 'in'), join(root, 'in', 'escape', 'file.md')), {
    ok: true,
    value: false,
  });
});

test('toPosixRelative gives a relative path with forward slashes', () => {
  assert.equal(toPosixRelative('/a/b', '/a/b/c/d.md'), 'c/d.md');
  assert.equal(toPosixRelative('/a/b', '/a/b'), '');
});

// ---------- atomic write ----------

test('writeFileAtomic writes the text, creates parents, and leaves no temporary file', async (t) => {
  const dir = useTempDir(t);
  const path = join(dir, 'desk', 'claims.json');
  assert.deepEqual(await writeFileAtomic(path, '{"version":1}'), { ok: true, value: undefined });
  assert.equal(readFileSync(path, 'utf8'), '{"version":1}');
  assert.deepEqual(readdirSync(join(dir, 'desk')), ['claims.json']);
});

test('writeFileAtomic replaces an existing file as a whole', async (t) => {
  const dir = useTempDir(t);
  const path = join(dir, 'a.json');
  await writeFileAtomic(path, 'a long first content');
  await writeFileAtomic(path, 'short');
  assert.equal(readFileSync(path, 'utf8'), 'short');
});

test('writeFileAtomic applies the file mode', async (t) => {
  const dir = useTempDir(t);
  const path = join(dir, 'token.json');
  await writeFileAtomic(path, 't', { mode: 0o600 });
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test('writeFileAtomic fails with write-failed, keeps the old content and removes its temporary file', async (t) => {
  const dir = useTempDir(t);
  const locked = join(dir, 'locked');
  mkdirSync(locked);
  writeFileSync(join(locked, 'a.json'), 'old');
  chmodSync(locked, 0o500);
  const r = await writeFileAtomic(join(locked, 'a.json'), 'new').finally(() =>
    chmodSync(locked, 0o700),
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.kind, 'write-failed');
  assert.equal(readFileSync(join(locked, 'a.json'), 'utf8'), 'old');
  assert.deepEqual(readdirSync(locked), ['a.json']);
});

test('writeFileAtomic fails when the destination is a folder', async (t) => {
  const dir = useTempDir(t);
  mkdirSync(join(dir, 'is-a-folder'));
  const r = await writeFileAtomic(join(dir, 'is-a-folder'), 'x');
  assert.equal(r.ok, false);
  assert.deepEqual(readdirSync(dir), ['is-a-folder']);
});

test('writeFileAtomicSync behaves as the async form', (t) => {
  const dir = useTempDir(t);
  const path = join(dir, 'nested', 'b.json');
  assert.deepEqual(writeFileAtomicSync(path, 'one', { mode: 0o600 }), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(writeFileAtomicSync(path, 'two'), { ok: true, value: undefined });
  assert.equal(readFileSync(path, 'utf8'), 'two');
  assert.deepEqual(readdirSync(join(dir, 'nested')), ['b.json']);
  mkdirSync(join(dir, 'folder'));
  assert.equal(writeFileAtomicSync(join(dir, 'folder'), 'x').ok, false);
});

test('isAtomicTempName recognises a temporary file left behind and nothing else', () => {
  assert.equal(isAtomicTempName(`.claims.json.123-abcdef${ATOMIC_TEMP_SUFFIX}`), true);
  assert.equal(isAtomicTempName('claims.json'), false);
  assert.equal(isAtomicTempName('.gitignore'), false);
  assert.equal(isAtomicTempName(`claims${ATOMIC_TEMP_SUFFIX}`), false);
});

// ---------- copyTree ----------

function makeSource(root: string): string {
  const from = join(root, 'from');
  mkdirSync(join(from, 'lore', 'verbs'), { recursive: true });
  mkdirSync(join(from, '.git'));
  writeFileSync(join(from, 'ai_readme.md'), 'readme');
  writeFileSync(join(from, 'lore', 'index.md'), 'index');
  writeFileSync(join(from, 'lore', 'verbs', 'check.py'), 'print(1)');
  chmodSync(join(from, 'lore', 'verbs', 'check.py'), 0o755);
  writeFileSync(join(from, '.git', 'HEAD'), 'ref');
  return from;
}

test('sha256File hashes a file and fails for a missing one', async (t) => {
  const dir = useTempDir(t);
  writeFileSync(join(dir, 'a.txt'), 'hello');
  assert.deepEqual(await sha256File(join(dir, 'a.txt')), { ok: true, value: sha256('hello') });
  const missing = await sha256File(join(dir, 'missing.txt'));
  assert.equal(missing.ok, false);
});

test('copyTree copies the tree, lists each file with its hash, and honours exclude', async (t) => {
  const root = useTempDir(t);
  const from = makeSource(root);
  const to = join(root, 'to');
  const r = await copyTree(from, to, { exclude: ['.git'] });
  assert.deepEqual(r, {
    ok: true,
    value: [
      { relativePath: 'ai_readme.md', sha256: sha256('readme'), status: 'copied' },
      { relativePath: 'lore/index.md', sha256: sha256('index'), status: 'copied' },
      { relativePath: 'lore/verbs/check.py', sha256: sha256('print(1)'), status: 'copied' },
    ],
  });
  assert.equal(readFileSync(join(to, 'lore', 'index.md'), 'utf8'), 'index');
  assert.equal(existsSync(join(to, '.git')), false);
  assert.equal(statSync(join(to, 'lore', 'verbs', 'check.py')).mode & 0o777, 0o755);
});

test('copyTree run a second time writes nothing and reports every file as same', async (t) => {
  const root = useTempDir(t);
  const from = makeSource(root);
  const to = join(root, 'to');
  await copyTree(from, to);
  const before = statSync(join(to, 'ai_readme.md')).mtimeMs;
  const again = await copyTree(from, to);
  assert.equal(again.ok, true);
  if (again.ok) assert.deepEqual([...new Set(again.value.map((f) => f.status))], ['same']);
  assert.equal(statSync(join(to, 'ai_readme.md')).mtimeMs, before);
});

test('copyTree excludes by path prefix and by function', async (t) => {
  const root = useTempDir(t);
  const from = makeSource(root);
  const byPath = await copyTree(from, join(root, 'a'), { exclude: ['.git', 'lore/verbs'] });
  assert.equal(byPath.ok, true);
  if (byPath.ok) {
    assert.deepEqual(
      byPath.value.map((f) => f.relativePath),
      ['ai_readme.md', 'lore/index.md'],
    );
  }
  const byFn = await copyTree(from, join(root, 'b'), {
    exclude: (rel, isDirectory) => isDirectory && rel !== 'lore',
  });
  assert.equal(byFn.ok, true);
  if (byFn.ok) {
    assert.deepEqual(
      byFn.value.map((f) => f.relativePath),
      ['ai_readme.md', 'lore/index.md'],
    );
  }
});

test('copyTree refuses, before writing anything, a destination file with other content', async (t) => {
  const root = useTempDir(t);
  const from = makeSource(root);
  const to = join(root, 'to');
  mkdirSync(join(to, 'lore'), { recursive: true });
  writeFileSync(join(to, 'lore', 'index.md'), 'edited by the Human Lead');
  const r = await copyTree(from, to, { exclude: ['.git'] });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.kind, 'destination-differs');
  assert.equal(existsSync(join(to, 'ai_readme.md')), false);
  assert.equal(readFileSync(join(to, 'lore', 'index.md'), 'utf8'), 'edited by the Human Lead');
});

test('copyTree keeps or overwrites a differing file when asked', async (t) => {
  const root = useTempDir(t);
  const from = makeSource(root);
  const to = join(root, 'to');
  mkdirSync(join(to, 'lore'), { recursive: true });
  writeFileSync(join(to, 'lore', 'index.md'), 'edited');

  const kept = await copyTree(from, to, { exclude: ['.git'], onConflict: 'keep' });
  assert.equal(kept.ok, true);
  if (kept.ok) {
    assert.equal(kept.value.find((f) => f.relativePath === 'lore/index.md')?.status, 'kept');
  }
  assert.equal(readFileSync(join(to, 'lore', 'index.md'), 'utf8'), 'edited');

  const over = await copyTree(from, to, { exclude: ['.git'], onConflict: 'overwrite' });
  assert.equal(over.ok, true);
  if (over.ok) {
    assert.equal(over.value.find((f) => f.relativePath === 'lore/index.md')?.status, 'overwritten');
  }
  assert.equal(readFileSync(join(to, 'lore', 'index.md'), 'utf8'), 'index');
});

test('copyTree overwrite replaces a symbolic link at the destination and does not write through it', async (t) => {
  const root = useTempDir(t);
  const from = makeSource(root);
  const to = join(root, 'to');
  mkdirSync(to);
  writeFileSync(join(root, 'victim.md'), 'untouched');
  symlinkSync(join(root, 'victim.md'), join(to, 'ai_readme.md'));
  const r = await copyTree(from, to, { exclude: ['.git'], onConflict: 'overwrite' });
  assert.equal(r.ok, true);
  assert.equal(readFileSync(join(root, 'victim.md'), 'utf8'), 'untouched');
  assert.equal(lstatSync(join(to, 'ai_readme.md')).isSymbolicLink(), false);
  assert.equal(readFileSync(join(to, 'ai_readme.md'), 'utf8'), 'readme');
});

test('copyTree refuses a symbolic link that points outside the source', async (t) => {
  const root = useTempDir(t);
  const from = makeSource(root);
  writeFileSync(join(root, 'outside.md'), 'secret');
  symlinkSync(join(root, 'outside.md'), join(from, 'lore', 'leak.md'));
  const r = await copyTree(from, join(root, 'to'));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.kind, 'symlink-outside-source');
  assert.equal(existsSync(join(root, 'to')), false);
});

test('copyTree copies a link to a file inside the source as that content, and refuses a link to a folder', async (t) => {
  const root = useTempDir(t);
  const from = makeSource(root);
  symlinkSync(join(from, 'ai_readme.md'), join(from, 'alias.md'));
  const r = await copyTree(from, join(root, 'to'), { exclude: ['.git'] });
  assert.equal(r.ok, true);
  assert.equal(lstatSync(join(root, 'to', 'alias.md')).isFile(), true);
  assert.equal(readFileSync(join(root, 'to', 'alias.md'), 'utf8'), 'readme');

  symlinkSync(join(from, 'lore'), join(from, 'lore-alias'));
  const refused = await copyTree(from, join(root, 'to2'), { exclude: ['.git'] });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.error.kind, 'unsupported-entry');
});

test('copyTree fails with source-missing when the source is not a folder', async (t) => {
  const root = useTempDir(t);
  const r = await copyTree(join(root, 'nope'), join(root, 'to'));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.kind, 'source-missing');
});

test('copyTree does not follow a link to a folder outside the source, and writes nothing', async (t) => {
  const root = useTempDir(t);
  const from = makeSource(root);
  mkdirSync(join(root, 'elsewhere'));
  writeFileSync(join(root, 'elsewhere', 'secret.md'), 'secret');
  // Named to sort last, so that every other file is planned before the refusal.
  symlinkSync(join(root, 'elsewhere'), join(from, 'zz-elsewhere'));
  const r = await copyTree(from, join(root, 'to'), { exclude: ['.git'] });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.kind, 'symlink-outside-source');
  assert.equal(existsSync(join(root, 'to')), false);
});

test('copyTree refuses to write through a linked folder at the destination', async (t) => {
  const root = useTempDir(t);
  const from = makeSource(root);
  const to = join(root, 'to');
  mkdirSync(to);
  mkdirSync(join(root, 'elsewhere'));
  symlinkSync(join(root, 'elsewhere'), join(to, 'lore'));
  for (const onConflict of ['fail', 'keep', 'overwrite'] as const) {
    const r = await copyTree(from, to, { exclude: ['.git'], onConflict });
    assert.equal(r.ok, false, onConflict);
    if (!r.ok) assert.equal(r.error.kind, 'destination-outside', onConflict);
  }
  assert.deepEqual(readdirSync(join(root, 'elsewhere')), []);
  assert.deepEqual(readdirSync(to), ['lore']);
});

test('copyTree refuses, before writing anything, a folder where a file has to go', async (t) => {
  const root = useTempDir(t);
  const from = makeSource(root);
  const to = join(root, 'to');
  mkdirSync(join(to, 'lore', 'index.md'), { recursive: true });
  const r = await copyTree(from, to, { exclude: ['.git'], onConflict: 'overwrite' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.kind, 'destination-differs');
  assert.equal(existsSync(join(to, 'ai_readme.md')), false);
});

test('copyTree passes over what an interrupted copy left, in the source and at the destination', async (t) => {
  const root = useTempDir(t);
  const from = makeSource(root);
  const to = join(root, 'to');
  const leftover = `.index.md.1-abcdef${ATOMIC_TEMP_SUFFIX}`;
  writeFileSync(join(from, 'lore', leftover), 'half of a file');
  mkdirSync(join(to, 'lore'), { recursive: true });
  writeFileSync(join(to, 'lore', leftover), 'half of a fi');
  const r = await copyTree(from, to, { exclude: ['.git'] });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(
    r.value.map((file) => [file.relativePath, file.status]),
    [
      ['ai_readme.md', 'copied'],
      ['lore/index.md', 'copied'],
      ['lore/verbs/check.py', 'copied'],
    ],
  );
  // The copy itself leaves no temporary file of its own.
  assert.deepEqual(readdirSync(join(to, 'lore')).sort(), [leftover, 'index.md', 'verbs'].sort());
  assert.equal(statSync(join(to, 'lore', 'verbs', 'check.py')).mode & 0o777, 0o755);
});

test('sha256File and copyTree handle a file far larger than one read', async (t) => {
  const root = useTempDir(t);
  const from = join(root, 'from');
  mkdirSync(from);
  const big = join(from, 'big.bin');
  const expected = createHash('sha256');
  // 24 MB and 7 bytes, in chunks that do not line up with the stream's reads.
  for (let index = 0; index < 8; index += 1) {
    const chunk = randomBytes(3 * 1024 * 1024);
    expected.update(chunk);
    appendFileSync(big, chunk);
  }
  const tail = Buffer.from('the end');
  expected.update(tail);
  appendFileSync(big, tail);
  const digest = expected.digest('hex');

  assert.deepEqual(await sha256File(big), { ok: true, value: digest });
  const first = await copyTree(from, join(root, 'to'));
  assert.deepEqual(first, {
    ok: true,
    value: [{ relativePath: 'big.bin', sha256: digest, status: 'copied' }],
  });
  assert.deepEqual(await sha256File(join(root, 'to', 'big.bin')), { ok: true, value: digest });

  // One byte changed in the middle of the copy is seen as other content.
  const handle = openSync(join(root, 'to', 'big.bin'), 'r+');
  const one = Buffer.alloc(1);
  readSync(handle, one, 0, 1, 12 * 1024 * 1024);
  writeSync(handle, Buffer.from([(one[0] ?? 0) ^ 0xff]), 0, 1, 12 * 1024 * 1024);
  closeSync(handle);
  const second = await copyTree(from, join(root, 'to'));
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.error.kind, 'destination-differs');
});

// ---------- containment: the cases a guard meets ----------

test('safeJoin treats an empty path and "." as the base, and refuses an absolute path outside it', (t) => {
  const base = useTempDir(t);
  assert.deepEqual(safeJoin(base, ''), { ok: true, value: base });
  assert.deepEqual(safeJoin(base, '.'), { ok: true, value: base });
  assert.deepEqual(safeJoin(base, 'a/../b/./c.md'), { ok: true, value: join(base, 'b', 'c.md') });
  for (const outside of [tmpdir(), '/', `${base}-sibling/x`, `${base}/../x`]) {
    const r = safeJoin(base, outside);
    assert.equal(r.ok, false, outside);
    if (!r.ok) assert.equal(r.error.kind, 'outside-base', outside);
  }
});

test('safeJoin judges ".." on the text, and returns the path it judged', (t) => {
  const root = useTempDir(t);
  const base = join(root, 'base');
  mkdirSync(base);
  mkdirSync(join(root, 'outside', 'deep'), { recursive: true });
  symlinkSync(join(root, 'outside', 'deep'), join(base, 'link'));
  // The operating system would read `link/../x` as `outside/x`. The value
  // returned is `base/x`, which is inside, and it is the value a caller uses.
  assert.deepEqual(safeJoin(base, 'link/../x'), { ok: true, value: join(base, 'x') });
  // Through the link, however long the missing tail, is outside.
  const through = safeJoin(base, 'link/a/b/c.md');
  assert.equal(through.ok, false);
  if (!through.ok) assert.equal(through.error.kind, 'outside-base');
});

test('containment follows the filesystem on case: one folder under two spellings is one folder', (t) => {
  const root = useTempDir(t);
  const lore = join(root, 'Lore');
  mkdirSync(join(lore, 'verbs'), { recursive: true });
  const otherSpelling = join(root, 'lore');
  if (existsSync(otherSpelling)) {
    // A filesystem that ignores case (the default on macOS).
    assert.equal(realpathNearest(join(otherSpelling, 'VERBS')), join(lore, 'verbs'));
    assert.deepEqual(isPathInside(lore, join(otherSpelling, 'verbs', 'new.md')), {
      ok: true,
      value: true,
    });
    assert.equal(safeJoin(otherSpelling, 'VERBS/x.md').ok, true);
  } else {
    assert.deepEqual(isPathInside(lore, join(otherSpelling, 'verbs', 'new.md')), {
      ok: true,
      value: false,
    });
  }
});

test('realpathNearest takes a name too long to exist as a missing name', (t) => {
  const base = useTempDir(t);
  const long = 'x'.repeat(400);
  assert.equal(realpathNearest(join(base, long, 'y')), join(base, long, 'y'));
  assert.equal(safeJoin(base, long).ok, true);
});

// ---------- atomic write: permissions, links, concurrent writers ----------

test('writeFileAtomic applies the mode exactly, and a rewrite with no mode keeps the file mode', async (t) => {
  const dir = useTempDir(t);
  const path = join(dir, 'token.json');
  await writeFileAtomic(path, 'one', { mode: 0o600 });
  await writeFileAtomic(path, 'two');
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(writeFileAtomicSync(path, 'three').ok, true);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(readFileSync(path, 'utf8'), 'three');
  // Bits the usual umask would take away are applied as well.
  await writeFileAtomic(join(dir, 'shared.json'), 's', { mode: 0o666 });
  assert.equal(statSync(join(dir, 'shared.json')).mode & 0o777, 0o666);
  assert.equal(writeFileAtomicSync(join(dir, 'shared2.json'), 's', { mode: 0o666 }).ok, true);
  assert.equal(statSync(join(dir, 'shared2.json')).mode & 0o777, 0o666);
});

test('writeFileAtomic replaces a symbolic link at the destination and does not write through it', async (t) => {
  const dir = useTempDir(t);
  writeFileSync(join(dir, 'victim.md'), 'untouched');
  for (const write of [writeFileAtomic, writeFileAtomicSync]) {
    const path = join(dir, `link-${write.name}.md`);
    symlinkSync(join(dir, 'victim.md'), path);
    assert.equal((await write(path, 'new')).ok, true);
    assert.equal(lstatSync(path).isSymbolicLink(), false);
    assert.equal(readFileSync(path, 'utf8'), 'new');
  }
  assert.equal(readFileSync(join(dir, 'victim.md'), 'utf8'), 'untouched');
});

test('writeFileAtomicSync that fails keeps the old content and removes its temporary file', (t) => {
  const dir = useTempDir(t);
  const locked = join(dir, 'locked');
  mkdirSync(locked);
  writeFileSync(join(locked, 'a.json'), 'old');
  chmodSync(locked, 0o500);
  try {
    const r = writeFileAtomicSync(join(locked, 'a.json'), 'new');
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.kind, 'write-failed');
  } finally {
    chmodSync(locked, 0o700);
  }
  assert.equal(readFileSync(join(locked, 'a.json'), 'utf8'), 'old');
  assert.deepEqual(readdirSync(locked), ['a.json']);
});

test('many writers of one file leave one whole content and no temporary file', async (t) => {
  const dir = useTempDir(t);
  const path = join(dir, 'claims.json');
  const texts = Array.from({ length: 25 }, (_, index) => `${index}:`.repeat(20_000));
  const results = await Promise.all(texts.map((text) => writeFileAtomic(path, text)));
  assert.equal(
    results.every((r) => r.ok),
    true,
  );
  assert.equal(texts.includes(readFileSync(path, 'utf8')), true);
  assert.deepEqual(readdirSync(dir), ['claims.json']);
});
