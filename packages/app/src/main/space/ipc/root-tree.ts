/**
 * The tree channels of a root (`shared/ipc/space/root-tree.contract.ts`),
 * added by phase M5.2 for the tree of the Files window. Registered from
 * `./files.ts`.
 *
 * `spaceRootTreeExpand` lists one folder at a time, as the v0.8 tree does
 * (`main/ipc/tree.ts`, `treeExpand`), and takes a root id and a path relative
 * to the root in place of an absolute path. The folder, and every symbolic
 * link in it, is checked with `resolveInRoot` of `../root-files.ts`, the one
 * containment check of the Files window: a folder that leaves the root, by its
 * text or through a link, or that enters a `.git` folder is refused, and a
 * link that leads there is not listed. A `.git` folder is never listed. A
 * folder is read without a `stat` per entry, and at most
 * `ROOT_TREE_MAX_ENTRIES` entries are sent, with the folder's total.
 *
 * `spaceRootReveal` shows a file or folder of a root in the Finder. The
 * renderer names it by the root's id and a relative path, never by an
 * absolute path. Every root whose folder is known is served, tracked by git
 * or not.
 */

import { type Dirent, readdirSync, statSync } from 'node:fs';
import { z } from 'zod';
import type {
  RootTreeEntry,
  SpaceRootRevealResult,
  SpaceRootTreeExpandResult,
} from '../../../shared/ipc/space/root-tree.types.js';
import type { SpaceRootsFailure, SpaceRootsResult } from '../../../shared/ipc/space/roots.types.js';
import type { RegisterModule } from '../../ipc/types.js';
import type { SpaceContext } from '../context.js';
import { resolveInRoot } from '../root-files.js';
import { spaceRoots } from '../roots-service.js';
import { spaceRootIdSchema } from './roots.js';
import { parseArg, relativePathSchema } from './validate.js';

/** The most entries of one folder sent to the renderer. */
export const ROOT_TREE_MAX_ENTRIES = 5000;

const pathSchema = z.union([z.literal(''), relativePathSchema]);

const expandSchema = z.strictObject({ rootId: spaceRootIdSchema, path: pathSchema.optional() });

const revealSchema = z.strictObject({ rootId: spaceRootIdSchema, path: pathSchema });

/** Shows a folder or a file in the Finder. Electron's `shell` in the app; a test replaces it. */
export type RootRevealOpener = (abs: string, isDir: boolean) => void;

let revealOpener: RootRevealOpener | null = null;

/** Replace how `spaceRootReveal` shows a path. For tests. */
export function setRootRevealOpener(opener: RootRevealOpener | null): void {
  revealOpener = opener;
}

async function openInFinder(abs: string, isDir: boolean): Promise<void> {
  if (revealOpener) {
    revealOpener(abs, isDir);
    return;
  }
  const { shell } = await import('electron');
  // A folder is opened; a file is shown selected in its folder, as the v0.8 reveal does.
  if (isDir) void shell.openPath(abs);
  else shell.showItemInFolder(abs);
}

const failure = <T>(
  kind: SpaceRootsFailure['kind'],
  message: string,
  cause?: string,
): SpaceRootsResult<T> => ({
  ok: false,
  error: cause === undefined ? { kind, message } : { kind, message, cause },
});

/** The folder of a root of the calling window's Space, or why there is none. M5.6's search uses it too. */
export async function rootFolder(
  context: SpaceContext,
  sendToSpace: (root: string, channel: string, payload: unknown) => void,
  rootId: string,
): Promise<SpaceRootsResult<string>> {
  const roots = context.service(spaceRoots);
  const spaceRoot = context.root;
  roots.bind((channel, payload) => sendToSpace(spaceRoot, channel, payload));
  const held = await roots.running();
  if (!held.ok) return held;
  const root = roots.root(held.value, rootId);
  if (!root.ok) return root;
  if (root.value.path === '') {
    const message = root.value.tracking.tracked
      ? 'The folder of this root is not known.'
      : root.value.tracking.message;
    return failure('path-refused', message);
  }
  return { ok: true, value: root.value.path };
}

