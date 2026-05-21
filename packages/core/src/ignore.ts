/**
 * The folders the cockpit's **watcher** excludes — build and scratch dirs that
 * would otherwise flood the drift queue. Fed to chokidar as exclusion globs.
 *
 * This does not hide anything from the file tree: the tree shows every folder;
 * the ignore list only silences change events. (`createIgnoreMatcher` and
 * `readDirectory` remain general — a caller may still pass an ignore list to a
 * directory read, as `main` does to hide the Lore folder from the Payload pane.)
 *
 * A project extends the set with a `.ailoreignore` file at its root — see
 * `readProjectIgnores`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_IGNORED: readonly string[] = [
  '**/upstream/**',
  '**/process/**',
  '**/.git/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/dist-test/**',
  '**/out/**',
];

/**
 * Compile a list of chokidar-style ignore globs into a predicate. The
 * predicate takes a path segment, or a path relative to a read root, and
 * returns true when any pattern matches it.
 *
 * Matching is not delegated to chokidar — that would pull a watcher
 * dependency into pure-Node consumers like the tree reader.
 */
export function createIgnoreMatcher(patterns: readonly string[]): (relPath: string) => boolean {
  const matchers = patterns.map(compileGlob);
  return (relPath) => matchers.some((m) => m(relPath));
}

function compileGlob(pattern: string): (relPath: string) => boolean {
  const mid = pattern.match(/^\*\*\/(.+?)\/\*\*$/);
  if (mid) {
    const name = mid[1] as string;
    return (relPath) => relPath === name || relPath.split('/').includes(name);
  }
  const re = globToRegex(pattern);
  return (relPath) => re.test(relPath);
}

/**
 * A project's user ignore file — `.gitignore`-flavoured, at the project root.
 * Deliberately not `.ai-lore-…`: that prefix is how the Lore folder is found
 * (`locateLore`), so a file sharing it would be mistaken for a second Lore.
 */
const IGNORE_FILE_NAME = '.ailoreignore';

/**
 * Parse a `.gitignore`-flavoured ignore file into chokidar-style patterns the
 * cockpit matcher understands. One pattern per line; blank lines and `#`
 * comment lines are skipped. A bare folder name (`coverage`, `tmp`) is ignored
 * at any depth; a line that already contains `/` or `*` is taken as a literal
 * chokidar glob.
 *
 * Deliberately folder-oriented and not full `.gitignore`: no anchoring, no
 * trailing-slash semantics, and negation is unsupported — `!…` lines are
 * skipped rather than honoured.
 */
export function parseIgnorePatterns(text: string): string[] {
  const patterns: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;
    patterns.push(line.includes('/') || line.includes('*') ? line : `**/${line}/**`);
  }
  return patterns;
}

/**
 * Read a project's user ignore patterns from `<root>/.ailoreignore`. A
 * missing file is not an error — it yields an empty list. The returned
 * patterns extend, never replace, `DEFAULT_IGNORED`.
 */
export function readProjectIgnores(root: string): string[] {
  let text: string;
  try {
    text = readFileSync(join(root, IGNORE_FILE_NAME), 'utf8');
  } catch {
    return [];
  }
  return parseIgnorePatterns(text);
}

function globToRegex(pattern: string): RegExp {
  let body = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i] as string;
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          body += '(?:.*/)?';
          i += 3;
        } else {
          body += '.*';
          i += 2;
        }
      } else {
        body += '[^/]*';
        i += 1;
      }
    } else if (/[.+?()[\]{}^$|\\]/.test(c)) {
      body += `\\${c}`;
      i += 1;
    } else {
      body += c;
      i += 1;
    }
  }
  return new RegExp(`^${body}$`);
}
