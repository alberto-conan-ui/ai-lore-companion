import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  CLAUDE_AUTH_STATUS_ARGS,
  CLAUDE_BINARY_NAME,
  CLAUDE_SIGN_IN_COMMAND,
  type CommandRunner,
  DEFAULT_MACHINE_CHECK_TIMEOUT_MS,
  type EngineCheck,
  type EngineEntry,
  GH_ADD_SCOPE_COMMAND,
  GH_SIGN_IN_COMMAND,
  GITHUB_HOST,
  INSTALL_LINKS,
  MIN_GH_VERSION,
  MIN_GIT_VERSION,
  MIN_PYTHON_VERSION,
  type MachineCheckOptions,
  type MachineCheckState,
  REQUIRED_GH_SCOPE,
  type RunResult,
  checkEngine,
  checkGh,
  checkGit,
  checkGitHub,
  checkMachine,
  checkPython3,
  compareToolVersions,
  engineRequirement,
  formatToolVersion,
  guidanceFor,
  isClaudeEngine,
  parseClaudeAuthStatus,
  parseGhAuthStatus,
  parseOpencodeAuthList,
  parseToolVersion,
  platformInstallCommand,
  probeEngineSignIn,
} from '../../src/index.js';
import {
  type ScriptedRule,
  type ScriptedRunner,
  createScriptedRunner,
} from '../../src/space/testing/scripted-runner.js';

/** Linux, so that the macOS placeholder questions are asked only by the tests that are about them. */
const LINUX: MachineCheckOptions = { platform: 'linux' };

const CLAUDE: EngineEntry = { id: 'default.claude', name: 'Claude', binary: 'claude' };
const GEMINI: EngineEntry = { id: 'default.gemini', name: 'Gemini', binary: 'gemini' };
const CODEX: EngineEntry = { id: 'default.codex', name: 'Codex CLI', binary: 'codex' };
const ANTIGRAVITY: EngineEntry = {
  id: 'default.antigravity',
  name: 'Antigravity CLI',
  binary: 'agy',
};
const OPENCODE: EngineEntry = { id: 'default.opencode', name: 'OpenCode', binary: 'opencode' };

const NOT_FOUND: Partial<RunResult> = { code: -1, stderr: 'not found', failure: 'not-found' };

/** What `gh auth status` prints in gh 2.40 and later, with two accounts. */
function ghStatus(activeScopes: string, otherScopes = "'repo'"): string {
  return [
    'github.com',
    '  ✓ Logged in to github.com account lead (keyring)',
    '  - Active account: true',
    '  - Git operations protocol: https',
    '  - Token: gho_************************************',
    `  - Token scopes: ${activeScopes}`,
    '',
    '  ✓ Logged in to github.com account other (keyring)',
    '  - Active account: false',
    '  - Git operations protocol: https',
    '  - Token: gho_************************************',
    `  - Token scopes: ${otherScopes}`,
    '',
  ].join('\n');
}

const GH_NOT_LOGGED_IN =
  'You are not logged into any GitHub hosts. To log in, run: gh auth login\n';

/** Rules for a machine where all four requirements are fine, GitHub, Homebrew and npm too. */
function fineRules(): ScriptedRule[] {
  return [
    { bin: 'git', args: ['--version'], reply: { stdout: 'git version 2.39.3 (Apple Git-146)\n' } },
    {
      bin: 'gh',
      args: ['--version'],
      reply: { stdout: 'gh version 2.92.0 (2026-04-28)\nhttps://github.com/cli/cli/releases\n' },
    },
    {
      bin: 'gh',
      args: ['auth', 'status'],
      reply: { stdout: ghStatus("'gist', 'project', 'read:org', 'repo'") },
    },
    { bin: 'gh', args: ['api'], reply: { stdout: '' } },
    { bin: 'python3', args: ['--version'], reply: { stdout: 'Python 3.12.4\n' } },
    { bin: 'claude', args: ['--version'], reply: { stdout: '2.1.276 (Claude Code)\n' } },
    {
      bin: 'claude',
      args: ['auth', 'status', '--json'],
      reply: { stdout: '{"loggedIn": true, "authMethod": "claude.ai"}\n' },
    },
    { bin: 'brew', args: ['--version'], reply: { stdout: 'Homebrew 4.6.0\n' } },
    { bin: 'npm', args: ['--version'], reply: { stdout: '10.9.0\n' } },
  ];
}

/** A runner whose first rules are `rules`, followed by the rules of a fine machine. */
function runnerWith(rules: ScriptedRule[]): ScriptedRunner {
  return createScriptedRunner([...rules, ...fineRules()]);
}

/** A reply that never comes, for a command that hangs. */
function never(): Promise<Partial<RunResult>> {
  return new Promise<Partial<RunResult>>(() => undefined);
}

function assertGuided(check: { guidance: string | null }, pattern: RegExp): void {
  assert.notEqual(check.guidance, null);
  assert.match(check.guidance ?? '', pattern);
  assert.match(check.guidance ?? '', /check again\.$/);
}

/** A full `EngineCheck` for a hand-added (non-catalog) engine, for `engineRequirement`'s unit tests. */
function handAddedEntry(name: string, state: MachineCheckState): EngineCheck {
  return {
    engineId: name,
    name,
    binary: name,
    state,
    ...guidanceFor({ name, link: null, installCommand: null, signInCommand: null }, state),
    catalogId: null,
    maker: null,
    required: false,
    guardedSessions: false,
    installed:
      state.kind === 'missing' ? { kind: 'missing' } : { kind: 'installed', version: null },
    signIn: state.kind === 'not-signed-in' ? { kind: 'not-signed-in' } : { kind: 'not-checked' },
    installCommand: null,
    installNeeds: null,
    signInCommand: null,
    note: null,
    page: null,
  };
}

// ---------- versions ----------

test('parseToolVersion reads the version out of the output of each tool', () => {
  assert.deepEqual(parseToolVersion('git version 2.39.3 (Apple Git-146)'), {
    major: 2,
    minor: 39,
    patch: 3,
  });
  assert.deepEqual(parseToolVersion('git version 2.41.0.windows.1'), {
    major: 2,
    minor: 41,
    patch: 0,
  });
  assert.deepEqual(parseToolVersion('gh version 2.4.0 (2021-12-21)\nhttps://github.com/cli'), {
    major: 2,
    minor: 4,
    patch: 0,
  });
  assert.deepEqual(parseToolVersion('Python 3.13.0rc1'), { major: 3, minor: 13, patch: 0 });
  assert.deepEqual(parseToolVersion('Python 3.8'), { major: 3, minor: 8, patch: 0 });
  assert.deepEqual(parseToolVersion('2.1.276 (Claude Code)'), { major: 2, minor: 1, patch: 276 });
});

