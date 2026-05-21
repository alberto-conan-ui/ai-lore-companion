import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { attachWatcher, createQueue, openDb, } from '../src/index.js';
function setupTempProject() {
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
function waitForEvent(predicate, attach, timeoutMs) {
    return new Promise((resolveOuter, reject) => {
        const timer = setTimeout(() => {
            off();
            reject(new Error(`timed out after ${timeoutMs}ms waiting for queue event`));
        }, timeoutMs);
        const off = attach((event) => {
            if (predicate(event)) {
                clearTimeout(timer);
                off();
                resolveOuter(event);
            }
        });
    });
}
function waitFor(predicate, timeoutMs) {
    return new Promise((resolveOuter, reject) => {
        const start = Date.now();
        const tick = () => {
            if (predicate()) {
                resolveOuter();
            }
            else if (Date.now() - start > timeoutMs) {
                reject(new Error(`timed out after ${timeoutMs}ms`));
            }
            else {
                setTimeout(tick, 25);
            }
        };
        tick();
    });
}
test('watcher emits add event when a payload file is created', async () => {
    const { root, lorePath, cleanup } = setupTempProject();
    const handle = openDb(':memory:');
    try {
        const queue = createQueue({ db: handle.db });
        const watcher = attachWatcher(queue, { root, lorePath });
        // chokidar needs a tick to wire FS listeners after construction.
        await new Promise((r) => setTimeout(r, 200));
        const target = join(root, 'src', 'new.ts');
        const eventP = waitForEvent((e) => (e.kind === 'add' || e.kind === 'replace') && e.entry.path.endsWith('new.ts'), (cb) => queue.on(cb), 2000);
        writeFileSync(target, 'export const x = 1;\n');
        const event = await eventP;
        assert.ok(event.kind === 'add' || event.kind === 'replace');
        if (event.kind === 'add' || event.kind === 'replace') {
            assert.equal(event.entry.scope, 'payload');
            assert.equal(event.entry.path, join('src', 'new.ts'));
        }
        await watcher.close();
    }
    finally {
        handle.close();
        cleanup();
    }
});
test('watcher classifies events under the lore folder as scope=lore', async () => {
    const { root, lorePath, cleanup } = setupTempProject();
    const handle = openDb(':memory:');
    try {
        const queue = createQueue({ db: handle.db });
        const watcher = attachWatcher(queue, { root, lorePath });
        await new Promise((r) => setTimeout(r, 200));
        const target = join(lorePath, 'note.md');
        const eventP = waitForEvent((e) => (e.kind === 'add' || e.kind === 'replace') && e.entry.path.endsWith('note.md'), (cb) => queue.on(cb), 2000);
        writeFileSync(target, '# note\n');
        const event = await eventP;
        if (event.kind === 'add' || event.kind === 'replace') {
            assert.equal(event.entry.scope, 'lore');
        }
        await watcher.close();
    }
    finally {
        handle.close();
        cleanup();
    }
});
test('watcher fires onDirEvent on directory add and remove, scoped per side', async () => {
    const { root, lorePath, cleanup } = setupTempProject();
    const handle = openDb(':memory:');
    try {
        const queue = createQueue({ db: handle.db });
        const dirEvents = [];
        const watcher = attachWatcher(queue, {
            root,
            lorePath,
            onDirEvent: (e) => dirEvents.push(e),
        });
        await new Promise((r) => setTimeout(r, 200));
        const payloadDir = join(root, 'src', 'feature');
        const loreDir = join(lorePath, 'notes');
        mkdirSync(payloadDir);
        mkdirSync(loreDir);
        await waitFor(() => dirEvents.some((e) => e.event === 'addDir' && e.absPath === payloadDir) &&
            dirEvents.some((e) => e.event === 'addDir' && e.absPath === loreDir), 2000);
        assert.equal(dirEvents.find((e) => e.absPath === payloadDir)?.scope, 'payload');
        assert.equal(dirEvents.find((e) => e.absPath === loreDir)?.scope, 'lore');
        rmSync(payloadDir, { recursive: true, force: true });
        await waitFor(() => dirEvents.some((e) => e.event === 'unlinkDir' && e.absPath === payloadDir), 2000);
        await watcher.close();
    }
    finally {
        handle.close();
        cleanup();
    }
});
test('watcher ignores upstream/ and process/ paths', async () => {
    const { root, lorePath, cleanup } = setupTempProject();
    mkdirSync(join(lorePath, 'upstream', 'core-0.4'), { recursive: true });
    mkdirSync(join(lorePath, 'process'), { recursive: true });
    const handle = openDb(':memory:');
    try {
        const queue = createQueue({ db: handle.db });
        const watcher = attachWatcher(queue, { root, lorePath });
        await new Promise((r) => setTimeout(r, 200));
        const events = [];
        queue.on((e) => events.push(e));
        writeFileSync(join(lorePath, 'upstream', 'core-0.4', 'a.md'), 'a');
        writeFileSync(join(lorePath, 'process', 'b.md'), 'b');
        // Real event that SHOULD fire so we have something to wait on.
        writeFileSync(join(root, 'tracked.ts'), 'export {};');
        await waitForEvent((e) => (e.kind === 'add' || e.kind === 'replace') && e.entry.path.endsWith('tracked.ts'), (cb) => queue.on(cb), 2000);
        // Give chokidar a moment to ensure the ignored writes don't also fire.
        await new Promise((r) => setTimeout(r, 200));
        const observedPaths = events
            .map((e) => (e.kind === 'add' || e.kind === 'replace' ? e.entry.path : null))
            .filter((p) => p !== null);
        assert.equal(observedPaths.some((p) => p.includes('upstream')), false);
        assert.equal(observedPaths.some((p) => p.includes('process')), false);
        await watcher.close();
    }
    finally {
        handle.close();
        cleanup();
    }
});
//# sourceMappingURL=watcher.test.js.map