/**
 * Ripgrep-backed content search (Focus 3 Phase 3) — the "content search via
 * ripgrep" gate clause. Where the path index answers "find a file by name",
 * this answers "find a file by what's inside it".
 *
 * ripgrep is detected on PATH (Homebrew dirs included, as for the cockpit's
 * other CLI spawns); when it is absent, the result carries `ripgrepMissing:
 * true` so the renderer can hint at installing it rather than implying the
 * project has no matches. Vendoring `rg` so it always works regardless of PATH
 * is a deliberate later step (see the focus's Phase 3 note).
 *
 * The parser is split out and pure so it can be unit-tested without a real `rg`
 * on PATH (the CI fast tier has none guaranteed).
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { basename } from 'node:path';
import type { ContentSearchHit, ContentSearchResult } from '../../shared/ipc.js';
import { augmentedPath } from '../spawn-detached.js';

/** Max matches reported per file — keeps one hot file from flooding results. */
const PER_FILE_CAP = 5;
/** Trim a snippet to a sane width for the dropdown. */
const SNIPPET_MAX = 200;
/** Stop reading once ripgrep's output passes this — bounds memory on huge repos.
 *  The parse still applies the caller's `limit`; this only caps what we buffer. */
const OUTPUT_CEILING = 512 * 1024;

/**
 * Parse ripgrep `--json` stdout into content hits, capped at `limit`. Each
 * `{"type":"match"}` line yields one hit: the file, the 1-based line and column,
 * and the matching line's text as a trimmed snippet. Malformed or non-match
 * lines are skipped. Pure — no I/O.
 */
export function parseRipgrepJson(stdout: string, limit: number): ContentSearchHit[] {
  const hits: ContentSearchHit[] = [];
  for (const raw of stdout.split('\n')) {
    if (hits.length >= limit) break;
    const line = raw.trim();
    if (line === '') continue;

    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isMatchRecord(obj)) continue;

    const path = obj.data.path?.text;
    if (typeof path !== 'string') continue; // non-UTF8 path (`{bytes}`) — skip.

    const lineNumber = typeof obj.data.line_number === 'number' ? obj.data.line_number : 0;
    const firstSub = obj.data.submatches?.[0];
    const column = firstSub && typeof firstSub.start === 'number' ? firstSub.start + 1 : 1;
    const lineText = typeof obj.data.lines?.text === 'string' ? obj.data.lines.text : '';
    const snippet = lineText
      .replace(/\r?\n$/, '')
      .trim()
      .slice(0, SNIPPET_MAX);

    hits.push({ name: basename(path), path, line: lineNumber, column, snippet });
  }
  return hits;
}

type MatchRecord = {
  type: 'match';
  data: {
    path?: { text?: string };
    line_number?: number;
    lines?: { text?: string };
    submatches?: Array<{ start?: number }>;
  };
};

function isMatchRecord(obj: unknown): obj is MatchRecord {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    (obj as { type?: unknown }).type === 'match' &&
    typeof (obj as { data?: unknown }).data === 'object'
  );
}

export type ContentSearchOptions = {
  dirs: readonly string[];
  query: string;
  /** chokidar-style ignore globs — passed to rg as `--glob !<pattern>`. */
  ignore: readonly string[];
  /** Max total hits to return. */
  limit: number;
};

/**
 * Run a literal, smart-case content search through ripgrep across `dirs`.
 * Resolves `{ hits: [], ripgrepMissing: true }` when `rg` is not on PATH;
 * never rejects — a search box must not crash on a missing binary.
 */
export function searchContent(opts: ContentSearchOptions): Promise<ContentSearchResult> {
  const query = opts.query.trim();
  if (query.length === 0 || opts.dirs.length === 0) {
    return Promise.resolve({ hits: [], ripgrepMissing: false });
  }

  const args = [
    '--json',
    '--fixed-strings',
    '--smart-case',
    '--max-count',
    String(PER_FILE_CAP),
    ...opts.ignore.flatMap((glob) => ['--glob', `!${glob}`]),
    '--',
    query,
    ...opts.dirs,
  ];

  return new Promise((resolve) => {
    let settled = false;
    const done = (result: ContentSearchResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let child: ChildProcess;
    try {
      child = spawn('rg', args, { env: { ...process.env, PATH: augmentedPath() } });
    } catch {
      done({ hits: [], ripgrepMissing: true });
      return;
    }

    let out = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      if (out.length > OUTPUT_CEILING) child.kill();
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      done({ hits: [], ripgrepMissing: err.code === 'ENOENT' });
    });
    child.on('close', () => {
      done({ hits: parseRipgrepJson(out, opts.limit), ripgrepMissing: false });
    });
  });
}