test('parseToolVersion answers null for text without a version', () => {
  for (const text of ['', 'git version', 'version two', '2026-04-28', 'v3', '12345678.1']) {
    assert.equal(parseToolVersion(text), null, text);
  }
});

test('compareToolVersions orders by major, then minor, then patch', () => {
  const v = (major: number, minor: number, patch: number) => ({ major, minor, patch });
  assert.ok(compareToolVersions(v(2, 9, 9), v(2, 28, 0)) < 0);
  assert.ok(compareToolVersions(v(3, 0, 0), v(2, 99, 99)) > 0);
  assert.ok(compareToolVersions(v(2, 28, 1), v(2, 28, 0)) > 0);
  assert.equal(compareToolVersions(v(3, 8, 0), v(3, 8, 0)), 0);
  assert.equal(formatToolVersion(v(3, 8, 0)), '3.8.0');
});

test('the lowest accepted versions', () => {
  assert.equal(formatToolVersion(MIN_GIT_VERSION), '2.28.0');
  assert.equal(formatToolVersion(MIN_GH_VERSION), '2.81.0');
  assert.equal(formatToolVersion(MIN_PYTHON_VERSION), '3.8.0');
  assert.equal(DEFAULT_MACHINE_CHECK_TIMEOUT_MS, 10_000);
});

// ---------- git ----------

test('git: present and fine', async () => {
  const runner = runnerWith([]);
  const check = await checkGit(runner, LINUX);
  assert.deepEqual(check, {
    id: 'git',
    binary: 'git',
    state: { kind: 'fine', version: '2.39.3' },
    guidance: null,
    command: null,
  });
  assert.deepEqual(
    runner.calls.map((call) => [call.bin, ...call.args]),
    [['git', '--version']],
  );
  assert.equal(runner.calls[0]?.opts.timeoutMs, DEFAULT_MACHINE_CHECK_TIMEOUT_MS);
});

test('git: missing (ENOENT), with the install command of the platform', async () => {
  const runner = runnerWith([{ bin: 'git', reply: NOT_FOUND }]);
  const onLinux = await checkGit(runner, LINUX);
  assert.deepEqual(onLinux.state, { kind: 'missing' });
  assert.equal(onLinux.command, null);
  assertGuided(onLinux, /git was not found on this machine\. Install it from https:\/\/git-scm/);

  const onMac = await checkGit(
    runnerWith([
      { bin: '/usr/bin/xcode-select', reply: { stdout: '/Library/Developer/CommandLineTools\n' } },
      { bin: 'git', reply: NOT_FOUND },
    ]),
    { platform: 'darwin' },
  );
  assert.deepEqual(onMac.state, { kind: 'missing' });
  assert.equal(onMac.command, 'xcode-select --install');
  assertGuided(onMac, /`xcode-select --install`/);
});

test('git: too old', async () => {
  const check = await checkGit(
    runnerWith([{ bin: 'git', reply: { stdout: 'git version 2.20.1\n' } }]),
    LINUX,
  );
  assert.deepEqual(check.state, { kind: 'too-old', version: '2.20.1', minimum: '2.28.0' });
  assertGuided(check, /git 2\.20\.1 is installed, and the companion needs 2\.28\.0 or later/);
});

test('git: malformed version output is undetermined, with what was printed', async () => {
  const check = await checkGit(
    runnerWith([{ bin: 'git', reply: { stdout: 'git version unknown\n' } }]),
    LINUX,
  );
  assert.equal(check.state.kind, 'undetermined');
  assertGuided(check, /answered without a version number; it printed "git version unknown"/);
});

test('git: a failing command is undetermined, with the exit code', async () => {
  const check = await checkGit(
    runnerWith([{ bin: 'git', reply: { code: 129, stderr: 'fatal: broken\n' } }]),
    LINUX,
  );
  assert.equal(check.state.kind, 'undetermined');
  assertGuided(check, /`git --version` exited with code 129; it printed "fatal: broken"/);
});

test('git on macOS: the placeholder of the developer tools is not run', async () => {
  const runner = createScriptedRunner([
    {
      bin: '/usr/bin/xcode-select',
      args: ['-p'],
      reply: { code: 2, stderr: 'xcode-select: error: unable to get active developer directory' },
    },
    { bin: '/usr/bin/which', args: ['git'], reply: { stdout: '/usr/bin/git\n' } },
  ]);
  const check = await checkGit(runner, { platform: 'darwin' });
  assert.deepEqual(check.state, { kind: 'missing' });
  assert.equal(check.command, 'xcode-select --install');
  assert.equal(
    runner.calls.some((call) => call.bin === 'git'),
    false,
  );
});

test('git on macOS: a git from elsewhere is run although the developer tools are missing', async () => {
  const runner = runnerWith([
    { bin: '/usr/bin/xcode-select', reply: { code: 2 } },
    { bin: '/usr/bin/which', reply: { stdout: '/opt/homebrew/bin/git\n' } },
  ]);
  const check = await checkGit(runner, { platform: 'darwin' });
  assert.deepEqual(check.state, { kind: 'fine', version: '2.39.3' });
});

test('git on macOS: the message of the placeholder is read as missing', async () => {
  const check = await checkGit(
    runnerWith([
      { bin: '/usr/bin/xcode-select', reply: NOT_FOUND },
      {
        bin: 'git',
        reply: { code: 1, stderr: 'xcode-select: note: no developer tools were found\n' },
      },
    ]),
    { platform: 'darwin' },
  );
  assert.deepEqual(check.state, { kind: 'missing' });
});

// ---------- python3 ----------

test('python3: present and fine', async () => {
  const check = await checkPython3(runnerWith([]), LINUX);
  assert.deepEqual(check.state, { kind: 'fine', version: '3.12.4' });
  assert.equal(check.guidance, null);
  const lowest = await checkPython3(
    runnerWith([{ bin: 'python3', reply: { stdout: 'Python 3.8.0\n' } }]),
    LINUX,
  );
  assert.deepEqual(lowest.state, { kind: 'fine', version: '3.8.0' });
});