/**
 * The entries of the folder `folder` (relative to the root at `rootPath`),
 * folders first, each group by name, without `.git` and without a symbolic
 * link that `resolveInRoot` refuses. A link is listed as what it leads to.
 */
function listFolder(
  rootPath: string,
  folder: string,
  dirents: Dirent[],
): { entries: RootTreeEntry[]; total: number } {
  const prefix = folder === '' ? '' : `${folder}/`;
  const listed: RootTreeEntry[] = [];
  for (const dirent of dirents) {
    const { name } = dirent;
    if (name.toLowerCase() === '.git') continue;
    const path = `${prefix}${name}`;
    let isDir = dirent.isDirectory();
    if (dirent.isSymbolicLink()) {
      const target = resolveInRoot(rootPath, path, 'file');
      if (!target.ok) continue;
      try {
        isDir = statSync(target.value.abs).isDirectory();
      } catch {
        continue; // A broken link, as the v0.8 tree leaves it out.
      }
    }
    listed.push({ name, path, isDir });
  }
  listed.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  return { entries: listed.slice(0, ROOT_TREE_MAX_ENTRIES), total: listed.length };
}

/** Register `spaceRootTreeExpand` and `spaceRootReveal`. Called by `registerSpaceFiles`. */
export const registerSpaceRootTree: RegisterModule = (reg, deps) => {
  const sendToSpace = (root: string, channel: string, payload: unknown): void =>
    deps.space.sendToSpace(root, channel, payload);

  reg.handle('spaceRootTreeExpand', async (event, arg): Promise<SpaceRootTreeExpandResult> => {
    const context = deps.space.contextFor(event);
    if (!context) {
      return failure(
        'not-a-space-window',
        'The request did not come from a window of an open Space.',
      );
    }
    const parsed = parseArg(expandSchema, arg);
    if (!parsed.ok) return parsed;
    const { rootId } = parsed.value;
    try {
      const rootPath = await rootFolder(context, sendToSpace, rootId);
      if (!rootPath.ok) return rootPath;
      const folder = resolveInRoot(rootPath.value, parsed.value.path ?? '', 'folder');
      if (!folder.ok) return folder;
      let dirents: Dirent[];
      try {
        dirents = readdirSync(folder.value.abs, { withFileTypes: true });
      } catch (caught) {
        const code = (caught as NodeJS.ErrnoException).code;
        return failure(
          'path-refused',
          code === 'ENOTDIR'
            ? 'The path is a file, not a folder.'
            : 'There is no folder at this path.',
          code,
        );
      }
      const { entries, total } = listFolder(rootPath.value, folder.value.relative, dirents);
      return {
        ok: true,
        value: {
          rootId,
          path: folder.value.relative,
          entries,
          total,
          truncated: total > entries.length,
          limit: ROOT_TREE_MAX_ENTRIES,
        },
      };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      context.log.error('root-tree-failed', { space: context.key, message });
      return failure('roots-unavailable', message);
    }
  });

  reg.handle('spaceRootReveal', async (event, arg): Promise<SpaceRootRevealResult> => {
    const context = deps.space.contextFor(event);
    if (!context) {
      return failure(
        'not-a-space-window',
        'The request did not come from a window of an open Space.',
      );
    }
    const parsed = parseArg(revealSchema, arg);
    if (!parsed.ok) return parsed;
    try {
      const rootPath = await rootFolder(context, sendToSpace, parsed.value.rootId);
      if (!rootPath.ok) return rootPath;
      const target = resolveInRoot(rootPath.value, parsed.value.path, 'folder');
      if (!target.ok) return target;
      let isDir: boolean;
      try {
        isDir = statSync(target.value.abs).isDirectory();
      } catch {
        return failure('path-refused', 'There is no file or folder at this path.');
      }
      await openInFinder(target.value.abs, isDir);
      return { ok: true, value: null };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      context.log.error('root-reveal-failed', { space: context.key, message });
      return failure('roots-unavailable', message);
    }
  });
};
