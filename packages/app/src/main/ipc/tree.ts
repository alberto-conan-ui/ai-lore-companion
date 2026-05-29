import { statSync } from 'node:fs';
import { isTreeError, readDirectory } from '@ai-lore-companion/core';
import { shell } from 'electron';
import type { FileSearchArg, FileSearchHit, TreeExpandArg } from '../../shared/ipc.js';
import { loreHide, treeHideFor } from '../path-mapping.js';
import type { RegisterModule } from './types.js';

/** Trees, file search, and path open/reveal. */
export const registerTree: RegisterModule = (reg, deps) => {
  reg.handle('openPath', (_event, path) => shell.openPath(path));

  reg.on('revealInFinder', (_event, path) => {
    // `showItemInFolder` reveals files (highlights them in their parent). For
    // folders it would show the *parent* directory, which is the wrong target
    // — for folders we want Finder to open *into* them. statSync picks the
    // right form.
    let isDir = false;
    try {
      isDir = statSync(path).isDirectory();
    } catch {
      // Path may not exist; fall through to showItemInFolder.
    }
    if (isDir) {
      void shell.openPath(path);
    } else {
      shell.showItemInFolder(path);
    }
  });

  reg.handle('treeExpand', (event, arg: TreeExpandArg) => {
    const ctx = deps.contextFor(event);
    if (!ctx) return [];
    const result = readDirectory(arg.path, {
      ignore: treeHideFor(ctx.chain, arg.scope, ctx.ignoreLists.hidden),
    });
    return isTreeError(result) ? [] : (result.children ?? []);
  });

  reg.handle('searchFiles', (event, arg: FileSearchArg) => {
    const ctx = deps.contextFor(event);
    if (!ctx) return [];
    const query = arg.query.trim().toLowerCase();
    if (query.length === 0) return [];
    // Skip the project's `no-search` and `hidden` ignores, plus the Lore
    // folder — for walk speed and so the results stay sensible.
    const ignore = [...loreHide(ctx.chain, 'payload'), ...ctx.ignoreLists.search];
    const LIMIT = 40;
    const hits: FileSearchHit[] = [];
    const walk = (dir: string): void => {
      if (hits.length >= LIMIT) return;
      const result = readDirectory(dir, { ignore });
      if (isTreeError(result)) return;
      for (const child of result.children ?? []) {
        if (hits.length >= LIMIT) break;
        if (child.isDir) walk(child.path);
        else if (child.name.toLowerCase().includes(query)) {
          hits.push({ name: child.name, path: child.path });
        }
      }
    };
    for (const dir of arg.dirs) walk(dir);
    return hits;
  });
};
