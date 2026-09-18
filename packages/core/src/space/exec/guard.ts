/**
 * The live-system guard of the real command runner.
 *
 * Two rules, checked before a process is started:
 *
 * 1. `gh` does not run unless the runner was built with `allowLiveGitHub`, or
 *    `AI_LORE_ALLOW_LIVE_GITHUB` is `1`. The app builds its own runner with the
 *    option and does not set the variable, so the processes it starts do not
 *    inherit the permission; tests do neither, and use `FakeGitHub` or a
 *    scripted runner.
 * 2. In test mode (`NODE_ENV` is `test`, or `AI_LORE_TEST` is `1`):
 *    - `gh` does not run at all, whatever rule 1 says;
 *    - a command runs only with its working folder under the temporary folder;
 *    - for git, every folder option (`-C`, `--git-dir`, `--work-tree`), every
 *      environment variable that moves the repository (`GIT_DIR` and the like)
 *      and every argument, read as a path, must be under the temporary folder;
 *    - git configuration given on the command line or through the environment
 *      (`-c`, `--config-env`, `GIT_CONFIG_COUNT`) is refused, except a short
 *      list of `-c` keys that cannot name an address or a program;
 *    - a git command that reaches a remote (`clone`, `fetch`, `pull`, `push`,
 *      `ls-remote`, `remote`) runs only when every address is a path under the
 *      temporary folder, and the commands the guard cannot judge (`submodule`,
 *      the transport plumbing) do not run.
 *
 * Paths are compared after symbolic links are resolved, because on macOS the
 * temporary folder is reached through one. A path that cannot be resolved is
 * refused.
 *
 * What the guard does not see: an alias or a `url.<base>.insteadOf` rule in
 * the machine's own git configuration, and a `git` started by another program
 * (`env git …`, a script). Modules of the library start `git` directly.
 */

import { tmpdir } from 'node:os';
import { basename, delimiter, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isInsideLexically, realpathNearest } from '../fs/paths.js';
import { type Failure, errorMessage } from '../result.js';

/** The environment variable that lets the real runner start `gh`. */
export const ALLOW_LIVE_GITHUB_ENV = 'AI_LORE_ALLOW_LIVE_GITHUB';

/** The environment variable that puts the real runner in test mode. */
export const TEST_MODE_ENV = 'AI_LORE_TEST';

/** The command the guard judges. `env` holds the variables the run adds to the process's own. */
export type GuardedCommand = {
  bin: string;
  args: readonly string[];
  cwd?: string;
  env?: Record<string, string>;
};

/**
 * What the guard reads from its surroundings. Every field has a default taken
 * from the running process, so that a test can replace any of them.
 */
export type GuardContext = {
  /** Default: `process.env`. */
  env?: Record<string, string | undefined>;
  /**
   * Whether this runner may start `gh`, said by the program that builds it
   * instead of by `AI_LORE_ALLOW_LIVE_GITHUB`. The app passes it to its own
   * runner, so that the permission is not in `process.env` and no terminal or
   * other process the app starts inherits it. Test mode refuses `gh` whatever
   * this says. Default: false.
   */
  allowLiveGitHub?: boolean;
  /** Default: `os.tmpdir()`. */
  tempDir?: string;
  /** The folder a command with no `cwd` runs in. Default: `process.cwd()`. */
  processCwd?: string;
  /**
   * The addresses of the remotes of the repository at `dir`, by remote name.
   * `gitDir` is set when the command names its repository with `--git-dir` or
   * `GIT_DIR`. Default: no remote is known, so a remote given by name is refused.
   */
  listRemotes?: (dir: string, gitDir: string | null) => Record<string, string[]>;
};

/** The failure the guard returns. */
export type GuardFailure = Failure<'live-system-refused'>;

/** Whether the environment puts the runner in test mode. */
export function isTestMode(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === 'test' || env[TEST_MODE_ENV] === '1';
}

/** Git options, before the subcommand, that take their value as the next argument. */
const GIT_GLOBAL_VALUE_OPTIONS = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--super-prefix',
  '--config-env',
]);

