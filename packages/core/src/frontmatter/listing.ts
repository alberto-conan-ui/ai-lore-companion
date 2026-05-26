import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseMemoryFile } from './parser.js';
import type { MemoryFrontmatter } from './types.js';

export type MemoryEntry = {
  /** Absolute path to the file. */
  path: string;
  /** Filename without the directory. */
  name: string;
  /** Parsed frontmatter, or null if missing/malformed. */
  frontmatter: MemoryFrontmatter | null;
  /** Body content (markdown after the frontmatter fence). */
  body: string;
};

/**
 * List `.md` files in a directory, parsed.
 *
 * Skips `*.index.md` (the navigation indexes; not content entries) and any
 * file that fails to read. Directories without `.md` files return an empty
 * array; a non-existent directory also returns an empty array — emptiness is
 * a valid state in every AI-Lore area ([memory.md](../../../process/memory.md)).
 *
 * Entries are sorted by filename ascending, which gives a stable ordering
 * without imposing a date-or-content opinion. Callers that need a different
 * order (e.g. save-points by `date` desc) can re-sort the returned array.
 */
export function listMemoryDir(absDir: string): MemoryEntry[] {
  let names: string[];
  try {
    names = readdirSync(absDir);
  } catch {
    return [];
  }

  const entries: MemoryEntry[] = [];
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    if (name.endsWith('.index.md')) continue;
    const path = join(absDir, name);
    let isFile = false;
    try {
      isFile = statSync(path).isFile();
    } catch {
      continue;
    }
    if (!isFile) continue;
    let content: string;
    try {
      content = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    const parsed = parseMemoryFile(content);
    entries.push({ path, name, frontmatter: parsed.frontmatter, body: parsed.body });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}
