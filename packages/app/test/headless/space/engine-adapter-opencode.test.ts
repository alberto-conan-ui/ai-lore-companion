/**
 * The OpenCode adapter's launch (phase M10.8, `m10-architecture.md` 5 M10.8):
 * the config file, the command files, the permission object, and the guard
 * plugin, run for real against the fixture's check scripts.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  type DeskPaths,
  deskPaths,
  execFileRunner,
  installClaudeCode,
  readLore,
} from '@ai-lore-companion/core';
import { type SpaceFixture, makeSpaceFixture } from '@ai-lore-companion/core/testing';
import type { SessionConnection } from '../../../src/main/space/session-server/index.js';
import { opencodeAdapter } from '../../../src/main/space/sessions/engines/opencode.js';
import type { InstalledSkill } from '../../../src/main/space/sessions/engines/skills.js';
import type { SessionLaunch } from '../../../src/main/space/sessions/engines/types.js';
import {
  type SessionFilePaths,
  sessionFilePaths,
  writeSessionFiles,
} from '../../../src/main/space/sessions/files.js';
import {
  type VerifiedInstall,
  findPython3,
  verifyInstall,
} from '../../../src/main/space/sessions/preflight.js';
import { LORE_TEMPLATE_DIR } from './space-harness.js';

const CONNECTION: SessionConnection = {
  sessionId: 'unused',
  serverName: 'ailore',
  url: 'http://127.0.0.1:4242/mcp/s-opencode',
  header: { name: 'authorization', value: 'Bearer secret-token-for-the-test' },
  tools: ['request_writing', 'request_gate', 'await_answer', 'leave_writing'],
};

const SKILLS: InstalledSkill[] = [
  {
    name: 'session-orient',
    description: 'Open a session.',
    cardPath: '/space/lore/verbs/session-orient.md',
    skillFile: '/install/session-orient/SKILL.md',
    text: '',
  },
];

let space: SpaceFixture;
let base: string;
let paths: DeskPaths;
let python: string;
let install: VerifiedInstall;

before(async () => {
  space = await makeSpaceFixture({
    templateDir: LORE_TEMPLATE_DIR,
    name: 'opencode-space',
    repositories: ['app'],
  });
  base = mkdtempSync(join(tmpdir(), 'm10-8-opencode-'));
  paths = deskPaths(base, space.root);
  mkdirSync(paths.install, { recursive: true });
  mkdirSync(paths.desk, { recursive: true });
  mkdirSync(paths.sessions, { recursive: true });
  const lore = await readLore(space.root);
  assert.ok(lore.ok);
  const installed = await installClaudeCode(lore.value, paths.install);
  assert.ok(installed.ok, installed.ok ? '' : installed.error.message);
  const verified = await verifyInstall(paths.install);
  assert.ok(verified.ok, verified.ok ? '' : verified.error.message);
  install = verified.value;
  const found = await findPython3(execFileRunner, null, space.root);
  assert.ok(found.ok, 'python3 is needed by these tests');
  python = found.value;
});

after(() => {
  space.cleanup();
  rmSync(base, { recursive: true, force: true });
});

function launchFor(
  sessionId: string,
  overrides: { python?: string } = {},
): { launch: SessionLaunch; filePaths: SessionFilePaths } {
  const filePaths = sessionFilePaths(paths.sessions, sessionId);
  const launch = opencodeAdapter.launch({
    sessionId,
    spaceRoot: space.root,
    deskDir: paths.desk,
    paths: filePaths,
    python: overrides.python ?? python,
    install,
    skills: SKILLS,
    connection: { ...CONNECTION, sessionId },
    repositories: ['app'],
    instructions: 'Session instructions, for the test.\n',
    paramArgv: ['--model', 'opus'],
  });
  return { launch, filePaths };
}

test('launch: args are the ticked parameters only, and env names the config files', () => {
  const { launch, filePaths } = launchFor('s-env');
  assert.deepEqual(launch.args, ['--model', 'opus']);
  assert.equal(launch.env.OPENCODE_CONFIG, join(filePaths.dir, 'opencode', 'opencode.json'));
  assert.equal(launch.env.OPENCODE_CONFIG_DIR, join(filePaths.dir, 'opencode'));
  assert.equal(launch.env.OPENCODE_DISABLE_CLAUDE_CODE, '1');
  assert.ok(launch.env.OPENCODE_PERMISSION);
  const envPermission = JSON.parse(launch.env.OPENCODE_PERMISSION ?? '{}') as { edit: string };
  assert.equal(envPermission.edit, 'allow');
});

test('launch: opencode.json names the instructions file, the mcp server, and a bash permission map with * first, an allow rule converted from :*, and deny after allow', () => {
  const { launch } = launchFor('s-config');
  const configFile = launch.files.find((file) => file.path === 'opencode/opencode.json');
  assert.ok(configFile);
  const config = JSON.parse(configFile?.content ?? '{}') as {
    $schema: string;
    instructions: string[];
    mcp: Record<
      string,
      { type: string; url: string; headers: Record<string, string>; enabled: boolean }
    >;
    permission: { edit: string; external_directory: string; bash: Record<string, string> };
  };
  assert.equal(config.instructions.length, 1);
  assert.match(config.instructions[0] ?? '', /opencode\/AGENTS\.md$/);
  assert.deepEqual(config.mcp.ailore, {
    type: 'remote',
    url: CONNECTION.url,
    headers: { authorization: 'Bearer secret-token-for-the-test' },
    enabled: true,
  });
  assert.equal(config.permission.edit, 'allow');
  assert.equal(config.permission.external_directory, 'ask');
  const bashKeys = Object.keys(config.permission.bash);
  assert.equal(bashKeys[0], '*');
  assert.equal(config.permission.bash['*'], 'ask');
  assert.equal(config.permission.bash['git status*'], 'allow');
  assert.equal(config.permission.bash['git -c *'], 'deny');
  const allowIndex = bashKeys.indexOf('git status*');
  const denyIndex = bashKeys.indexOf('git -c *');
  assert.ok(allowIndex >= 0 && denyIndex >= 0 && allowIndex < denyIndex, 'deny comes after allow');
});

test('launch: one command file per installed skill, with its description in frontmatter and its card path in the body', () => {
  const { launch } = launchFor('s-commands');
  const commandFile = launch.files.find(
    (file) => file.path === 'opencode/commands/session-orient.md',
  );
  assert.ok(commandFile);
  assert.match(commandFile?.content ?? '', /^---\ndescription: Open a session\.\n---\n\n/);
  assert.match(
    commandFile?.content ?? '',
    /Read the card at \/space\/lore\/verbs\/session-orient\.md and follow it\. \$ARGUMENTS\n$/,
  );
});

test('launch: the plugin file holds the absolute python and pre-write adapter paths, ending --dialect opencode', () => {
  const { launch, filePaths } = launchFor('s-plugin-argv');
  const pluginFile = launch.files.find((file) => file.path === 'opencode/plugins/lore-guard.js');
  assert.ok(pluginFile);
  assert.match(pluginFile?.content ?? '', /export const LoreGuard/);
  const match = /const HOOK_ARGV = (\[.*\]);/.exec(pluginFile?.content ?? '');
  assert.ok(match);
  const argv = JSON.parse(match?.[1] ?? '[]') as string[];
  assert.equal(argv[0], python);
  assert.equal(argv[1], filePaths.preWrite);
  const dialectIndex = argv.indexOf('--dialect');
  assert.ok(dialectIndex >= 0);
  assert.equal(argv[dialectIndex + 1], 'opencode');
});

type GuardHooks = {
  'tool.execute.before': (
    input: { tool: string },
    output: { args: Record<string, unknown> },
  ) => Promise<void>;
};
type GuardPluginModule = { LoreGuard: (context: { directory: string }) => Promise<GuardHooks> };

/** Copy the plugin's written text to a `.mjs` file so Node's ESM loader accepts its `export`. */
async function importPlugin(content: string): Promise<GuardPluginModule> {
  const dir = mkdtempSync(join(tmpdir(), 'm10-8-plugin-'));
  const file = join(dir, 'lore-guard.mjs');
  writeFileSync(file, content, 'utf8');
  return (await import(pathToFileURL(file).href)) as GuardPluginModule;
}