/**
 * The `-c` keys test mode lets through. None of them can hold an address, a
 * path or a program. Any other key is refused, because `-c remote.origin.url=`,
 * `-c url.<base>.insteadOf=`, `-c core.sshCommand=` or `-c alias.<name>=` would
 * change where a command goes after the guard has read the repository.
 */
const SAFE_CONFIG_KEYS = new Set([
  'user.name',
  'user.email',
  'commit.gpgsign',
  'tag.gpgsign',
  'init.defaultbranch',
  'core.quotepath',
  'core.autocrlf',
  'core.filemode',
  'core.ignorecase',
  'core.precomposeunicode',
  'protocol.file.allow',
  'gc.auto',
  'diff.renames',
  'status.renames',
]);
const SAFE_CONFIG_PREFIXES = ['advice.', 'color.'];

/** Environment variables that tell git where the repository or its parts are. */
const GIT_PATH_VARIABLES = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_COMMON_DIR',
];

/** Environment variables that give git configuration, as `-c` does. */
const GIT_CONFIG_VARIABLES = ['GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS'];

/** Subcommands that reach another machine or a credential store in ways the guard cannot judge. */
const REFUSED_SUBCOMMANDS = new Set([
  'submodule',
  'fetch-pack',
  'send-pack',
  'http-fetch',
  'http-push',
  'remote-http',
  'remote-https',
  'remote-ftp',
  'remote-ftps',
  'remote-ext',
  'remote-fd',
  'send-email',
  'imap-send',
  'request-pull',
  'svn',
  'p4',
  'cvsimport',
  'cvsexportcommit',
  'cvsserver',
  'daemon',
  'instaweb',
  'lfs',
  'credential',
  'credential-store',
  'credential-cache',
  'credential-osxkeychain',
]);

/** Per network subcommand, the options that take their value as the next argument. */
const NETWORK_VALUE_OPTIONS: Record<string, ReadonlySet<string>> = {
  clone: new Set([
    '-b',
    '--branch',
    '-o',
    '--origin',
    '-u',
    '--upload-pack',
    '--reference',
    '--reference-if-able',
    '--depth',
    '--template',
    '-c',
    '--config',
    '--separate-git-dir',
    '-j',
    '--jobs',
    '--shallow-since',
    '--shallow-exclude',
    '--filter',
    '--bundle-uri',
    '--server-option',
  ]),
  fetch: new Set([
    '--upload-pack',
    '--depth',
    '--deepen',
    '--shallow-since',
    '--shallow-exclude',
    '-j',
    '--jobs',
    '--refmap',
    '--negotiation-tip',
    '-o',
    '--server-option',
  ]),
  pull: new Set([
    '--upload-pack',
    '--depth',
    '--deepen',
    '--shallow-since',
    '--shallow-exclude',
    '-j',
    '--jobs',
    '--refmap',
    '--negotiation-tip',
    '-o',
    '--server-option',
    '-s',
    '--strategy',
    '-X',
    '--strategy-option',
  ]),
  push: new Set(['--repo', '--receive-pack', '--exec', '-o', '--push-option']),
  'ls-remote': new Set(['--upload-pack', '--sort', '-o', '--server-option']),
  remote: new Set(['-t', '-m']),
};

/** The actions of `git remote` that read or change the configuration only. */
const LOCAL_REMOTE_ACTIONS = new Set(['rename', 'remove', 'rm', 'get-url', 'set-branches']);

/** The actions of `git remote` that contact the remotes of the repository. */
const CONTACTING_REMOTE_ACTIONS = new Set(['show', 'prune', 'update', 'set-head']);

function refuse(message: string): GuardFailure {
  return { kind: 'live-system-refused', message };
}

/** Whether `address` names another machine: a URL that is not `file:`, or `host:path`. */
function isNetworkAddress(address: string): boolean {
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(address);
  if (scheme !== null) return scheme[1]?.toLowerCase() !== 'file';
  if (/^[A-Za-z]:[\\/]/.test(address)) return false;
  const colon = address.indexOf(':');
  const slash = address.indexOf('/');
  return colon > 0 && (slash === -1 || colon < slash);
}