test('python3: missing (ENOENT)', async () => {
  const check = await checkPython3(runnerWith([{ bin: 'python3', reply: NOT_FOUND }]), LINUX);
  assert.deepEqual(check.state, { kind: 'missing' });
  assertGuided(check, /python3 was not found on this machine.*python\.org/);
});

test('python3: too old, also when the version is on standard error', async () => {
  const check = await checkPython3(
    runnerWith([{ bin: 'python3', reply: { stdout: 'Python 3.7.9\n' } }]),
    LINUX,
  );
  assert.deepEqual(check.state, { kind: 'too-old', version: '3.7.9', minimum: '3.8.0' });
  assertGuided(check, /python3 3\.7\.9 is installed, and the companion needs 3\.8\.0 or later/);
  const two = await checkPython3(
    runnerWith([{ bin: 'python3', reply: { stderr: 'Python 2.7.18\n' } }]),
    LINUX,
  );
  assert.deepEqual(two.state, { kind: 'too-old', version: '2.7.18', minimum: '3.8.0' });
});

test('python3: malformed version output is undetermined', async () => {
  const check = await checkPython3(
    runnerWith([{ bin: 'python3', reply: { stdout: 'Python three\n' } }]),
    LINUX,
  );
  assert.equal(check.state.kind, 'undetermined');
  assertGuided(check, /The state of python3 could not be determined/);
});

// ---------- gh ----------

test('gh: present, signed in and scoped', async () => {
  const runner = runnerWith([]);
  const check = await checkGh(runner, LINUX);
  assert.deepEqual(check.state, { kind: 'fine', version: '2.92.0' });
  assert.equal(check.guidance, null);
  assert.deepEqual(
    runner.calls.map((call) => [call.bin, ...call.args]),
    [
      ['gh', '--version'],
      ['gh', 'auth', 'status', '--hostname', GITHUB_HOST],
    ],
  );
});

test('gh: missing (ENOENT)', async () => {
  const check = await checkGh(runnerWith([{ bin: 'gh', reply: NOT_FOUND }]), LINUX);
  assert.deepEqual(check.state, { kind: 'missing' });
  assertGuided(
    check,
    /gh was not found on this machine\. Install it from https:\/\/cli\.github\.com/,
  );
});

test('gh: too old, and the sign-in is then not asked', async () => {
  const runner = runnerWith([
    { bin: 'gh', args: ['--version'], reply: { stdout: 'gh version 2.4.0 (2021-12-21)\n' } },
  ]);
  const check = await checkGh(runner, LINUX);
  assert.deepEqual(check.state, { kind: 'too-old', version: '2.4.0', minimum: '2.81.0' });
  assert.equal(runner.calls.length, 1);

  // 2.80.0 has `gh issue develop --branch-repo` and lacks `gh auth status --json`, which the adapter needs.
  const justBelow = await checkGh(
    runnerWith([
      { bin: 'gh', args: ['--version'], reply: { stdout: 'gh version 2.80.0 (2025-09-23)\n' } },
    ]),
    LINUX,
  );
  assert.equal(justBelow.state.kind, 'too-old');
  const lowest = await checkGh(
    runnerWith([
      { bin: 'gh', args: ['--version'], reply: { stdout: 'gh version 2.81.0 (2025-10-01)\n' } },
    ]),
    LINUX,
  );
  assert.deepEqual(lowest.state, { kind: 'fine', version: '2.81.0' });
});

