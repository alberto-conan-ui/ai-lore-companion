import { sep } from 'node:path';
/**
 * Classify a Lore-relative path as a tracker file kind, or null if it is not a
 * tracker instance.
 *
 *   memory/status/focus/<name>.focus.md              → focus
 *   memory/action-tree/<focus>/<name>.index.md       → at-node (container)
 *   memory/action-tree/<focus>/<name>.phase.md       → at-node (leaf)
 *
 * The folder navigation indexes (focus.index.md, action-tree.index.md) and the
 * status.index.md itself are NOT trackers in this convention — they are nav
 * nodes whose state is captured elsewhere (Mode field on status, structure
 * alone on nav indexes).
 */
export function classifyTrackerFile(loreRelPath) {
    const norm = loreRelPath.split(sep).join('/');
    if (/^memory\/status\/focus\/[^/]+\.focus\.md$/.test(norm))
        return 'focus';
    if (/^memory\/action-tree\/[^/]+\/[^/]+\.phase\.md$/.test(norm))
        return 'at-node';
    // AT container indexes — name is anything ending in `.index.md` but exclude
    // the `action-tree.index.md` folder nav at the top.
    if (/^memory\/action-tree\/[^/]+\/[^/]+\.index\.md$/.test(norm))
        return 'at-node';
    return null;
}
//# sourceMappingURL=classifier.js.map