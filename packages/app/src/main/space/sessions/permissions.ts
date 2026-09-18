/**
 * The permission rules of a guarded session's `settings.json` (phase M4.4).
 *
 * The rules rest on what the real engine did in phase M4.1
 * (`packages/docs/m4-1-claude-code-findings.md`, sections 4 and 7) and in the
 * review of this phase (Claude Code 2.1.277, a headless run in a scratch
 * Space):
 *
 * - A rule `Bash(<text>:*)` matches a command that begins with `<text>`. A
 *   rule without `*` matches that command only.
 * - In a rule of the form `Bash(git -C * log*)`, `*` matches text with spaces
 *   in it. With the rules `Bash(git -C * log*)` and `Bash(git -C * status*)`,
 *   a Read only session ran `git -C repos/app commit --allow-empty -m log` and
 *   `git -C repos/app checkout -b status-fix` without asking. So no allow rule
 *   here has a `*` before its end: each is a fixed command or a fixed prefix.
 * - A command with `;`, `|`, `$(…)` or backticks after an allowed prefix was
 *   not run: each part is checked, and a command substitution is refused.
 * - A deny rule is applied before an allow rule; an `ask` rule for `Bash`
 *   would be applied before the allow rules and make every command ask, so
 *   there is none. A command that no rule matches asks the Human Lead.
 *
 * The file-writing tools (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`) are in
 * no allow rule, on purpose: the before-write adapter grants each write with a
 * JSON `allow`. If the hook ever fails without blocking, the engine asks.
 *
 * WHAT THESE RULES CANNOT STOP. The write-guard sees the engine's file-writing
 * tools and nothing else; the engine judges a shell command by its text and
 * does not know which files it writes.
 *
 * - A command the Human Lead approves runs with the user's rights. It can
 *   write the Lore, a repository on any branch, the desk's records, this
 *   session's files and the copied check scripts, whatever the session's mode
 *   and claims are.
 * - An allowed command runs without asking. `gh issue comment` writes to
 *   GitHub, which the work-report verb needs in Read only. An option of an
 *   allowed `git` or `gh` command that writes a file or starts a program, and
 *   that is not in the deny list below, gets through.
 * - The skeleton generators are run from `lore/mirrors/generators/`. A session
 *   in Writing that claimed the Lore can change a generator and then run it
 *   without asking, and the generator can write anywhere the user can.
 * - `Read`, `Grep`, `Glob` and `cat` read any file the user can read, outside
 *   the Space too, including the `mcp.json` of another running session.
 * - The engine's sandbox would stop shell writes by path, but it is fixed when
 *   the engine starts and cannot follow a claim, so it is not used.
 *
 * The Human Lead's own Claude Code settings and a `.claude/` folder inside the
 * Space are left out by `--setting-sources ''` (`command-line.ts`), so their
 * allow rules and hooks are not added to these. Managed (policy) settings of
 * the machine still apply.
 */

/** Tools that only read. */
const READING_TOOLS = ['Read', 'Grep', 'Glob'] as const;

/** Commands the default verbs use in the Space's folder that only read, or that fetch. */
const SHELL_RULES = [
  'Bash(ls:*)',
  'Bash(cat:*)',
  'Bash(git status:*)',
  'Bash(git log:*)',
  'Bash(git diff:*)',
  'Bash(git rev-parse:*)',
  // Fixed forms: `git fetch <remote> <a>:<b>` writes a branch, and `git symbolic-ref HEAD <ref>` moves HEAD.
  'Bash(git fetch)',
  'Bash(git fetch origin)',
  'Bash(git fetch --prune)',
  'Bash(git symbolic-ref HEAD)',
  'Bash(git symbolic-ref --short HEAD)',
  // `git branch <name>` creates a branch. These two forms only read: git refuses another mode beside them.
  'Bash(git branch --show-current:*)',
  'Bash(git branch --list:*)',
  'Bash(gh issue view:*)',
  'Bash(gh issue list:*)',
  'Bash(gh issue comment:*)',
  'Bash(gh project item-list:*)',
  'Bash(gh project field-list:*)',
  'Bash(python3 lore/mirrors/generators/folder-skeleton.py:*)',
  'Bash(python3 lore/mirrors/generators/repository-skeleton.py:*)',
] as const;

/** The form a repository's name has in the manifest; nothing else is put into a rule. */
const REPOSITORY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The session's working directory is the Space, a prefix rule does not match
 * `git -C repos/<name> …`, and `cd repos/<name> && git …` is refused by the
 * engine itself. So each repository of the manifest gets its own rules, with
 * its name written out: `git -C workbench/<folder> …` (a folder the session
 * can fill with a repository's files and settings) matches none of them.
 */
export function repositoryRules(repositories: readonly string[]): string[] {
  const rules: string[] = [];
  for (const name of repositories) {
    if (!REPOSITORY_NAME.test(name)) continue;
    const git = `git -C repos/${name}`;
    rules.push(
      `Bash(${git} status:*)`,
      `Bash(${git} log:*)`,
      `Bash(${git} diff:*)`,
      `Bash(${git} rev-parse:*)`,
      `Bash(${git} branch --show-current)`,
      `Bash(${git} fetch)`,
      `Bash(${git} fetch origin)`,
      `Bash(${git} fetch --prune)`,
    );
  }
  return rules;
}

/**
 * Denied whatever else matches: a deny rule is applied before an allow rule,
 * and here `*` spanning spaces is wanted. The first and the `-c` rules were
 * observed. The others close the same kind of gap: an option of an allowed
 * `git` command that writes a file or starts a program (`--upload-pack` and
 * `--exec` name a program; `-c` and `--config-env` set `core.fsmonitor`,
 * `core.sshCommand`, a pager or an alias, each of which names a program;
 * `--exec-path` replaces git's own programs).
 */
export const SESSION_DENY_RULES: readonly string[] = [
  'Bash(git *--output*)',
  'Bash(git *--upload-pack*)',
  'Bash(git *--exec=*)',
  'Bash(git *--exec-path*)',
  'Bash(git *--config-env*)',
  'Bash(git -c *)',
  'Bash(git * -c *)',
];

/**
 * The allow rules of a session whose server tools are `tools`
 * (`mcp__<server>__<tool>`), in a Space whose repositories are `repositories`.
 */
export function sessionAllowRules(
  tools: readonly string[],
  repositories: readonly string[],
): string[] {
  return [...READING_TOOLS, ...SHELL_RULES, ...repositoryRules(repositories), ...tools];
}

/** The `permissions` object of a session's `settings.json`. */
export function sessionPermissions(
  tools: readonly string[],
  repositories: readonly string[],
): {
  defaultMode: 'default';
  allow: string[];
  deny: string[];
} {
  return {
    // Always set: another mode (`auto` was observed in the Human Lead's settings) must not apply.
    defaultMode: 'default',
    allow: sessionAllowRules(tools, repositories),
    deny: [...SESSION_DENY_RULES],
  };
}
