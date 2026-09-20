/**
 * The OpenCode adapter (phase M10.8, `m10-architecture.md` 5 M10.8 item 1).
 * Everything is given through environment variables naming files in the
 * session's folder (decision 5 of section 4): `opencode/AGENTS.md` (the
 * session instructions), `opencode/opencode.json` (the config: the
 * instructions file, the session server and the shell permission rules),
 * `opencode/commands/<name>.md` (one per installed skill, OpenCode's `/<name>`
 * commands) and `opencode/plugins/lore-guard.js` (the guard plugin of
 * `adapters.ts`'s `OPENCODE_GUARD_PLUGIN`, filled in with this session's
 * before-write hook arguments).
 */

import { serializeLoreFrontmatter } from '@ai-lore-companion/core';
import { OPENCODE_GUARD_PLUGIN } from '../adapters.js';
import { hookArgv } from '../command-line.js';
import { PRE_WRITE_TIMEOUTS } from '../constants.js';
import { OPENCODE_OPTIONS } from '../engine-options.js';
import { SESSION_DENY_RULES, sessionAllowRules } from '../permissions.js';
import type { EngineAdapter, LaunchFile, SessionLaunch, SessionLaunchInput } from './types.js';

const CAPABILITY: EngineAdapter['capability'] = {
  lore: {
    aspect: 'lore',
    state: 'yes',
    text: "Reads the Lore's instructions, and its verbs as commands (/<name>).",
  },
  sessionTools: {
    aspect: 'session-tools',
    state: 'yes',
    text: "Has the companion's session tools.",
  },
  guard: {
    aspect: 'guard',
    state: 'partly',
    text: "File edits are checked by the write-guard through a plugin; shell commands follow the session's permission rules, merged with your own OpenCode configuration.",
  },
};

/** `opencode/` inside the session's folder: where every file this adapter writes lives. */
const OPENCODE_DIR = 'opencode';

/** The bash pattern of an allow rule: `Bash(<text>:*)` becomes `<text>*`, `Bash(<text>)` stays `<text>`. */
function bashAllowPattern(rule: string): string {
  const inner = rule.slice('Bash('.length, -1);
  return inner.endsWith(':*') ? `${inner.slice(0, -2)}*` : inner;
}

/** The bash pattern of a deny rule: the text inside `Bash(...)`, its own `*` kept as it is. */
function bashDenyPattern(rule: string): string {
  return rule.slice('Bash('.length, -1);
}

/**
 * OpenCode's `permission` object (5 M10.8 item 1): `edit` always allowed (the
 * guard plugin decides by path), `external_directory` asks, and `bash` is
 * built from the session's own allow and deny rules (`permissions.ts`), with
 * every other command asking. Deny entries are added after allow entries, so
 * that OpenCode's last-match-wins reading agrees with the allow list's own
 * deny-before-allow rule.
 */
function openCodePermission(repositories: readonly string[]): {
  edit: 'allow';
  external_directory: 'ask';
  bash: Record<string, 'allow' | 'ask' | 'deny'>;
} {
  const bash: Record<string, 'allow' | 'ask' | 'deny'> = { '*': 'ask' };
  for (const rule of sessionAllowRules([], repositories)) {
    if (!rule.startsWith('Bash(')) continue;
    bash[bashAllowPattern(rule)] = 'allow';
  }
  for (const rule of SESSION_DENY_RULES) {
    bash[bashDenyPattern(rule)] = 'deny';
  }
  return { edit: 'allow', external_directory: 'ask', bash };
}

/** `opencode/commands/<skill.name>.md`: a command `/<name>` that reads the skill's card. */
function commandFile(skill: SessionLaunchInput['skills'][number]): LaunchFile | null {
  const frontmatter = serializeLoreFrontmatter({ description: skill.description });
  if (!frontmatter.ok) return null;
  return {
    path: `${OPENCODE_DIR}/commands/${skill.name}.md`,
    content: `---\n${frontmatter.value}\n---\n\nRead the card at ${skill.cardPath} and follow it. $ARGUMENTS\n`,
  };
}

export const opencodeAdapter: EngineAdapter = {
  catalogId: 'opencode',
  capability: CAPABILITY,
  options: OPENCODE_OPTIONS,
  modelArgs: (model) => (model === '' ? [] : ['--model', model]),
  modelsSelectedBy: (argv) => {
    const models: string[] = [];
    for (let index = 0; index < argv.length; index += 1) {
      const argument = argv[index] as string;
      if (argument === '--model' && argv[index + 1] !== undefined)
        models.push(argv[index + 1] as string);
      else if (argument.startsWith('--model=')) models.push(argument.slice('--model='.length));
    }
    return models;
  },
  skillInvocation: (name) => `/${name}`,
  verbsAre: 'invoked',
  launch(input: SessionLaunchInput): SessionLaunch {
    const configFile = `${input.paths.dir}/${OPENCODE_DIR}/opencode.json`;
    const configDir = `${input.paths.dir}/${OPENCODE_DIR}`;
    const instructionsFile = `${input.paths.dir}/${OPENCODE_DIR}/AGENTS.md`;

    const permission = openCodePermission(input.repositories);
    const config = {
      $schema: 'https://opencode.ai/config.json',
      instructions: [instructionsFile],
      mcp: {
        [input.connection.serverName]: {
          type: 'remote',
          url: input.connection.url,
          headers: { [input.connection.header.name]: input.connection.header.value },
          enabled: true,
        },
      },
      permission,
    };

    // The plugin runs the before-write adapter with --dialect opencode; the arguments are the
    // python path, the adapter path, the hook's arguments and the checks, as a JSON array the
    // plugin's text spawnSync's directly (adapters.ts, OPENCODE_GUARD_PLUGIN).
    const guardArgv = hookArgv({
      python: input.python,
      adapter: input.paths.preWrite,
      spaceRoot: input.spaceRoot,
      deskDir: input.deskDir,
      sessionId: input.sessionId,
      checks: input.install.beforeChecks,
      childSeconds: PRE_WRITE_TIMEOUTS.childSeconds,
      adapterSeconds: PRE_WRITE_TIMEOUTS.adapterSeconds,
      dialect: 'opencode',
      requestTool: `${input.connection.serverName}_request_writing`,
      refusalsFile: input.paths.refusals,
    });
    const pluginFile: LaunchFile = {
      path: `${OPENCODE_DIR}/plugins/lore-guard.js`,
      content: OPENCODE_GUARD_PLUGIN.replace('__LORE_GUARD_ARGV__', JSON.stringify(guardArgv)),
    };

    const commandFiles = input.skills
      .map((skill) => commandFile(skill))
      .filter((file): file is LaunchFile => file !== null);

    return {
      args: [...input.paramArgv],
      env: {
        OPENCODE_CONFIG: configFile,
        OPENCODE_CONFIG_DIR: configDir,
        OPENCODE_DISABLE_CLAUDE_CODE: '1',
        OPENCODE_PERMISSION: JSON.stringify(permission),
      },
      files: [
        { path: `${OPENCODE_DIR}/AGENTS.md`, content: input.instructions },
        { path: `${OPENCODE_DIR}/opencode.json`, content: `${JSON.stringify(config, null, 2)}\n` },
        ...commandFiles,
        pluginFile,
      ],
    };
  },
};
