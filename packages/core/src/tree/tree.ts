import { type Stats, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { createIgnoreMatcher } from '../ignore.js';

export type TreeNode = {
  name: string;
  path: string;
  isDir: boolean;
  /** Byte size from `stat`. */
  size?: number;
  /** Modification time in epoch milliseconds, from `stat`. */
  mtimeMs?: number;
  children?: TreeNode[];
};

export type TreeError = { error: string };

export type TreeResult = TreeNode | TreeError;

export type ReadDirectoryOptions = {
  ignore: readonly string[];
};

export function isTreeError(result: TreeResult): result is TreeError {
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
export function readDirectory(absPath: string, opts: ReadDirectoryOptions): TreeResult {
  let rootStat: Stats;
  try {
    rootStat = statSync(absPath);
  } catch (err) {
    return { error: `cannot read directory: ${(err as Error).message}` };
  }
  if (!rootStat.isDirectory()) {
    return { error: `not a directory: ${absPath}` };
  }

  let entries: string[];
  try {
    entries = readdirSync(absPath);
  } catch (err) {
    return { error: `cannot read directory: ${(err as Error).message}` };
  }

  const isIgnored = createIgnoreMatcher(opts.ignore);

  const children: TreeNode[] = [];
  for (const name of entries) {
    if (isIgnored(name)) continue;
    const childPath = join(absPath, name);
    let childStat: Stats;
    try {
      childStat = statSync(childPath);
    } catch {
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

function compareChildren(a: TreeNode, b: TreeNode): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function basename(absPath: string): string {
  const last = absPath
    .split(sep)
    .filter((s) => s.length > 0)
    .pop();
  return last ?? absPath;
}
