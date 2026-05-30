import { basename, relative } from 'node:path';
import {
  type ChainResult,
  type ChangeScope,
  type SavePoint,
  type TreeNode,
  isChainError,
  isTreeError,
  readDirectory,
} from '@ai-lore-companion/core';
import type { CommitListEntry } from '../shared/ipc.js';

/** How many recent commits the baseline dropdown shows per repo. */
export const COMMIT_LIST_LIMIT = 50;

/**
 * Attach save-point badges to a commit list. A commit whose SHA matches the
 * scope-appropriate ledger SHA (`payload_commit` for the Payload repo,
 * `lore_commit` for the Lore repo) gets the save-point's title attached so
 * the dropdown renders the badge alongside the subject line.
 */
export function attachSavePointBadges(
  commits: readonly { sha: string; subject: string; timestamp: number }[],
  savePoints: readonly SavePoint[],
  scope: ChangeScope,
): CommitListEntry[] {
  const titleBySha = new Map<string, string>();
  for (const sp of savePoints) {
    const sha = scope === 'payload' ? sp.payloadCommit : sp.loreCommit;
    titleBySha.set(sha, sp.title);
  }
  return commits.map((c) => {
    const title = titleBySha.get(c.sha);
    return title ? { ...c, savePoint: { title } } : { ...c };
  });
}

/** The Lore-folder glob — hidden from the Payload pane, which has its own. */
export function loreHide(chain: ChainResult, scope: ChangeScope): string[] {
  return scope === 'payload' && !isChainError(chain) ? [`**/${basename(chain.lorePath)}/**`] : [];
}

/**
 * What a tree read on `scope` omits: the Lore folder, plus the project's
 * `hidden`-level ignore patterns. `no-drift` and `no-search` ignores are not
 * here — they silence the watcher and the search, but do not hide the tree.
 */
export function treeHideFor(
  chain: ChainResult,
  scope: ChangeScope,
  hidden: readonly string[],
): readonly string[] {
  return [...loreHide(chain, scope), ...hidden];
}

/** Read a directory one level deep; on error, fall back to an empty node. */
export function readTreeNode(
  chain: ChainResult,
  absPath: string,
  scope: ChangeScope,
  hidden: readonly string[],
): TreeNode {
  const result = readDirectory(absPath, { ignore: treeHideFor(chain, scope, hidden) });
  if (isTreeError(result)) {
    return { name: basename(absPath), path: absPath, isDir: true, children: [] };
  }
  return result;
}

/**
 * Re-base porcelain entry paths onto the project root. Porcelain returns
 * paths relative to each repo's working tree; the renderer expects every
 * drift path to share one base (the project root) so it can group entries
 * by pane sub-root. For the Payload scope this is a no-op; for Lore we
 * prefix `<basename(lorePath)>/memory/` (or whatever `relative(root, …)`
 * gives back).
 */
export function projectRelativise(
  scope: ChangeScope,
  entries: readonly { code: string; path: string; oldPath?: string }[],
  projectRoot: string,
  loreWorkingTree: string,
): { code: string; path: string; oldPath?: string }[] {
  if (scope === 'payload') return [...entries];
  const prefix = relative(projectRoot, loreWorkingTree);
  if (!prefix) return [...entries];
  return entries.map((e) => ({
    ...e,
    path: `${prefix}/${e.path}`,
    ...(e.oldPath ? { oldPath: `${prefix}/${e.oldPath}` } : {}),
  }));
}

/**
 * Reverse of `projectRelativise` for one path. The renderer sends paths
 * relative to the project root (so it can share keys across panes); git
 * commands want them relative to the repo's working tree root.
 */
export function projectToRepoRelative(
  scope: ChangeScope,
  projectRelPath: string,
  projectRoot: string,
  loreWorkingTree: string,
): string {
  if (scope === 'payload') return projectRelPath;
  const prefix = relative(projectRoot, loreWorkingTree);
  if (!prefix) return projectRelPath;
  if (projectRelPath === prefix) return '';
  if (projectRelPath.startsWith(`${prefix}/`)) return projectRelPath.slice(prefix.length + 1);
  return projectRelPath;
}
