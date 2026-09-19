/**
 * The command lines of a guarded session (phase M4.4): the engine's arguments,
 * and the command strings of the two hooks.
 *
 * Everything is built as an argument array first. Two places need one string:
 * the PTY service starts an engine as `$SHELL -i -l -c '<command>'` and quotes
 * each argument itself with `quoteForShell` of `main/pty.ts`; and Claude Code
 * takes a hook's `command` as one string that a shell reads. Both are quoted
 * with the single-quote rule of POSIX shells, which leaves no character of a
 * path with a meaning: a space, a single quote, a double quote, `$`, a
 * backtick and a backslash all arrive as they are (architecture document,
 * section 5.14). Observed in phase M4.1 with double quotes and paths with a
 * space; a path with a single quote is this phase's headless test.
 *
 * No secret is in an argument: the session's token is only in `mcp.json`.
 */

/** Quote one argument for a POSIX shell. Every argument is quoted, a plain one too. */
export function quoteShellArgument(argument: string): string {
  if (argument.includes('\0'))
    throw new Error('an argument of a command line holds a NUL character');
  return `'${argument.replace(/'/g, "'\\''")}'`;
}

/** One command string from an argument array, for a POSIX shell. */
export function shellCommandLine(argv: readonly string[]): string {
  return argv.map(quoteShellArgument).join(' ');
}

/** What a hook command is made from. Every path is absolute. */
export type HookCommandParts = {
  /** The absolute path of `python3`, found before the session starts. */
  python: string;
  /** The adapter's file in the session's folder. */
  adapter: string;
  spaceRoot: string;
  /** The folder of the desk's records (`DeskPaths.desk`). */
  deskDir: string;
  sessionId: string;
  /** The check scripts to run, in order. */
  checks: readonly string[];
  childSeconds: number;
  adapterSeconds: number;
  /** Before-write only: the full name of the tool a session asks for Writing with. */
  requestTool?: string;
  /** Before-write only: the file the adapter notes its refusals in. */
  refusalsFile?: string;
};

/** The argument array of a hook command. */
export function hookArgv(parts: HookCommandParts): string[] {
  return [
    parts.python,
    parts.adapter,
    '--space',
    parts.spaceRoot,
    '--desk',
    parts.deskDir,
    '--session',
    parts.sessionId,
    '--child-seconds',
    String(parts.childSeconds),
    '--adapter-seconds',
    String(parts.adapterSeconds),
    ...(parts.requestTool !== undefined ? ['--request-tool', parts.requestTool] : []),
    ...(parts.refusalsFile !== undefined ? ['--refusals', parts.refusalsFile] : []),
    ...parts.checks.flatMap((check) => ['--check', check]),
  ];
}

/** What the engine's arguments are made from. Every path is absolute and made by the companion. */
export type EngineArgvParts = {
  /** The arguments of the engine's registry entry, which come first. */
  engineArgs: readonly string[];
  settingsFile: string;
  mcpFile: string;
  pluginDir: string;
  /** The full names of the session server's tools (`mcp__<server>__<tool>`). */
  tools: readonly string[];
  /** Additional execution flags (e.g. --dangerously-skip-permissions) */
  flags?: readonly string[];
};

/**
 * `--setting-sources ''` loads none of the user's, the project's or the local
 * settings files; `--settings` and managed settings still apply. Observed in
 * this phase's review (Claude Code 2.1.277): with it, the user's enabled plugin
 * was not loaded, hooks in the Space's `.claude/settings.json` and
 * `.claude/settings.local.json` did not run, and the hooks and rules of the
 * session's `settings.json` did. Without it, allow rules of the Human Lead's
 * own settings are added to the session's (findings, section 1). Its cost: the
 * Human Lead's own plugins, hooks and settings do not apply in a guarded session.
 */
export const SETTING_SOURCES_ARGS: readonly string[] = ['--setting-sources', ''];

/**
 * The options of a registry entry that would change what a guarded session
 * may do, or where its settings come from. An entry that holds one is not
 * started as a guarded session (`preflight.ts`). An option is matched as it is
 * and in its `--name=value` form.
 */
export const GUARD_CHANGING_ENGINE_OPTIONS: readonly string[] = [
  '--dangerously-skip-permissions',
  '--allow-dangerously-skip-permissions',
  '--permission-mode',
  '--permission-prompt-tool',
  '--allowedTools',
  '--allowed-tools',
  '--tools',
  '--add-dir',
  '--settings',
  '--setting-sources',
  '--mcp-config',
  '--strict-mcp-config',
  '--plugin-dir',
  '--bare',
  '--safe-mode',
];

/** The first argument of `args` that is a guard-changing option, or `undefined`. */
export function guardChangingEngineOption(args: readonly string[]): string | undefined {
  return args.find((argument) =>
    GUARD_CHANGING_ENGINE_OPTIONS.some(
      (option) => argument === option || argument.startsWith(`${option}=`),
    ),
  );
}

/**
 * The arguments of the engine (architecture document, section 5.6).
 * `--allowedTools` takes several values, so it is the last option and nothing
 * follows it.
 */
export function engineArgv(parts: EngineArgvParts): string[] {
  return [
    ...parts.engineArgs,
    ...(parts.flags ?? []),
    ...SETTING_SOURCES_ARGS,
    '--settings',
    parts.settingsFile,
    '--mcp-config',
    parts.mcpFile,
    '--strict-mcp-config',
    '--plugin-dir',
    parts.pluginDir,
    ...(parts.tools.length > 0 ? ['--allowedTools', ...parts.tools] : []),
  ];
}