test('the plugin refuses a write into lore/ with the write-guard sentence, and allows one into workbench/', async () => {
  const sessionId = 's-plugin-run';
  const { launch } = launchFor(sessionId);
  await writeSessionFiles(paths.sessions, { sessionId }, launch);
  const pluginFile = launch.files.find((file) => file.path === 'opencode/plugins/lore-guard.js');
  assert.ok(pluginFile);
  const mod = await importPlugin(pluginFile?.content ?? '');
  const hooks = await mod.LoreGuard({ directory: space.root });
  const hook = hooks['tool.execute.before'];

  await assert.rejects(
    hook({ tool: 'write' }, { args: { filePath: join(space.root, 'lore', 'x.md') } }),
    /Read only/,
  );
  await assert.doesNotReject(
    hook(
      { tool: 'write' },
      { args: { filePath: join(space.root, 'workbench', 'scratch', 'a.md') } },
    ),
  );
});

test('the plugin throws the fault sentence when the python path does not exist', async () => {
  const sessionId = 's-plugin-nopython';
  const { launch } = launchFor(sessionId, { python: '/nonexistent/python3-for-the-test' });
  await writeSessionFiles(paths.sessions, { sessionId }, launch);
  const pluginFile = launch.files.find((file) => file.path === 'opencode/plugins/lore-guard.js');
  assert.ok(pluginFile);
  const mod = await importPlugin(pluginFile?.content ?? '');
  const hooks = await mod.LoreGuard({ directory: space.root });

  await assert.rejects(
    hooks['tool.execute.before'](
      { tool: 'write' },
      { args: { filePath: join(space.root, 'workbench', 'a.md') } },
    ),
    /before-write check could not be made/,
  );
});
