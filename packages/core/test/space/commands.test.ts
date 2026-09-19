import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  GH_ADD_SCOPE_COMMAND,
  GH_WEB_SIGN_IN_COMMAND,
  parseDeviceCode,
  setupCommandLine,
  setupCommands,
} from '../../src/index.js';

test('setupCommands lists every command once, with its command line', () => {
  const commands = setupCommands();
  assert.deepEqual(
    commands.map((c) => c.id),
    [
      'install-command-line-tools',
      'install-gh',
      'update-gh',
      'github-sign-in',
      'github-add-project-scope',
      'engine-install:claude-code',
      'engine-sign-in:claude-code',
      'engine-install:codex',
      'engine-sign-in:codex',
      'engine-install:antigravity',
      'engine-sign-in:antigravity',
      'engine-install:opencode',
      'engine-sign-in:opencode',
    ],
  );
});

test('setupCommandLine gives the command line of each id of the table', () => {
  assert.equal(setupCommandLine('install-command-line-tools'), 'xcode-select --install');
  assert.equal(setupCommandLine('install-gh'), 'brew install gh');
  assert.equal(setupCommandLine('update-gh'), 'brew upgrade gh');
  assert.equal(setupCommandLine('github-sign-in'), GH_WEB_SIGN_IN_COMMAND);
  assert.equal(
    setupCommandLine('github-sign-in'),
    'gh auth login --hostname github.com --web --clipboard --git-protocol https --scopes project && gh auth setup-git',
  );
  assert.equal(setupCommandLine('github-add-project-scope'), GH_ADD_SCOPE_COMMAND);
  assert.equal(
    setupCommandLine('engine-install:claude-code'),
    'curl -fsSL https://claude.ai/install.sh | bash',
  );
  assert.equal(setupCommandLine('engine-sign-in:claude-code'), 'claude auth login');
  assert.equal(setupCommandLine('engine-install:codex'), 'npm install -g @openai/codex');
  assert.equal(setupCommandLine('engine-sign-in:codex'), 'codex login');
  assert.equal(
    setupCommandLine('engine-install:antigravity'),
    'curl -fsSL https://antigravity.google/cli/install.sh | bash',
  );
  assert.equal(setupCommandLine('engine-sign-in:antigravity'), 'agy');
  assert.equal(
    setupCommandLine('engine-install:opencode'),
    'curl -fsSL https://opencode.ai/install | bash',
  );
  assert.equal(setupCommandLine('engine-sign-in:opencode'), 'opencode auth login');
});

test('setupCommandLine answers null for anything that is not one of setupCommands()', () => {
  assert.equal(setupCommandLine('rm -rf /'), null);
  assert.equal(setupCommandLine('engine-install:gemini'), null);
  assert.equal(setupCommandLine(''), null);
});

test('parseDeviceCode finds the one-time code, plain and wrapped in ANSI colour codes', () => {
  assert.equal(parseDeviceCode('! First copy your one-time code: 1A2B-3C4D\n'), '1A2B-3C4D');
  assert.equal(
    parseDeviceCode('\u001b[33m! First copy your one-time code: \u001b[1m1a2b-3c4d\u001b[0m\n'),
    '1A2B-3C4D',
  );
  assert.equal(parseDeviceCode('no code here'), null);
});
