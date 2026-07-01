import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import writeFileAtomic from 'write-file-atomic';

/**
 * The one disk binding every JSON sidecar store shares. Reads are tolerant —
 * a missing or unparsable file reads as `undefined` and the caller supplies
 * its default. Writes are **atomic** (via `write-file-atomic`: staged tmp
 * file + rename, with fsync) — a crash mid-write never leaves a torn file;
 * a concurrent reader sees the old content or the new, nothing in between.
 * Before this module every store called `writeFileSync` directly, so a crash
 * could truncate `settings.json` (or any sidecar) to garbage.
 */

/** The file's text, or `undefined` when it is absent or unreadable. */
export function readTextFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** The file parsed as JSON, or `undefined` when absent or unparsable. */
export function readJsonFile(path: string): unknown {
  const text = readTextFile(path);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Atomically write `text`, creating the parent directory if needed. */
export function writeTextFileAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic.sync(path, text);
}

/** Atomically write `value` as JSON; `pretty` matches the stores that keep
 *  their sidecars human-readable (2-space indent). */
export function writeJsonFileAtomic(
  path: string,
  value: unknown,
  opts?: { pretty?: boolean },
): void {
  writeTextFileAtomic(path, JSON.stringify(value, null, opts?.pretty ? 2 : undefined));
}