function isUnder(realTemp: string, path: string): boolean {
  return isInsideLexically(realTemp, realpathNearest(path));
}

/** The reason a git address is refused, or `null` when it is a path under the temporary folder. */
function checkAddress(address: string, dir: string, realTemp: string): string | null {
  if (isNetworkAddress(address)) return `${address} is not a path under the temporary folder`;
  const path = address.toLowerCase().startsWith('file://')
    ? fileURLToPath(address)
    : resolve(dir, address);
  return isUnder(realTemp, path) ? null : `${address} is not under the temporary folder`;
}

type ParsedGit = {
  /** The folder git runs in, after every `-C`. */
  dir: string;
  /** The value of `--git-dir`, resolved, or `null`. */
  gitDir: string | null;
  pathsToCheck: string[];
  /** Why the options before the subcommand are refused, or `null`. */
  problem: string | null;
  subcommand: string | null;
  rest: string[];
};

/** The reason a `-c` value is refused in test mode, or `null`. */
function checkConfigOption(value: string | undefined): string | null {
  if (value === undefined) return '-c without a value';
  const equals = value.indexOf('=');
  const key = (equals === -1 ? value : value.slice(0, equals)).toLowerCase();
  if (SAFE_CONFIG_KEYS.has(key)) return null;
  if (SAFE_CONFIG_PREFIXES.some((prefix) => key.startsWith(prefix))) return null;
  return `-c ${key} is not a configuration key test mode lets through`;
}

/** Split a git argument list into its folder options, its subcommand and the rest. */
function parseGit(args: readonly string[], cwd: string): ParsedGit {
  let dir = cwd;
  let gitDir: string | null = null;
  let problem: string | null = null;
  const pathsToCheck: string[] = [];
  let index = 0;
  while (index < args.length) {
    const arg = args[index] ?? '';
    if (!arg.startsWith('-')) {
      return { dir, gitDir, pathsToCheck, problem, subcommand: arg, rest: args.slice(index + 1) };
    }
    const equals = arg.indexOf('=');
    const name = equals === -1 ? arg : arg.slice(0, equals);
    const takesNext = equals === -1 && GIT_GLOBAL_VALUE_OPTIONS.has(arg);
    const value = equals === -1 ? args[index + 1] : arg.slice(equals + 1);
    if (name === '-C' && value !== undefined) {
      dir = resolve(dir, value);
      pathsToCheck.push(dir);
    } else if ((name === '--git-dir' || name === '--work-tree') && value !== undefined) {
      const path = resolve(dir, value);
      pathsToCheck.push(path);
      if (name === '--git-dir') gitDir = path;
    } else if (name === '-c') {
      problem ??= checkConfigOption(value);
    } else if (name === '--config-env') {
      problem ??= '--config-env gives configuration the guard cannot read';
    } else if (name === '--exec-path' && equals !== -1) {
      problem ??= '--exec-path replaces the programs git runs';
    }
    index += takesNext ? 2 : 1;
  }
  return { dir, gitDir, pathsToCheck, problem, subcommand: null, rest: [] };
}

/** The arguments of a network subcommand that are not options or option values. */
function positionals(subcommand: string, rest: readonly string[]): string[] {
  const valueOptions = NETWORK_VALUE_OPTIONS[subcommand] ?? new Set<string>();
  const found: string[] = [];
  let index = 0;
  while (index < rest.length) {
    const arg = rest[index] ?? '';
    if (arg === '--') return [...found, ...rest.slice(index + 1)];
    if (arg.startsWith('-') && arg !== '-') {
      index += valueOptions.has(arg) ? 2 : 1;
      continue;
    }
    found.push(arg);
    index += 1;
  }
  return found;
}

/** The reason one of the repository's configured remotes is refused, or `null`. */
function checkEveryRemote(
  remotes: Record<string, string[]>,
  dir: string,
  realTemp: string,
): string | null {
  for (const [name, addresses] of Object.entries(remotes)) {
    for (const address of addresses) {
      const reason = checkAddress(address, dir, realTemp);
      if (reason !== null) return `remote ${name}: ${reason}`;
    }
  }
  return null;
}

