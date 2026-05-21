import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { attachWatcher, createQueue, openDb } from '../src/index.js';
function setupTempProject() {
    const root = mkdtempSync(join(tmpdir(), 'cockpit-tracker-'));
    const lorePath = join(root, '.ai-lore-test-project');
    const atDir = join(lorePath, 'memory', 'action-tree', 'demo');
    mkdirSync(atDir, { recursive: true });
    return {
        root,
        lorePath,
        phasePath: join(atDir, 'A-phase.phase.md'),
        cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
}
function buildPhase(status, body = 'gate body') {
    const statusBlock = status === null ? '' : `> **Status:** ${status}\n\n`;
    return `# Phase A — Demo\n\n${statusBlock}> **References**\n>\n> | Group  | File |\n> |--------|------|\n> | Parent | ./parent.md |\n\n## Gate\n\n${body}\n`;
}
function attachCollector(queue) {
    const events = [];
    const off = queue.on((e) => events.push(e));
    return { events, detach: off };
}
const SETTLE_MS = 300;
const WATCHER_READY_MS = 250;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function transitionEntries(events) {
    return events
        .filter((e) => e.kind === 'add' || e.kind === 'replace')
        .map((e) => (e.kind === 'add' || e.kind === 'replace' ? e.entry : null))
        .filter((e) => e !== null);
}
test('Active → Review produces exactly one tracker-review event', async () => {
    const { root, lorePath, phasePath, cleanup } = setupTempProject();
    const handle = openDb(':memory:');
    try {
        const queue = createQueue({ db: handle.db });
        const watcher = attachWatcher(queue, { root, lorePath });
        await wait(WATCHER_READY_MS);
        const c = attachCollector(queue);
        writeFileSync(phasePath, buildPhase('Active'));
        await wait(SETTLE_MS);
        writeFileSync(phasePath, buildPhase('Review'));
        await wait(SETTLE_MS);
        const entries = transitionEntries(c.events);
        const reviewEvents = entries.filter((e) => e.type === 'tracker-review');
        assert.equal(reviewEvents.length, 1, `expected 1 tracker-review, got ${reviewEvents.length}`);
        assert.equal(reviewEvents[0]?.subject?.kind, 'at-node');
        assert.equal(reviewEvents[0]?.subject?.title, 'Phase A — Demo');
        c.detach();
        await watcher.close();
    }
    finally {
        handle.close();
        cleanup();
    }
});
test('Review → Review produces zero tracker-review events', async () => {
    const { root, lorePath, phasePath, cleanup } = setupTempProject();
    const handle = openDb(':memory:');
    try {
        const queue = createQueue({ db: handle.db });
        const watcher = attachWatcher(queue, { root, lorePath });
        await wait(WATCHER_READY_MS);
        // Seed at Review so the first observation snapshot has Review.
        writeFileSync(phasePath, buildPhase('Review'));
        await wait(SETTLE_MS);
        const c = attachCollector(queue);
        writeFileSync(phasePath, buildPhase('Review', 'edited body'));
        await wait(SETTLE_MS);
        writeFileSync(phasePath, buildPhase('Review', 'edited body again'));
        await wait(SETTLE_MS);
        const entries = transitionEntries(c.events);
        assert.equal(entries.filter((e) => e.type === 'tracker-review').length, 0);
        c.detach();
        await watcher.close();
    }
    finally {
        handle.close();
        cleanup();
    }
});
test('Review → Active → Review produces a second tracker-review', async () => {
    const { root, lorePath, phasePath, cleanup } = setupTempProject();
    const handle = openDb(':memory:');
    try {
        const queue = createQueue({ db: handle.db });
        const watcher = attachWatcher(queue, { root, lorePath });
        await wait(WATCHER_READY_MS);
        writeFileSync(phasePath, buildPhase('Active'));
        await wait(SETTLE_MS);
        const c = attachCollector(queue);
        writeFileSync(phasePath, buildPhase('Review'));
        await wait(SETTLE_MS);
        writeFileSync(phasePath, buildPhase('Active'));
        await wait(SETTLE_MS);
        writeFileSync(phasePath, buildPhase('Review'));
        await wait(SETTLE_MS);
        const reviewCount = transitionEntries(c.events).filter((e) => e.type === 'tracker-review').length;
        assert.equal(reviewCount, 2, `expected 2 tracker-review events, got ${reviewCount}`);
        c.detach();
        await watcher.close();
    }
    finally {
        handle.close();
        cleanup();
    }
});
test('tracker file with no Status block never produces tracker-review events', async () => {
    const { root, lorePath, phasePath, cleanup } = setupTempProject();
    const handle = openDb(':memory:');
    try {
        const queue = createQueue({ db: handle.db });
        const watcher = attachWatcher(queue, { root, lorePath });
        await wait(WATCHER_READY_MS);
        const c = attachCollector(queue);
        writeFileSync(phasePath, buildPhase(null));
        await wait(SETTLE_MS);
        writeFileSync(phasePath, buildPhase(null, 'updated body'));
        await wait(SETTLE_MS);
        const entries = transitionEntries(c.events);
        assert.equal(entries.filter((e) => e.type === 'tracker-review').length, 0);
        // But normal change/add events should still flow.
        assert.ok(entries.length > 0, 'expected file events to flow even without Status block');
        c.detach();
        await watcher.close();
    }
    finally {
        handle.close();
        cleanup();
    }
});
//# sourceMappingURL=tracker-watcher.test.js.map