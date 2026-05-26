/**
 * Build an argv array for spawning an external diff CLI.
 *
 * The Settings registry stores the diff invocation as **a CLI path** and **a
 * whitespace-tokenised argv template** with `{baseline}` and `{current}`
 * placeholders. This module turns those two strings + two file paths into a
 * concrete argv — one array element per token — that `child_process.spawn`
 * can accept directly. The template is never passed through a shell, so user
 * input does not get shell-interpolated.
 *
 * Real-world examples the template format covers without further parsing:
 *
 *   `ksdiff`            with template `{baseline} {current}` → Kaleidoscope
 *   `code`              with template `--diff {baseline} {current}` → VS Code
 *   `opendiff`          with template `{baseline} {current}` → macOS FileMerge
 *
 * Anything that needs shell quoting (paths with spaces inside the *template
 * literal*, complex flag combinations) belongs in a wrapper script — point
 * the CLI setting at the script. The simple whitespace split keeps the
 * substitution unambiguous.
 */

/** Tokens a template can carry. Anything else is a literal argv element. */
type Token = { kind: 'literal'; value: string } | { kind: 'baseline' } | { kind: 'current' };

/** Split the template into tokens, recognising `{baseline}` and `{current}`. */
function tokenise(template: string): Token[] {
  const out: Token[] = [];
  for (const raw of template.split(/\s+/)) {
    if (raw.length === 0) continue;
    if (raw === '{baseline}') out.push({ kind: 'baseline' });
    else if (raw === '{current}') out.push({ kind: 'current' });
    else out.push({ kind: 'literal', value: raw });
  }
  return out;
}

export type BuildDiffArgvInput = {
  /** The whitespace-tokenised template — value of the `diff.externalArgvTemplate` setting. */
  template: string;
  /** Absolute path to the materialised baseline file. */
  baseline: string;
  /** Absolute path to the current working-tree file. */
  current: string;
};

/**
 * Substitute baseline / current into the template and return the argv array.
 *
 * Tokens that are exactly `{baseline}` or `{current}` become the corresponding
 * path; every other whitespace-separated piece is taken verbatim. Multiple
 * occurrences are supported.
 */
export function buildDiffArgv(input: BuildDiffArgvInput): string[] {
  return tokenise(input.template).map((t) => {
    switch (t.kind) {
      case 'baseline':
        return input.baseline;
      case 'current':
        return input.current;
      case 'literal':
        return t.value;
    }
  });
}

/**
 * Whether the template references both placeholders — a sanity check the
 * Settings UI can surface so the user does not save a template that drops
 * one of the two files.
 */
export function templateUsesBothPlaceholders(template: string): boolean {
  const tokens = tokenise(template);
  return tokens.some((t) => t.kind === 'baseline') && tokens.some((t) => t.kind === 'current');
}
