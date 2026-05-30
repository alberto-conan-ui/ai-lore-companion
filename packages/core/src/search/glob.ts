/**
 * Glob matching for file-name search, layered on top of the fuzzy matcher
 * ([fuzzy.ts](./fuzzy.ts)). A plain query stays fuzzy/typo-tolerant; the moment
 * it contains a glob metacharacter (`*` or `?`) the search treats it as a glob
 * against the file's basename — so `*.ts`, `*config*`, and `app.?s` do what a
 * shell user expects, while `index` still fuzzy-matches.
 *
 * `*` matches any run (including empty); `?` matches exactly one character.
 * Case-insensitive, anchored to the whole basename. Everything else is escaped
 * so a literal `.` is a literal dot, not "any char".
 */

/** Whether `query` should be treated as a glob (contains `*` or `?`). */
export function isGlob(query: string): boolean {
  return query.includes('*') || query.includes('?');
}

/**
 * Compile a basename glob to an anchored, case-insensitive `RegExp`. `*` → `.*`
 * (so `**` collapses harmlessly), `?` → `.`, all other regex specials escaped.
 */
export function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (const ch of pattern) {
    if (ch === '*') out += '.*';
    else if (ch === '?') out += '.';
    else if ('.+^${}()|[]\\/'.includes(ch)) out += `\\${ch}`;
    else out += ch;
  }
  return new RegExp(`^${out}$`, 'i');
}
