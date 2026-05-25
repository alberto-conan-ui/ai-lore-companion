/**
 * The cockpit's ignore system: ignore rules, their levels, and the pure logic
 * to merge rules and derive the pattern lists the three interception points
 * consume.
 *
 * An ignore rule carries a **level**. The levels nest — each does everything
 * the one before it does, and more:
 *
 *   no-drift    the watcher raises no drift for the path
 *   no-search   the above, and the global file search skips it
 *   hidden      the above, and the file tree omits it entirely
 *
 * Rules live in the two-tier settings store (see `settings/`). This module is
 * Electron-free and pure; the Electron `main` process reads the rules, calls
 * `mergeIgnoreRules` and `deriveIgnoreLists`, and feeds the three derived
 * lists to the watcher, the file search, and the tree reader.
 */

/** How hard an ignore rule hides a path. The levels nest. */
export type IgnoreLevel = 'no-drift' | 'no-search' | 'hidden';

/** One ignore rule — a glob pattern and the level it applies. */
export type IgnoreRule = { pattern: string; level: IgnoreLevel };

/**
 * The three cumulative pattern lists derived from a merged rule set, one per
 * interception point: `drift` is every rule's pattern, `search` is the
 * `no-search` and `hidden` patterns, `hidden` is the `hidden` patterns.
 */
export type IgnoreLists = { drift: string[]; search: string[]; hidden: string[] };

/**
 * The cockpit's built-in ignore rules — build and scratch folders that would
 * otherwise flood the drift queue and the file search. They form the base of
 * the merge, beneath the global and per-project rules, at the `no-search`
 * level: no drift, absent from search, still visible in the tree — the
 * cockpit's behaviour before ignore levels existed. Escalate any of them to
 * `hidden` with a global rule on the same pattern to drop it from the tree.
 */
export const DEFAULT_IGNORE_RULES: readonly IgnoreRule[] = [
  { pattern: '**/upstream/**', level: 'no-search' },
  { pattern: '**/process/**', level: 'no-search' },
  { pattern: '**/.git/**', level: 'no-search' },
  { pattern: '**/node_modules/**', level: 'no-search' },
  { pattern: '**/dist/**', level: 'no-search' },
  { pattern: '**/dist-test/**', level: 'no-search' },
  { pattern: '**/out/**', level: 'no-search' },
];

const LEVELS: readonly string[] = ['no-drift', 'no-search', 'hidden'];

/** Whether `value` is a well-formed ignore rule — used to validate stored data. */
export function isIgnoreRule(value: unknown): value is IgnoreRule {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return typeof r.pattern === 'string' && typeof r.level === 'string' && LEVELS.includes(r.level);
}

/**
 * Normalise a user-typed ignore pattern into a chokidar-style glob. A bare
 * folder name is expanded to match that folder at any depth; a bare file glob
 * is expanded to match that file at any depth; a pattern that already contains
 * a slash is taken verbatim. An empty pattern stays empty.
 */
export function normalizeIgnorePattern(pattern: string): string {
  const trimmed = pattern.trim();
  if (trimmed === '' || trimmed.includes('/')) return trimmed;
  if (trimmed.includes('*')) return `**/${trimmed}`;
  return `**/${trimmed}/**`;
}

/**
 * Merge two rule sets: a rule in `override` on the same pattern as one in
 * `base` replaces it; a rule on a new pattern is appended. Used to layer the
 * global rules over the defaults, then the per-project rules over that.
 */
export function mergeIgnoreRules(
  base: readonly IgnoreRule[],
  override: readonly IgnoreRule[],
): IgnoreRule[] {
  const byPattern = new Map<string, IgnoreLevel>();
  for (const rule of base) byPattern.set(rule.pattern, rule.level);
  for (const rule of override) byPattern.set(rule.pattern, rule.level);
  return [...byPattern].map(([pattern, level]) => ({ pattern, level }));
}

/**
 * Derive the three interception lists from a merged rule set. Every rule
 * suppresses drift; `no-search` and `hidden` also suppress search; `hidden`
 * also hides the tree. Patterns are normalised; empty patterns are dropped.
 */
export function deriveIgnoreLists(rules: readonly IgnoreRule[]): IgnoreLists {
  const drift: string[] = [];
  const search: string[] = [];
  const hidden: string[] = [];
  for (const rule of rules) {
    const pattern = normalizeIgnorePattern(rule.pattern);
    if (pattern === '') continue;
    drift.push(pattern);
    if (rule.level === 'no-search' || rule.level === 'hidden') search.push(pattern);
    if (rule.level === 'hidden') hidden.push(pattern);
  }
  return { drift, search, hidden };
}

/**
 * Whether a file is excluded from drift tracking by its name alone. AI-Lore
 * index files (`<name>.index.md`) are rewritten constantly as Memory is
 * reshaped, and would flood the drift queue — the watcher silences them. This
 * is a tracking exclusion only: an index file stays visible in the tree and
 * findable by the search.
 */
export function isUntrackedFile(name: string): boolean {
  return name.endsWith('.index.md');
}

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