/** `git remote <action> …`: an address it stores, or the remotes it contacts, must be safe. */
function checkGitRemote(
  parsed: ParsedGit,
  realTemp: string,
  remotes: () => Record<string, string[]>,
): string | null {
  const [action, , ...addresses] = positionals('remote', parsed.rest);
  if (action === undefined || LOCAL_REMOTE_ACTIONS.has(action)) return null;
  if (action === 'add' || action === 'set-url') {
    for (const address of addresses) {
      const reason = checkAddress(address, parsed.dir, realTemp);
      if (reason !== null) return reason;
    }
    return null;
  }
  if (CONTACTING_REMOTE_ACTIONS.has(action)) {
    return checkEveryRemote(remotes(), parsed.dir, realTemp);
  }
  return `the guard does not know the action ${action}`;
}

function checkGitNetwork(
  parsed: ParsedGit,
  realTemp: string,
  context: GuardContext,
  envGitDir: string | null,
): string | null {
  const subcommand = parsed.subcommand;
  if (subcommand === null) return null;
  if (REFUSED_SUBCOMMANDS.has(subcommand)) return 'test mode does not run this command';
  if (subcommand === 'archive') {
    const remote = parsed.rest.some((arg) => arg === '--remote' || arg.startsWith('--remote='));
    return remote ? 'an archive of a remote is not read in test mode' : null;
  }
  if (subcommand === 'config') {
    const machine = parsed.rest.find((arg) => arg === '--global' || arg === '--system');
    return machine === undefined ? null : `${machine} is the configuration of the machine`;
  }
  if (!(subcommand in NETWORK_VALUE_OPTIONS)) return null;

  // No argument of a network command may name another machine, whatever its position.
  for (const arg of parsed.rest) {
    const value = arg.startsWith('--') && arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : arg;
    if (!value.startsWith('-') && /:\/\/|@[^/]*:/.test(value) && isNetworkAddress(value)) {
      return `${value} is not a path under the temporary folder`;
    }
  }

  const remotes = (): Record<string, string[]> =>
    context.listRemotes?.(parsed.dir, parsed.gitDir ?? envGitDir) ?? {};
  if (subcommand === 'remote') return checkGitRemote(parsed, realTemp, remotes);

  const found = positionals(subcommand, parsed.rest);
  const [target, destination] = found;
  if (subcommand === 'clone') {
    if (target === undefined) return 'git clone without an address';
    if (destination !== undefined && !isUnder(realTemp, resolve(parsed.dir, destination))) {
      return `the destination ${destination} is not under the temporary folder`;
    }
    return checkAddress(target, parsed.dir, realTemp);
  }

  const repoOption = parsed.rest.find((arg) => arg.startsWith('--repo='));
  const repoIndex = parsed.rest.indexOf('--repo');
  // `fetch --multiple a b` names several remotes; otherwise what follows the first is a refspec.
  const targets = parsed.rest.includes('--multiple') ? found : [target];
  const named = [
    ...targets,
    repoOption?.slice('--repo='.length),
    repoIndex === -1 ? undefined : parsed.rest[repoIndex + 1],
  ].filter((value): value is string => value !== undefined);

  // No remote named: git picks one from the configuration, so all must be safe.
  if (named.length === 0) return checkEveryRemote(remotes(), parsed.dir, realTemp);

  const known = remotes();
  for (const value of named) {
    const addresses = known[value];
    if (addresses !== undefined) {
      const reason = checkEveryRemote({ [value]: addresses }, parsed.dir, realTemp);
      if (reason !== null) return reason;
      continue;
    }
    const looksLikePath =
      value.includes('/') || value.startsWith('.') || value.toLowerCase().startsWith('file:');
    if (!looksLikePath) return `${value} is not a remote of the repository and not a path`;
    const reason = checkAddress(value, parsed.dir, realTemp);
    if (reason !== null) return reason;
  }
  return null;
}

