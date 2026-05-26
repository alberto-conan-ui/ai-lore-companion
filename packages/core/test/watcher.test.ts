import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { type DirEvent, type FileChangeEvent, attachWatcher } from '../src/index.js';

function setupTempProject(): { root: string; lorePath: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'cockpit-watch-'));
  const lorePath = join(root, '.ai-lore-test-project');
  mkdirSync(lorePath, { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  return {
    root,
    lorePath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolveOuter, reject) => {
    const start = Date.now();
    const tick = (): void => {
      if (predicate()) {
        resolveOuter();
      } else if (Date.now() - start > timeoutMs) {
        reject(new Error(`timed out after ${timeoutMs}ms`));
      } else {
        setTimeout(tick, 25);
      }
    };
    tick();
  });
}

test('watcher fires onFileChange when a payload file is created', async () => {
  const { root, lorePath, cleanup } = setupTempProject();
  try {
    const events: FileChangeEvent[] = [];
    const watcher = attachWatcher({
      root,
      lorePath,
      onFileChange: (e) => events.push(e),
    });

    await new Promise((r) => setTimeout(r, 200));

    const target = join(root, 'src', 'new.ts');
    writeFileSync(target, 'export const x = 1;\n');
    await waitFor(() => events.some((e) => e.event === 'add' && e.absPath === target), 2000);
    assert.equal(events.find((e) => e.absPath === target)?.scope, 'payload');

    await watcher.close();
  } finally {
    cleanup();
  }
});

test('watcher classifies events under the lore folder as scope=lore', async () => {
  const { root, lorePath, cleanup } = setupTempProject();
  try {
    const events: FileChangeEvent[] = [];
    const watcher = attachWatcher({
      root,
      lorePath,
      onFileChange: (e) => events.push(e),
    });

    await new Promise((r) => setTimeout(r, 200));

    const target = join(lorePath, 'note.md');
    writeFileSync(target, '# note\n');
    await waitFor(() => events.some((e) => e.absPath === target), 2000);
    assert.equal(events.find((e) => e.absPath === target)?.scope, 'lore');

    await watcher.close();
  } finally {
    cleanup();
  }
});

test('watcher fires onDirEvent on directory add and remove, scoped per side', async () => {
  const { root, lorePath, cleanup } = setupTempProject();
  try {
    const dirEvents: DirEvent[] = [];
    const watcher = attachWatcher({
      root,
      lorePath,
      onDirEvent: (e) => dirEvents.push(e),
    });

    await new Promise((r) => setTimeout(r, 200));

    const payloadDir = join(root, 'src', 'feature');
    const loreDir = join(lorePath, 'notes');
    mkdirSync(payloadDir);
    mkdirSync(loreDir);

    await waitFor(
      () =>
        dirEvents.some((e) => e.event === 'addDir' && e.absPath === payloadDir) &&
        dirEvents.some((e) => e.event === 'addDir' && e.absPath === loreDir),
      2000,
    );
    assert.equal(dirEvents.find((e) => e.absPath === payloadDir)?.scope, 'payload');
    assert.equal(dirEvents.find((e) => e.absPath === loreDir)?.scope, 'lore');

    rmSync(payloadDir, { recursive: true, force: true });
    await waitFor(
      () => dirEvents.some((e) => e.event === 'unlinkDir' && e.absPath === payloadDir),
      2000,
    );

    await watcher.close();
  } finally {
    cleanup();
  }
});

test('watcher fires onDirEvent on file add and unlink so the tree refreshes', async () => {
  const { root, lorePath, cleanup } = setupTempProject();
  try {
    const dirEvents: DirEvent[] = [];
    const watcher = attachWatcher({
      root,
      lorePath,
      onDirEvent: (e) => dirEvents.push(e),
    });

    await new Promise((r) => setTimeout(r, 200));

    const target = join(root, 'src', 'new.ts');
    writeFileSync(target, 'export const x = 1;\n');
    await waitFor(() => dirEvents.some((e) => e.event === 'add' && e.absPath === target), 2000);
    assert.equal(dirEvents.find((e) => e.absPath === target)?.scope, 'payload');

    rmSync(target);
    await waitFor(() => dirEvents.some((e) => e.event === 'unlink' && e.absPath === target), 2000);

    await watcher.close();
  } finally {
    cleanup();
  }
});

test('watcher fires both onFileChange and onDirEvent on an add (host can listen to either)', async () => {
  const { root, lorePath, cleanup } = setupTempProject();
  try {
    const fileEvents: FileChangeEvent[] = [];
    const dirEvents: DirEvent[] = [];
    const watcher = attachWatcher({
      root,
      lorePath,
      onFileChange: (e) => fileEvents.push(e),
      onDirEvent: (e) => dirEvents.push(e),
    });

    await new Promise((r) => setTimeout(r, 200));

    const target = join(lorePath, 'memory.index.md');
    writeFileSync(target, '# memory\n');
    await waitFor(
      () =>
        fileEvents.some((e) => e.absPath === target) &&
        dirEvents.some((e) => e.absPath === target),
      2000,
    );

    await watcher.close();
  } finally {
    cleanup();
  }
});

test('watcher ignores upstream/ and process/ paths', async () => {
  const { root, lorePath, cleanup } = setupTempProject();
  mkdirSync(join(lorePath, 'upstream', 'core-0.4'), { recursive: true });
  mkdirSync(join(lorePath, 'process'), { recursive: true });
  try {
    const events: FileChangeEvent[] = [];
    const watcher = attachWatcher({
      root,
      lorePath,
      ignored: ['**/upstream/**', '**/process/**'],
      onFileChange: (e) => events.push(e),
    });

    await new Promise((r) => setTimeout(r, 200));

    writeFileSync(join(lorePath, 'upstream', 'core-0.4', 'a.md'), 'a');
    writeFileSync(join(lorePath, 'process', 'b.md'), 'b');
    // Real event that SHOULD fire so we have something to wait on.
    writeFileSync(join(root, 'tracked.ts'), 'export {};');

    await waitFor(() => events.some((e) => e.absPath.endsWith('tracked.ts')), 2000);
    // Give chokidar a moment to ensure the ignored writes don't also fire.
    await new Promise((r) => setTimeout(r, 200));

    assert.equal(
      events.some((e) => e.absPath.includes('upstream')),
      false,
    );
    assert.equal(
      events.some((e) => e.absPath.includes('process')),
      false,
    );

    await watcher.close();
  } finally {
    cleanup();
  }
});
