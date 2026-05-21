import { readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { createIgnoreMatcher } from '../ignore.js';
export function isTreeError(result) {
    return 'error' in result;
}
/**
 * Read one level of a directory and return a TreeNode rooted at `absPath`,
 * populated with its immediate children. Each child carries `name`, `path`,
 * and `isDir`; `children` is left undefined on directory children — callers
 * call `readDirectory` again on the child path to expand it.
 *
 * Synchronous and pure-Node. The ignore list is consulted against each child's
 * basename; matching entries are omitted. Children whose `stat` throws
 * (permissions, broken symlinks, races) are omitted, not fatal.
 */
export function readDirectory(absPath, opts) {
    let rootStat;
    try {
        rootStat = statSync(absPath);
    }
    catch (err) {
        return { error: `cannot read directory: ${err.message}` };
    }
    if (!rootStat.isDirectory()) {
        return { error: `not a directory: ${absPath}` };
    }
    let entries;
    try {
        entries = readdirSync(absPath);
    }
    catch (err) {
        return { error: `cannot read directory: ${err.message}` };
    }
    const isIgnored = createIgnoreMatcher(opts.ignore);
    const children = [];
    for (const name of entries) {
        if (isIgnored(name))
            continue;
        const childPath = join(absPath, name);
        let childStat;
        try {
            childStat = statSync(childPath);
        }
        catch {
            continue;
        }
        children.push({
            name,
            path: childPath,
            isDir: childStat.isDirectory(),
            size: childStat.size,
            mtimeMs: childStat.mtimeMs,
        });
    }
    children.sort(compareChildren);
    return {
        name: basename(absPath),
        path: absPath,
        isDir: true,
        size: rootStat.size,
        mtimeMs: rootStat.mtimeMs,
        children,
    };
}
function compareChildren(a, b) {
    if (a.isDir !== b.isDir)
        return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
}
function basename(absPath) {
    const last = absPath
        .split(sep)
        .filter((s) => s.length > 0)
        .pop();
    return last ?? absPath;
}
//# sourceMappingURL=tree.js.map