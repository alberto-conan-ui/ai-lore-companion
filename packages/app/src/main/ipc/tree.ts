import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  createIgnoreMatcher,
  isTreeError,
  rankPaths,
  readDirectory,
} from '@ai-lore-companion/core';
import { clipboard, shell } from 'electron';
import type {
  ContentSearchArg,
  ContentSearchResult,
  FileSearchArg,
  FileSearchHit,
  FileWriteArg,
  FileWriteResult,
  ReadFileArg,
  ReadFileResult,
  TreeExpandArg,
} from '../../shared/ipc.js';
import { loreHide, treeHideFor } from '../path-mapping.js';
import { listFiles, searchContent } from '../search/content.js';
import type { RegisterModule } from './types.js';

/** Max content hits returned to the renderer per keystroke. */
const CONTENT_CAP = 50;

/** Cap for the in-app read-only viewer (Read-only IDE P1). Larger files route
 *  back to the OS opener rather than loading megabytes into the renderer. */
const MAX_TEXT_BYTES = 2_000_000;

/** Trees, file search, and path open/reveal. */
export const registerTree: RegisterModule = (reg, deps) => {
  reg.handle('openPath', (_event, path) => shell.openPath(path));

  reg.on('copyText', (_event, text) => clipboard.writeText(text));

  // Read a file's text for the in-app viewer. The decision of what opens in-app
  // vs hands off to the OS lives here (content sniff + size cap), so the renderer
  // routes uniformly: 'text' → editor, anything else → openPath. Read-only — this
  // only reads; nothing is written.
  reg.handle('readFile', (_event, arg: ReadFileArg): ReadFileResult => {
    try {
      const st = statSync(arg.path);
      if (!st.isFile()) return { kind: 'failed', message: 'not a regular file' };
      if (st.size > MAX_TEXT_BYTES) return { kind: 'too-large', bytes: st.size };
      const buf = readFileSync(arg.path);
      // A NUL byte in the first 8 KB marks the file binary — the same heuristic
      // git uses. Cheap, and right for the source/markdown/JSON this app shows.
      if (buf.subarray(0, 8192).includes(0)) return { kind: 'binary' };
      return { kind: 'text', text: buf.toString('utf8') };
    } catch (err) {
      return { kind: 'failed', message: (err as Error).message };
    }
  });

  // Write a file's text back to disk (markdown authoring, P3). The renderer owns
  // the exact bytes — the CodeMirror document is the source of truth — so main
  // writes them UTF-8 verbatim and a save with no edit round-trips byte-clean.
  // Mirrors `readFile`'s posture: no path guard (the renderer only ever saves a
  // doc it opened from the project tree); failures come back tagged, not thrown.
  reg.handle('fileWrite', (event, arg: FileWriteArg): FileWriteResult => {
    try {
      writeFileSync(arg.path, arg.text, 'utf8');
      // Reflect the save in the drift/Changes view immediately, rather than
      // waiting on the filesystem watcher (which debounces via awaitWriteFinish,
      // ~100ms, and can miss a self-write) — the app just wrote the file, so it
      // knows its own drift changed. Best-effort: no wiring on a non-project window.
      deps.contextFor(event)?.wiring?.changes.refreshNow();
      return { kind: 'ok' };
    } catch (err) {
      return { kind: 'failed', message: (err as Error).message };
    }
  });

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