test('gh: not signed in, with the literal sign-in command', async () => {
  for (const reply of [
    { code: 1, stderr: GH_NOT_LOGGED_IN },
    { code: 1, stdout: GH_NOT_LOGGED_IN },
    {
      code: 1,
      stdout:
        'github.com\n  X Failed to log in to github.com account lead (keyring)\n  - Active account: true\n  - The token in keyring is invalid.\n',
    },
  ]) {
    const check = await checkGh(runnerWith([{ bin: 'gh', args: ['auth'], reply }]), LINUX);
    assert.deepEqual(check.state, { kind: 'not-signed-in' });
    assert.equal(check.command, GH_SIGN_IN_COMMAND);
    assert.equal(check.command, 'gh auth login --hostname github.com --scopes project');
    assertGuided(check, /gh is installed and not signed in\. Run `gh auth login --hostname/);
  }
});

test('gh: signed in without the project scope, with the literal command that adds it', async () => {
  const check = await checkGh(
    runnerWith([
      {
        bin: 'gh',
        args: ['auth'],
        // The account that is not active has the scope; only the active one counts.
        reply: { stdout: ghStatus("'gist', 'read:project', 'repo'", "'project', 'repo'") },
      },
    ]),
    LINUX,
  );
  assert.deepEqual(check.state, { kind: 'missing-scope', scope: REQUIRED_GH_SCOPE });
  assert.equal(check.command, GH_ADD_SCOPE_COMMAND);
  assert.equal(check.command, 'gh auth refresh --hostname github.com --scopes project');
  assertGuided(
    check,
    /lacks the `project` scope.*`gh auth refresh --hostname github\.com --scopes project`/,
  );
});

test('gh: undetermined when GitHub cannot be reached, when no scopes are listed, and for unknown text', async () => {
  const offline = await checkGh(
    runnerWith([
      {
        bin: 'gh',
        args: ['auth'],
        reply: {
          code: 1,
          stderr:
            'X github.com: api call failed: Get "https://api.github.com/": dial tcp: lookup api.github.com: no such host\n',
        },
      },
    ]),
    LINUX,
  );
  assert.equal(offline.state.kind, 'undetermined');
  assertGuided(offline, /could not reach github\.com/);

  const noScopes = await checkGh(
    runnerWith([
      {
        bin: 'gh',
        args: ['auth'],
        reply: { stdout: 'github.com\n  ✓ Logged in to github.com account lead (GH_TOKEN)\n' },
      },
    ]),
    LINUX,
  );
  assert.equal(noScopes.state.kind, 'undetermined');
  assertGuided(noScopes, /did not list the scopes of the token/);
  assertGuided(noScopes, /a fine-grained token or an app's token/);
  assertGuided(noScopes, /run `gh auth login --hostname github\.com --scopes project`/);
  assert.equal(noScopes.command, null);

  const unknown = await checkGh(
    runnerWith([{ bin: 'gh', args: ['auth'], reply: { code: 4, stdout: 'something new\n' } }]),
    LINUX,
  );
  assert.equal(unknown.state.kind, 'undetermined');
  assertGuided(unknown, /exited with code 4 and its answer was not understood/);
});

test('gh: refused by the live-system guard is undetermined, never a token in the reason', async () => {
  const refused = await checkGh(
    runnerWith([
      {
        bin: 'gh',
        reply: { code: -1, stderr: 'set AI_LORE_ALLOW_LIVE_GITHUB=1', failure: 'refused' },
      },
    ]),
    LINUX,
  );
  assert.equal(refused.state.kind, 'undetermined');
  assertGuided(refused, /guard refused it/);

  const leaky = await checkGh(
    runnerWith([
      { bin: 'gh', args: ['auth'], reply: { code: 3, stdout: '  - Token: gho_secret\nodd\n' } },
    ]),
    LINUX,
  );
  assert.doesNotMatch(leaky.guidance ?? '', /gho_secret/);
  assert.match(leaky.guidance ?? '', /it printed "odd"/);
});

test('parseGhAuthStatus reads the old and the new text', () => {
  assert.deepEqual(parseGhAuthStatus(ghStatus("'gist', 'project'")), {
    kind: 'signed-in',
    account: 'lead',
    scopes: ['gist', 'project'],
  });
  const old =
    'github.com\n  ✓ Logged in to github.com as lead (oauth_token)\n  ✓ Git operations for github.com configured to use https protocol.\n  ✓ Token: *******************\n  ✓ Token scopes: gist, project, repo\n';
  assert.deepEqual(parseGhAuthStatus(old), {
    kind: 'signed-in',
    account: 'lead',
    scopes: ['gist', 'project', 'repo'],
  });
  assert.deepEqual(
    parseGhAuthStatus(
      '  ✓ Logged in to github.com account lead (keyring)\n  - Token scopes: none\n',
    ),
    { kind: 'signed-in', account: 'lead', scopes: [] },
  );
  assert.deepEqual(parseGhAuthStatus(GH_NOT_LOGGED_IN), { kind: 'not-signed-in' });
  assert.deepEqual(parseGhAuthStatus('error connecting to api.github.com'), {
    kind: 'unreachable',
  });
  assert.deepEqual(parseGhAuthStatus(''), { kind: 'unknown' });
});

test('parseGhAuthStatus reads the account gh uses: recorded text of gh 2.92.0 with three accounts', () => {
  // RECORDED on 2026-09-18, the logins replaced. The active account lacks `project`; an inactive one has it.
  const account = (login: string, active: boolean, scopes: string): string[] => [
    `  ✓ Logged in to github.com account ${login} (keyring)`,
    `  - Active account: ${active}`,
    '  - Git operations protocol: https',
    '  - Token: gho_************************************',
    `  - Token scopes: ${scopes}`,
    '',
  ];
  const withoutProject = "'gist', 'read:org', 'repo', 'workflow'";
  const withProject = "'gist', 'project', 'read:org', 'repo', 'workflow'";
  const recorded = [
    'github.com',
    ...account('first', true, withoutProject),
    ...account('second', false, withoutProject),
    ...account('third', false, withProject),
  ].join('\n');
  assert.deepEqual(parseGhAuthStatus(recorded), {
    kind: 'signed-in',
    account: 'first',
    scopes: ['gist', 'read:org', 'repo', 'workflow'],
  });
  // The active account is not the first one listed.
  const activeLast = [
    'github.com',
    ...account('first', false, withProject),
    ...account('third', true, withoutProject),
  ].join('\n');
  assert.equal(
    (parseGhAuthStatus(activeLast) as { account: string | null }).account,
    'third',
    'the scopes of an inactive account are no evidence',
  );
});

test('parseGhAuthStatus: the active account failed or timed out, whatever the other accounts say', () => {
  const signedInInactive = [
    '  ✓ Logged in to github.com account other (keyring)',
    '  - Active account: false',
    "  - Token scopes: 'project', 'repo'",
    '',
  ];
  // From the source of gh 2.92.0, pkg/cmd/auth/status/status.go.
  const failed = [
    'github.com',
    '  X Failed to log in to github.com account lead (keyring)',
    '  - Active account: true',
    '  - The token in keyring is invalid.',
    '  - To re-authenticate, run: gh auth login -h github.com',
    '',
    ...signedInInactive,
  ].join('\n');
  assert.deepEqual(parseGhAuthStatus(failed), { kind: 'not-signed-in' });
  const timedOut = [
    'github.com',
    ...signedInInactive,
    '  X Timeout trying to log in to github.com account lead (keyring)',
    '  - Active account: true',
    '',
  ].join('\n');
  assert.deepEqual(parseGhAuthStatus(timedOut), { kind: 'unreachable' });
  // A token from the environment: gh names the variable, and lists scopes for a classic token only.
  const classic =
    "github.com\n  ✓ Logged in to github.com account lead (GH_TOKEN)\n  - Active account: true\n  - Token: ghp_****\n  - Token scopes: 'project', 'repo'\n";
  assert.deepEqual(parseGhAuthStatus(classic), {
    kind: 'signed-in',
    account: 'lead',
    scopes: ['project', 'repo'],
  });
  const fineGrained =
    'github.com\n  ✓ Logged in to github.com account lead (GH_TOKEN)\n  - Active account: true\n  - Git operations protocol: https\n  - Token: github_pat_****\n';
  assert.deepEqual(parseGhAuthStatus(fineGrained), {
    kind: 'signed-in',
    account: 'lead',
    scopes: null,
  });
});

test('parseToolVersion on odd output: pre-releases, a localised word, commas, nothing', () => {
  const v = (major: number, minor: number, patch: number) => ({ major, minor, patch });
  assert.deepEqual(parseToolVersion('git version 2.39.5 (Apple Git-154)'), v(2, 39, 5));
  assert.deepEqual(parseToolVersion('2.45.0.windows.1'), v(2, 45, 0));
  assert.deepEqual(parseToolVersion('git version 2.50.0-rc1'), v(2, 50, 0));
  assert.deepEqual(parseToolVersion('Python 3.12.0a7+'), v(3, 12, 0));
  assert.deepEqual(parseToolVersion('Python 3.14.3'), v(3, 14, 3));
  assert.deepEqual(parseToolVersion('gh version 2.30.0-15-gabc123 (2023-06-01)'), v(2, 30, 0));
  assert.deepEqual(parseToolVersion('git versión 2.39.3'), v(2, 39, 3));
  assert.equal(parseToolVersion('git Version 2,39,3'), null);
  assert.equal(parseToolVersion('\n'), null);
  assert.equal(parseToolVersion('version 1234567.1.1'), null);
});

// ---------- GitHub: the account and organisations ----------

test('checkGitHub: the account and organisations of a signed-in gh; a failing orgs call gives []; not signed in asks no orgs', async () => {
  const signedInRunner = runnerWith([
    { bin: 'gh', args: ['api'], reply: { stdout: 'acme\nwidgets\n' } },
  ]);
  const signedIn = await checkGitHub(signedInRunner, LINUX);
  assert.equal(signedIn.requirement.state.kind, 'fine');
  assert.equal(signedIn.account, 'lead');
  assert.deepEqual(signedIn.organisations, ['acme', 'widgets']);

  const failingOrgs = await checkGitHub(
    runnerWith([{ bin: 'gh', args: ['api'], reply: { code: 1, stderr: 'boom' } }]),
    LINUX,
  );
  assert.equal(failingOrgs.account, 'lead');
  assert.deepEqual(failingOrgs.organisations, []);

  const notSignedInRunner = runnerWith([
    { bin: 'gh', args: ['auth'], reply: { code: 1, stdout: GH_NOT_LOGGED_IN } },
  ]);
  const notSignedIn = await checkGitHub(notSignedInRunner, LINUX);
  assert.equal(notSignedIn.account, null);
  assert.deepEqual(notSignedIn.organisations, []);
  assert.equal(
    notSignedInRunner.calls.some((call) => call.args[0] === 'api'),
    false,
    'no organisations call when not signed in',
  );
});

test('checkGitHub: a machine with gh missing gives no account, no organisations, and a missing requirement', async () => {
  const check = await checkGitHub(runnerWith([{ bin: 'gh', reply: NOT_FOUND }]), LINUX);
  assert.equal(check.requirement.state.kind, 'missing');
  assert.equal(check.account, null);
  assert.deepEqual(check.organisations, []);
});

// ---------- the engine ----------

test('engine: present and signed in, filled from its catalog entry', async () => {
  const runner = runnerWith([]);
  const check = await checkEngine(runner, CLAUDE, LINUX);
  assert.deepEqual(check, {
    engineId: 'default.claude',
    name: 'Claude',
    binary: 'claude',
    state: { kind: 'fine', version: '2.1.276' },
    guidance: null,
    command: null,
    catalogId: 'claude-code',
    maker: 'Anthropic',
    required: true,
    guardedSessions: true,
    installed: { kind: 'installed', version: '2.1.276' },
    signIn: { kind: 'signed-in' },
    installCommand: 'curl -fsSL https://claude.ai/install.sh | bash',
    installNeeds: null,
    signInCommand: 'claude auth login',
    note: null,
    page: 'https://code.claude.com/docs/en/setup',
  });
  assert.deepEqual(
    runner.calls.map((call) => [call.bin, ...call.args]),
    [
      ['claude', '--version'],
      ['claude', ...CLAUDE_AUTH_STATUS_ARGS],
    ],
  );
});

test('engine: missing (ENOENT), by the binary of the registry entry', async () => {
  const entry: EngineEntry = { ...CLAUDE, binary: '/opt/tools/claude', args: ['--model', 'opus'] };
  const runner = runnerWith([{ bin: '/opt/tools/claude', reply: NOT_FOUND }]);
  const check = await checkEngine(runner, entry, LINUX);
  assert.deepEqual(check.state, { kind: 'missing' });
  assert.deepEqual(check.installed, { kind: 'missing' });
  assert.deepEqual(check.signIn, { kind: 'not-checked' });
  assertGuided(
    check,
    /Claude was not found on this machine\. Install it from https:\/\/docs\.claude/,
  );
  assert.deepEqual(runner.calls[0]?.args, ['--version']);
  assert.equal(runner.calls.length, 1, 'sign-in is not asked when the engine is not installed');
});

test('engine: not signed in, with the literal sign-in command', async () => {
  const check = await checkEngine(
    runnerWith([
      { bin: 'claude', args: ['auth'], reply: { code: 1, stdout: '{"loggedIn": false}' } },
    ]),
    CLAUDE,
    LINUX,
  );
  assert.deepEqual(check.state, { kind: 'not-signed-in' });
  assert.deepEqual(check.signIn, { kind: 'not-signed-in' });
  assert.equal(check.command, CLAUDE_SIGN_IN_COMMAND);
  assertGuided(check, /Claude is installed and not signed in\. Run `claude auth login`/);
});

test('engine: a sign-in probe that cannot tell is undetermined but does not block: the state stays fine', async () => {
  for (const reply of [
    { code: 1, stderr: "error: unknown option '--json'\n" },
    { code: 0, stdout: 'Logged in\n' },
    { code: 0, stdout: '{"loggedIn": "yes"}' },
    { code: -1, stderr: 'stopped', failure: 'timeout' as const },
    { code: -1, stderr: 'gone', failure: 'not-found' as const },
  ]) {
    const check = await checkEngine(
      runnerWith([{ bin: 'claude', args: ['auth'], reply }]),
      CLAUDE,
      LINUX,
    );
    assert.equal(check.signIn.kind, 'undetermined', JSON.stringify(reply));
    assert.deepEqual(check.state, { kind: 'fine', version: '2.1.276' }, JSON.stringify(reply));
    assert.equal(check.guidance, null, JSON.stringify(reply));
    assert.match(
      (check.signIn as { reason: string }).reason,
      /^`claude auth status --json`/,
      JSON.stringify(reply),
    );
  }
});

test('engine: an engine the companion has no probe for is not-checked, and does not block', async () => {
  const runner = createScriptedRunner([{ bin: 'gemini', reply: { stdout: '0.9.0\n' } }]);
  const check = await checkEngine(runner, GEMINI, LINUX);
  assert.deepEqual(check.installed, { kind: 'installed', version: '0.9.0' });
  assert.deepEqual(check.signIn, { kind: 'not-checked' });
  assert.equal(check.catalogId, null);
  assert.deepEqual(check.state, { kind: 'fine', version: '0.9.0' });
  assert.equal(check.guidance, null);
  assert.equal(runner.calls.length, 1);
});

test('engine: a version the engine does not print is accepted, no lowest version is asked', async () => {
  const check = await checkEngine(
    runnerWith([{ bin: 'claude', args: ['--version'], reply: { stdout: 'Claude Code\n' } }]),
    CLAUDE,
    LINUX,
  );
  assert.deepEqual(check.state, { kind: 'fine', version: null });
});

test('engine: the sign-in probe is a parameter; a probe that throws or hangs is reported but does not block', async () => {
  const signedIn = await checkEngine(createScriptedRunner([{ bin: 'gemini' }]), GEMINI, {
    ...LINUX,
    signInProbe: async () => ({ kind: 'signed-in' }),
  });
  assert.deepEqual(signedIn.signIn, { kind: 'signed-in' });
  assert.deepEqual(signedIn.state, { kind: 'fine', version: null });

  const throwing = await checkEngine(createScriptedRunner([{ bin: 'gemini' }]), GEMINI, {
    ...LINUX,
    signInProbe: () => {
      throw new Error('probe broke');
    },
  });
  assert.deepEqual(throwing.signIn, {
    kind: 'undetermined',
    reason: 'The sign-in probe of Gemini failed: probe broke.',
  });
  assert.deepEqual(throwing.state, { kind: 'fine', version: null });

  const hanging = await checkEngine(createScriptedRunner([{ bin: 'gemini' }]), GEMINI, {
    ...LINUX,
    timeoutMs: 10,
    signInProbe: () => new Promise(() => undefined),
  });
  assert.deepEqual(hanging.signIn, {
    kind: 'undetermined',
    reason: 'The sign-in probe of Gemini did not answer in time.',
  });
  assert.deepEqual(hanging.state, { kind: 'fine', version: null });
});

test('engine: codex login status exit code decides signed-in state', async () => {
  const signedIn = await checkEngine(
    runnerWith([
      { bin: 'codex', args: ['--version'], reply: { stdout: 'codex-cli 0.5.0\n' } },
      { bin: 'codex', args: ['login', 'status'], reply: { code: 0 } },
    ]),
    CODEX,
    LINUX,
  );
  assert.deepEqual(signedIn.signIn, { kind: 'signed-in' });
  assert.equal(signedIn.catalogId, 'codex');

  const notSignedIn = await checkEngine(
    runnerWith([
      { bin: 'codex', args: ['--version'], reply: { stdout: 'codex-cli 0.5.0\n' } },
      { bin: 'codex', args: ['login', 'status'], reply: { code: 1 } },
    ]),
    CODEX,
    LINUX,
  );
  assert.deepEqual(notSignedIn.signIn, { kind: 'not-signed-in' });

  const timedOut = await checkEngine(
    runnerWith([
      { bin: 'codex', args: ['--version'], reply: { stdout: 'codex-cli 0.5.0\n' } },
      {
        bin: 'codex',
        args: ['login', 'status'],
        reply: { code: -1, stderr: 'stopped', failure: 'timeout' },
      },
    ]),
    CODEX,
    LINUX,
  );
  assert.equal(timedOut.signIn.kind, 'undetermined');
});

test('engine: antigravity has no sign-in check and is always not-checked', async () => {
  const check = await checkEngine(
    runnerWith([{ bin: 'agy', args: ['--version'], reply: { stdout: 'agy 1.0.0\n' } }]),
    ANTIGRAVITY,
    LINUX,
  );
  assert.deepEqual(check.signIn, { kind: 'not-checked' });
  assert.deepEqual(check.state, { kind: 'fine', version: '1.0.0' });
});

test('parseOpencodeAuthList reads the credentials count, falls back to a bullet line, else null', () => {
  assert.equal(
    parseOpencodeAuthList(
      '┌  Credentials ~/.local/share/opencode/auth.json\n│\n●  Anthropic oauth\n│\n└  1 credentials\n',
    ),
    true,
  );
  assert.equal(parseOpencodeAuthList('└  0 credentials\n'), false);
  assert.equal(parseOpencodeAuthList(''), null);
  assert.equal(
    parseOpencodeAuthList(
      '\u001b[32m┌\u001b[0m  Credentials\n\u001b[32m└\u001b[0m  1 credentials\n',
    ),
    true,
  );
});

test('engine: opencode is signed in by its credentials count', async () => {
  const signedIn = await checkEngine(
    runnerWith([
      { bin: 'opencode', args: ['--version'], reply: { stdout: '0.4.0\n' } },
      { bin: 'opencode', args: ['auth', 'list'], reply: { stdout: '└  1 credentials\n' } },
    ]),
    OPENCODE,
    LINUX,
  );
  assert.deepEqual(signedIn.signIn, { kind: 'signed-in' });

  const notSignedIn = await checkEngine(
    runnerWith([
      { bin: 'opencode', args: ['--version'], reply: { stdout: '0.4.0\n' } },
      { bin: 'opencode', args: ['auth', 'list'], reply: { stdout: '└  0 credentials\n' } },
    ]),
    OPENCODE,
    LINUX,
  );
  assert.deepEqual(notSignedIn.signIn, { kind: 'not-signed-in' });

  const unclear = await checkEngine(
    runnerWith([
      { bin: 'opencode', args: ['--version'], reply: { stdout: '0.4.0\n' } },
      { bin: 'opencode', args: ['auth', 'list'], reply: { stdout: 'nothing understood\n' } },
    ]),
    OPENCODE,
    LINUX,
  );
  assert.equal(unclear.signIn.kind, 'undetermined');
});

test('probeEngineSignIn, isClaudeEngine and parseClaudeAuthStatus', async () => {
  assert.equal(CLAUDE_BINARY_NAME, 'claude');
  assert.equal(isClaudeEngine(CLAUDE), true);
  assert.equal(isClaudeEngine({ ...CLAUDE, binary: '/Users/lead/.local/bin/claude' }), true);
  assert.equal(isClaudeEngine(GEMINI), false);
  assert.equal(parseClaudeAuthStatus('{"loggedIn": true, "email": "x"}'), true);
  assert.equal(parseClaudeAuthStatus('{"loggedIn": false}'), false);
  for (const text of ['', 'null', '[]', '{"loggedIn": 1}', 'Logged in']) {
    assert.equal(parseClaudeAuthStatus(text), null, text);
  }
  const asked: string[][] = [];
  const state = await probeEngineSignIn(CLAUDE, async (bin, args) => {
    asked.push([bin, ...args]);
    return { code: 0, stdout: '{"loggedIn": true}', stderr: '' };
  });
  assert.deepEqual(state, { kind: 'signed-in' });
  assert.deepEqual(asked, [['claude', 'auth', 'status', '--json']]);
});

test('engineRequirement takes the first fine engine, otherwise the one nearest to fine', () => {
  const missing = handAddedEntry('a', { kind: 'missing' });
  const signedOut = handAddedEntry('b', { kind: 'not-signed-in' });
  const fine = handAddedEntry('c', { kind: 'fine', version: '1.0.0' });
  const alsoFine = handAddedEntry('d', { kind: 'fine', version: '2.0.0' });

  assert.equal(engineRequirement([missing, signedOut, fine, alsoFine]).binary, 'c');
  const nearest = engineRequirement([missing, signedOut]);
  assert.equal(nearest.id, 'engine');
  assert.equal(nearest.binary, 'b');
  assert.equal(nearest.guidance, signedOut.guidance);

  const empty = engineRequirement([]);
  assert.deepEqual(empty.state, { kind: 'missing' });
  assert.equal(empty.binary, null);
  assertGuided(empty, /No AI engine is registered/);
});

test('engineRequirement prefers the catalog Claude Code entry, whatever its state', async () => {
  const claudeMissing = await checkEngine(
    runnerWith([{ bin: 'claude', reply: NOT_FOUND }]),
    CLAUDE,
    LINUX,
  );
  const codexFine = await checkEngine(
    runnerWith([
      { bin: 'codex', args: ['--version'], reply: { stdout: '0.5.0\n' } },
      { bin: 'codex', args: ['login', 'status'], reply: { code: 0 } },
    ]),
    CODEX,
    LINUX,
  );
  const requirement = engineRequirement([codexFine, claudeMissing]);
  assert.equal(requirement.binary, 'claude');
  assert.equal(requirement.state.kind, 'missing');
});

// ---------- guidance ----------

test('guidanceFor gives a sentence for every state that is not fine', () => {
  const subject = { name: 'tool', link: null, installCommand: null, signInCommand: null };
  assert.deepEqual(guidanceFor(subject, { kind: 'fine', version: '1.0.0' }), {
    guidance: null,
    command: null,
  });
  const states: MachineCheckState[] = [
    { kind: 'missing' },
    { kind: 'too-old', version: '1.0.0', minimum: '2.0.0' },
    { kind: 'not-signed-in' },
    { kind: 'missing-scope', scope: 'project' },
    { kind: 'undetermined', reason: 'It did not answer.' },
  ];
  for (const state of states) assertGuided(guidanceFor(subject, state), /tool/);
  assert.equal(
    guidanceFor(subject, { kind: 'not-signed-in' }).guidance,
    'tool is installed and not signed in. Sign in to it in the terminal, with its own flow. Then check again.',
  );
  assert.equal(platformInstallCommand('git', 'darwin'), 'xcode-select --install');
  assert.equal(platformInstallCommand('python3', 'darwin'), 'xcode-select --install');
  assert.equal(platformInstallCommand('git', 'linux'), null);
  assert.equal(platformInstallCommand('python3', 'win32'), null);
  assert.match(INSTALL_LINKS.gh, /^https:\/\//);
});

// ---------- the whole check ----------

test('checkMachine: a machine with everything is ready; the four are in a fixed order', async () => {
  const runner = runnerWith([]);
  const check = await checkMachine(runner, [CLAUDE], { ...LINUX, env: { PATH: '/lead/bin' } });
  assert.equal(check.ready, true);
  assert.deepEqual(
    check.requirements.map((one) => [one.id, one.state.kind]),
    [
      ['git', 'fine'],
      ['gh', 'fine'],
      ['engine', 'fine'],
      ['python3', 'fine'],
    ],
  );
  assert.equal(check.engines.length, 1);
  assert.deepEqual(check.github, { account: 'lead', organisations: [] });
  assert.deepEqual(check.tools, { brew: true, npm: true });
  for (const call of runner.calls) {
    assert.deepEqual(call.opts.env, { PATH: '/lead/bin' });
    assert.equal(call.opts.cwd, undefined);
    assert.equal(call.opts.input, undefined);
  }
  // Only questions are asked: no command that installs, signs in or changes a setting.
  const asked = runner.calls.map((call) => [call.bin, ...call.args].join(' ')).sort();
  assert.deepEqual(
    asked,
    [
      'claude --version',
      'claude auth status --json',
      'gh --version',
      'gh api user/orgs --paginate --jq .[].login',
      'gh auth status --hostname github.com',
      'git --version',
      'python3 --version',
      'brew --version',
      'npm --version',
    ].sort(),
  );
});

test('checkMachine: all four catalog engines checked; only Claude Code is installed and signed in', async () => {
  const runner = runnerWith([
    { bin: 'codex', reply: NOT_FOUND },
    { bin: 'agy', reply: NOT_FOUND },
    { bin: 'opencode', reply: NOT_FOUND },
  ]);
  const check = await checkMachine(runner, [CLAUDE, CODEX, ANTIGRAVITY, OPENCODE], LINUX);
  assert.equal(check.engines.length, 4);
  const [claude, codex, antigravity, opencode] = check.engines;
  assert.deepEqual(claude?.installed, { kind: 'installed', version: '2.1.276' });
  assert.deepEqual(claude?.signIn, { kind: 'signed-in' });
  for (const missing of [codex, antigravity, opencode]) {
    assert.deepEqual(missing?.installed, { kind: 'missing' });
    assert.deepEqual(missing?.signIn, { kind: 'not-checked' });
  }
  const engineReq = check.requirements.find((r) => r.id === 'engine');
  assert.equal(engineReq?.state.kind, 'fine');
});

test('checkMachine: Claude Code missing and Codex installed and signed in still gives a missing engine requirement', async () => {
  const runner = runnerWith([
    { bin: 'claude', args: ['--version'], reply: NOT_FOUND },
    { bin: 'codex', args: ['--version'], reply: { stdout: 'codex-cli 0.5.0\n' } },
    { bin: 'codex', args: ['login', 'status'], reply: { code: 0 } },
  ]);
  const check = await checkMachine(runner, [CLAUDE, CODEX], LINUX);
  const engineReq = check.requirements.find((r) => r.id === 'engine');
  assert.equal(engineReq?.state.kind, 'missing');
  const codex = check.engines.find((e) => e.engineId === 'default.codex');
  assert.deepEqual(codex?.installed, { kind: 'installed', version: '0.5.0' });
  assert.deepEqual(codex?.signIn, { kind: 'signed-in' });
});

test('checkMachine: tools.brew is false when brew is not found', async () => {
  const check = await checkMachine(
    runnerWith([{ bin: 'brew', reply: NOT_FOUND }]),
    [CLAUDE],
    LINUX,
  );
  assert.deepEqual(check.tools, { brew: false, npm: true });
});

test('checkMachine: the commands run in parallel', async () => {
  let running = 0;
  let most = 0;
  const slow = async (): Promise<Partial<RunResult>> => {
    running += 1;
    most = Math.max(most, running);
    await new Promise((resolve) => setTimeout(resolve, 20));
    running -= 1;
    return { stdout: 'version 9.9.9' };
  };
  const runner = createScriptedRunner([
    { bin: 'git', reply: slow },
    { bin: 'gh', args: ['--version'], reply: slow },
    { bin: 'python3', reply: slow },
    { bin: 'claude', args: ['--version'], reply: slow },
    ...fineRules(),
  ]);
  await checkMachine(runner, [CLAUDE], LINUX);
  assert.equal(most, 4);
});

test('checkMachine: a command that hangs is stopped at the timeout and the others still answer', async () => {
  const runner = runnerWith([{ bin: 'git', reply: never }]);
  const started = Date.now();
  const check = await checkMachine(runner, [CLAUDE], { ...LINUX, timeoutMs: 40 });
  assert.ok(Date.now() - started < 2000);
  assert.equal(check.ready, false);
  const [git, gh, engine, python3] = check.requirements;
  assert.deepEqual(git?.state, {
    kind: 'undetermined',
    reason: '`git --version` did not answer within 40 ms.',
  });
  assert.equal(gh?.state.kind, 'fine');
  assert.equal(engine?.state.kind, 'fine');
  assert.equal(python3?.state.kind, 'fine');
});

test('checkMachine: the timeout reported by the runner is undetermined too', async () => {
  const check = await checkMachine(
    runnerWith([{ bin: 'python3', reply: { code: -1, stderr: 'stopped', failure: 'timeout' } }]),
    [CLAUDE],
    LINUX,
  );
  assert.deepEqual(check.requirements[3]?.state, {
    kind: 'undetermined',
    reason: '`python3 --version` did not answer within 10 seconds.',
  });
});

test('checkMachine: everything missing (ENOENT), and no engine registered', async () => {
  const runner = createScriptedRunner([
    { bin: 'git', reply: NOT_FOUND },
    { bin: 'gh', reply: NOT_FOUND },
    { bin: 'python3', reply: NOT_FOUND },
    { bin: 'brew', reply: NOT_FOUND },
    { bin: 'npm', reply: NOT_FOUND },
  ]);
  const check = await checkMachine(runner, [], LINUX);
  assert.equal(check.ready, false);
  assert.deepEqual(
    check.requirements.map((one) => one.state.kind),
    ['missing', 'missing', 'missing', 'missing'],
  );
  for (const one of check.requirements) assert.notEqual(one.guidance, null);
  assert.deepEqual(check.github, { account: null, organisations: [] });
  assert.deepEqual(check.tools, { brew: false, npm: false });
});

test('checkMachine never throws: a runner that throws, rejects, or answers nonsense', async () => {
  const throwing: CommandRunner = {
    run() {
      throw new Error('runner broke');
    },
  };
  const rejecting: CommandRunner = { run: () => Promise.reject(new Error('runner rejected')) };
  // A scripted runner with no rules rejects every call.
  const unscripted = createScriptedRunner();
  const nonsense: CommandRunner = {
    // A NUL and U+FFFF, written by their codes so that this file holds neither.
    run: () =>
      Promise.resolve({ code: 0, stdout: `${String.fromCharCode(0, 0xffff)}{{{`, stderr: '' }),
  };
  const broken = { run: () => Promise.resolve(undefined) } as unknown as CommandRunner;

  // The `engine` requirement is the exception: a runner that answers with
  // success but garbled text (`nonsense`) gives a `fine` (unversioned) install
  // and an ambiguous sign-in answer, which by design (A.4) does not block. A
  // runner whose command does not run at all (the other four) still leaves it
  // `undetermined`.
  const cases: readonly [CommandRunner, boolean][] = [
    [throwing, true],
    [rejecting, true],
    [unscripted, true],
    [nonsense, false],
    [broken, true],
  ];
  for (const [runner, engineUndetermined] of cases) {
    for (const platform of ['linux', 'darwin'] as const) {
      const check = await checkMachine(runner, [CLAUDE, GEMINI], { platform, timeoutMs: 50 });
      assert.equal(check.ready, false);
      assert.equal(check.requirements.length, 4);
      for (const one of check.requirements) {
        if (one.id === 'engine' && !engineUndetermined) {
          assert.equal(one.state.kind, 'fine');
          continue;
        }
        assert.equal(one.state.kind, 'undetermined');
        assert.notEqual(one.guidance, null);
      }
    }
  }
  const thrown = await checkGit(throwing, LINUX);
  assert.match(
    thrown.guidance ?? '',
    /could not be run \(spawn-error\); it printed "runner broke"/,
  );
});

test('checkMachine: an option that is not a usable timeout falls back to the default', async () => {
  const runner = runnerWith([]);
  await checkGit(runner, { ...LINUX, timeoutMs: Number.NaN });
  await checkGit(runner, { ...LINUX, timeoutMs: -5 });
  assert.deepEqual(
    runner.calls.map((call) => call.opts.timeoutMs),
    [DEFAULT_MACHINE_CHECK_TIMEOUT_MS, DEFAULT_MACHINE_CHECK_TIMEOUT_MS],
  );
});