/**
 * Every argument after the subcommand, read as a path from the folder git runs
 * in, must be under the temporary folder. An argument that is not a path (a
 * commit, a refspec, a format) resolves to a name under that folder and
 * passes; `init /elsewhere`, `worktree add ../../x`, `config --file /x` and a
 * relative name that is a symbolic link out of the temporary folder do not.
 */
function checkArgumentPaths(parsed: ParsedGit, realTemp: string): string | null {
  for (const arg of parsed.rest) {
    let value = arg;
    if (arg.startsWith('-')) {
      const equals = arg.indexOf('=');
      if (equals === -1) continue;
      value = arg.slice(equals + 1);
    }
    if (value === '' || value === '-') continue;
    if (!isUnder(realTemp, resolve(parsed.dir, value))) {
      return `the argument ${value} names a path outside the temporary folder`;
    }
  }
  return null;
}

/** The reason the environment of a git command is refused in test mode, or `null`. */
function checkGitEnvironment(
  env: Record<string, string | undefined>,
  dir: string,
  realTemp: string,
): string | null {
  for (const name of GIT_CONFIG_VARIABLES) {
    if (env[name] !== undefined) return `${name} gives configuration the guard cannot read`;
  }
  const alternates = env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  const paths: [string, string][] = [
    ...GIT_PATH_VARIABLES.map((name): [string, string | undefined] => [name, env[name]]),
    ...(alternates ?? '')
      .split(delimiter)
      .map((path): [string, string] => ['GIT_ALTERNATE_OBJECT_DIRECTORIES', path]),
  ].filter((pair): pair is [string, string] => pair[1] !== undefined && pair[1] !== '');
  for (const [name, path] of paths) {
    if (!isUnder(realTemp, resolve(dir, path))) {
      return `${name} is not under the temporary folder: ${path}`;
    }
  }
  return null;
}

/**
 * Judge a command before it starts. Returns `null` when it may run, or the
 * failure that says why it may not.
 */
export function checkLiveSystemGuard(
  command: GuardedCommand,
  context: GuardContext = {},
): GuardFailure | null {
  const env = context.env ?? process.env;
  const name = basename(command.bin)
    .toLowerCase()
    .replace(/\.exe$/, '');

  const liveGitHubAllowed = context.allowLiveGitHub === true || env[ALLOW_LIVE_GITHUB_ENV] === '1';
  if (name === 'gh' && !liveGitHubAllowed) {
    return refuse(
      `gh does not run unless ${ALLOW_LIVE_GITHUB_ENV} is 1 or the runner was built with allowLiveGitHub`,
    );
  }
  if (!isTestMode(env)) return null;
  if (name === 'gh') {
    return refuse('in test mode gh does not run; a test uses FakeGitHub or a scripted runner');
  }

  try {
    const realTemp = realpathNearest(context.tempDir ?? tmpdir());
    const cwd = resolve(context.processCwd ?? process.cwd(), command.cwd ?? '.');
    if (!isUnder(realTemp, cwd)) {
      return refuse(`in test mode the working folder must be under the temporary folder: ${cwd}`);
    }
    if (name !== 'git') return null;

    const parsed = parseGit(command.args, cwd);
    if (parsed.problem !== null) return refuse(`in test mode git: ${parsed.problem}`);
    for (const path of parsed.pathsToCheck) {
      if (!isUnder(realTemp, path)) {
        return refuse(`in test mode git runs only under the temporary folder: ${path}`);
      }
    }
    // What the child will see: the process's variables with the run's own on top.
    const childEnv = { ...env, ...command.env };
    const envGitDir =
      childEnv.GIT_DIR === undefined || childEnv.GIT_DIR === ''
        ? null
        : resolve(parsed.dir, childEnv.GIT_DIR);
    const reason =
      checkGitEnvironment(childEnv, parsed.dir, realTemp) ??
      checkGitNetwork(parsed, realTemp, context, envGitDir) ??
      checkArgumentPaths(parsed, realTemp);
    const label = parsed.subcommand === null ? 'git' : `git ${parsed.subcommand}`;
    return reason === null ? null : refuse(`in test mode ${label}: ${reason}`);
  } catch (caught) {
    return refuse(`the guard could not decide: ${errorMessage(caught)}`);
  }
}
