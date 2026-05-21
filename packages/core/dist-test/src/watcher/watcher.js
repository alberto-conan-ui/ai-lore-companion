import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import chokidar from 'chokidar';
import { DEFAULT_IGNORED } from '../ignore.js';
import { classifyTrackerFile } from '../tracker/classifier.js';
import { createTransitionDetector } from '../tracker/detector.js';
import { parseStatus, parseTitle } from '../tracker/parser.js';
export function attachWatcher(queue, options) {
    const { root, lorePath } = options;
    const ignored = [...DEFAULT_IGNORED, ...(options.ignored ?? [])];
    const loreRel = relative(root, lorePath);
    const detector = createTransitionDetector();
    const watcher = chokidar.watch(root, {
        ignored,
        ignoreInitial: true,
        persistent: true,
        awaitWriteFinish: {
            stabilityThreshold: 100,
            pollInterval: 50,
        },
    });
    const handle = (chokidarEvent, absPath) => {
        const rel = relative(root, absPath);
        if (!rel || rel.startsWith('..'))
            return;
        const scope = classifyScope(rel, loreRel);
        const loreRelPath = scope === 'lore' && loreRel ? relative(lorePath, absPath) : null;
        const trackerKind = loreRelPath ? classifyTrackerFile(loreRelPath) : null;
        const ts = Date.now();
        // Non-tracker files (or tracker unlinks) always emit a normal change event.
        if (!trackerKind) {
            queue.push({ path: rel, type: chokidarEvent, scope, ts });
            return;
        }
        if (chokidarEvent === 'unlink') {
            detector.forget(absPath);
            queue.push({ path: rel, type: 'unlink', scope, ts });
            return;
        }
        // Tracker file change — try to detect a Status transition.
        let text;
        try {
            text = readFileSync(absPath, 'utf8');
        }
        catch {
            // File vanished between event and read; fall back to a normal event.
            queue.push({ path: rel, type: chokidarEvent, scope, ts });
            return;
        }
        const status = parseStatus(text);
        const result = detector.observe({ key: absPath, status });
        if (result.kind === 'transition') {
            const title = parseTitle(text) ?? rel;
            queue.push({
                path: rel,
                type: 'tracker-review',
                scope,
                ts,
                subject: { kind: trackerKind, title },
            });
            return;
        }
        queue.push({ path: rel, type: chokidarEvent, scope, ts });
    };
    watcher.on('add', (p) => handle('add', p));
    watcher.on('change', (p) => handle('change', p));
    watcher.on('unlink', (p) => handle('unlink', p));
    // Directory events bypass `handle` (the queue-push path) entirely — they
    // drive tree-state updates, not queue notifications.
    const onDirEvent = options.onDirEvent;
    if (onDirEvent) {
        const emitDir = (event, absPath) => {
            const rel = relative(root, absPath);
            if (!rel || rel.startsWith('..'))
                return;
            onDirEvent({ event, absPath, scope: classifyScope(rel, loreRel) });
        };
        watcher.on('addDir', (p) => emitDir('addDir', p));
        watcher.on('unlinkDir', (p) => emitDir('unlinkDir', p));
    }
    return {
        close: () => watcher.close(),
    };
}
function classifyScope(relPath, loreRel) {
    if (!loreRel)
        return 'payload';
    const normalized = relPath.split(sep).join('/');
    const lore = loreRel.split(sep).join('/');
    return normalized === lore || normalized.startsWith(`${lore}/`) ? 'lore' : 'payload';
}
//# sourceMappingURL=watcher.js.map