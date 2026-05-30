import { statSync } from 'node:fs';
import { basename } from 'node:path';
import {
  createIgnoreMatcher,
  isTreeError,
  rankPaths,
  readDirectory,
} from '@ai-lore-companion/core';
import { shell } from 'electron';
import type {
  ContentSearchArg,
  ContentSearchResult,
  FileSearchArg,
  FileSearchHit,
  TreeExpandArg,
} from '../../shared/ipc.js';
import { loreHide, treeHideFor } from '../path-mapping.js';
import { listFiles, searchContent } from '../search/content.js';
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
    const RENDER_CAP = 40;
    const ignore = [...loreHide(ctx.chain, 'payload'), ...ctx.ignoreLists.search];

    // Include-ignored lists everything under the scope via `rg --files
    // --no-ignore --hidden` (a superset of the index — it includes the
    // un-ignored files too), ranked with the same fuzzy/glob matcher, ignored
    // hits tagged for the dialog's badge. When `rg` yields nothing (it's not
    // installed yet, or no files), fall through to the watcher-fed index so the
    // name search still returns its un-ignored hits — ticking the box must
    // never *lose* the matches the default search already showed.
    if (arg.includeIgnored) {
      const files = await listFiles(arg.dirs, true);
      if (files.length > 0) {
        const entries = files.map((p): [string, string] => [p, basename(p)]);
        const isIgnored = createIgnoreMatcher(ignore);
        return rankPaths(entries, arg.query, RENDER_CAP).map((h) => ({
          name: h.name,
          path: h.path,
          ignored: isIgnored(h.path),
        }));
      }
    }

    // Default: the service owns the index — built once, kept fresh by the
    // watcher, and (in production) running in a `utilityProcess` off the main
    // thread. Skip the project's `no-search` / `hidden` ignores plus the Lore
    // folder. Rank-then-slice: the cap is a render limit, not a walk-order cut.
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
      const result = await searchContent({
        dirs: arg.dirs,
        query: arg.query,
        ignore,
        limit: CONTENT_CAP,
        includeIgnored: arg.includeIgnored,
      });
      if (!arg.includeIgnored) return result;
      // Badge matches that live in normally-ignored files.
      const isIgnored = createIgnoreMatcher(ignore);
      return { ...result, hits: result.hits.map((h) => ({ ...h, ignored: isIgnored(h.path) })) };
    },
  );
};
