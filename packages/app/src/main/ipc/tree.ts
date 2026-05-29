import { statSync } from 'node:fs';
import { isTreeError, readDirectory } from '@ai-lore-companion/core';
import { shell } from 'electron';
import type {
  ContentSearchArg,
  ContentSearchResult,
  FileSearchArg,
  FileSearchHit,
  TreeExpandArg,
} from '../../shared/ipc.js';
import { loreHide, treeHideFor } from '../path-mapping.js';
import { searchContent } from '../search/content.js';
import type { RegisterModule } from './types.js';

/** Max content hits returned to the renderer per keystroke. */
const CONTENT_CAP = 50;

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

  reg.handle('searchFiles', async (event, arg: FileSearchArg): Promise<FileSearchHit[]> => {
    const ctx = deps.contextFor(event);
    if (!ctx) return [];

    // The service owns the index — built once, kept fresh by the watcher, and
    // (in production) running in a `utilityProcess` off the main thread. Skip
    // the project's `no-search` / `hidden` ignores plus the Lore folder — the
    // same exclusion set the old per-keystroke walk used. Rank-then-slice: the
    // cap is a render limit on already-ranked hits, not a walk-order cut.
    const ignore = [...loreHide(ctx.chain, 'payload'), ...ctx.ignoreLists.search];
    const RENDER_CAP = 40;
    return ctx.search.search({ dirs: arg.dirs, ignore, query: arg.query, limit: RENDER_CAP });
  });

  reg.handle(
    'searchContent',
    async (event, arg: ContentSearchArg): Promise<ContentSearchResult> => {
      const ctx = deps.contextFor(event);
      if (!ctx) return { hits: [], ripgrepMissing: false };
      // Same exclusion set as the name search: the project's `no-search` /
      // `hidden` ignores plus the Lore folder. ripgrep also honours .gitignore.
      const ignore = [...loreHide(ctx.chain, 'payload'), ...ctx.ignoreLists.search];
      return searchContent({ dirs: arg.dirs, query: arg.query, ignore, limit: CONTENT_CAP });
    },
  );
};
