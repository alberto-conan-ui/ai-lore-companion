/**
 * The Antigravity CLI adapter (phase M10.6, `m10-architecture.md` section 5,
 * M10.6). `launch` gives the engine a second `--add-dir` for the session's
 * folder, which holds the Lore's plugin (`.agents/plugins/lore/`): its rule
 * (the session instructions), its skills, its MCP configuration, and a
 * `hooks.json` that runs the before-write and after-write adapters with
 * `--dialect antigravity`. The before-write hook also gets a `--shell-rules`
 * argument naming `shell-rules.json`, the allow and deny rules the adapter's
 * `shell_command_antigravity` decision judges a `run_command` call by
 * (`packages/app/src/main/space/sessions/adapters.ts`).
 */

import { join } from 'node:path';
import { hookArgv, shellCommandLine } from '../command-line.js';
import { POST_WRITE_TIMEOUTS, PRE_WRITE_TIMEOUTS } from '../constants.js';
import { ANTIGRAVITY_OPTIONS } from '../engine-options.js';
import { sessionToolNames } from '../files.js';
import { SESSION_DENY_RULES, sessionAllowRules } from '../permissions.js';
import type { EngineAdapter, LaunchFile, SessionLaunch, SessionLaunchInput } from './types.js';

// Confirmed by a real run (M10.9, m10-engine-findings.md, "Antigravity CLI,
// phase M10.9"): the write-guard hook still refuses a write with
// --dangerously-skip-permissions on, the after-write hook still cannot report
// a failure to the session, and the `PostToolUse` input matches the shape
// this file assumed. The text is unchanged from the proposal of 3.6.
const CAPABILITY: EngineAdapter['capability'] = {
  lore: {
    aspect: 'lore',
    state: 'yes',
    text: "Reads the Lore's instructions as a rule, and its verbs as skills.",
  },
  sessionTools: {
    aspect: 'session-tools',
    state: 'yes',
    text: "Has the companion's session tools.",
  },
  guard: {
    aspect: 'guard',
    state: 'partly',
    text: 'File edits are checked by the write-guard; shell commands are checked by their text, your own Antigravity permissions still apply, and a failed Lore check after a write is not reported to the session.',
  },
};

/** The engine's own file-writing tools (`m10-architecture.md` 2.3, 5 M10.6). */
const AGY_FILE_TOOLS = [
  'write_to_file',
  'replace_file_content',
  'multi_replace_file_content',
  'edit_notebook',
  'create_file',
  'edit_file',
  'delete_file',
  'move_file',
] as const;

const AGY_POST_WRITE_MATCHER = AGY_FILE_TOOLS.join('|');

/** `.agents/plugins/lore/` inside the session's folder: the plugin Antigravity is given with `--add-dir`. */
const PLUGIN_DIR = '.agents/plugins/lore';

export const antigravityAdapter: EngineAdapter = {
  catalogId: 'antigravity',
  capability: CAPABILITY,
  options: ANTIGRAVITY_OPTIONS,
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
    const shared = {
      python: input.python,
      spaceRoot: input.spaceRoot,
      deskDir: input.deskDir,
      sessionId: input.sessionId,
    };
    const tools = sessionToolNames(input.connection);
    const requestTool = tools.find((tool) => tool.endsWith('__request_writing'));
    const shellRulesPath = join(input.paths.dir, 'shell-rules.json');

    // Human Lead's ruling of 2026-09-19 (m10-architecture.md 2.3, M10.6): with
    // --dangerously-skip-permissions ticked, a shell command the rules would only
    // ask about must be denied, not run. --uncovered-shell deny tells
    // decide_antigravity_shell to deny in place of force_ask; without the flag
    // ticked the hook is not given --uncovered-shell, and the default is ask.
    const skipsPermissions = input.paramArgv.some(
      (argument) =>
        argument === '--dangerously-skip-permissions' ||
        argument.startsWith('--dangerously-skip-permissions='),
    );

    const preWriteArgv = [
      ...hookArgv({
        ...shared,
        adapter: input.paths.preWrite,
        checks: input.install.beforeChecks,
        childSeconds: PRE_WRITE_TIMEOUTS.childSeconds,
        adapterSeconds: PRE_WRITE_TIMEOUTS.adapterSeconds,
        dialect: 'antigravity',
        ...(requestTool !== undefined ? { requestTool } : {}),
        refusalsFile: input.paths.refusals,
      }),
      '--shell-rules',
      shellRulesPath,
      ...(skipsPermissions ? ['--uncovered-shell', 'deny'] : []),
    ];
    const postWriteArgv = hookArgv({
      ...shared,
      adapter: input.paths.postWrite,
      checks: input.install.afterChecks,
      childSeconds: POST_WRITE_TIMEOUTS.childSeconds,
      adapterSeconds: POST_WRITE_TIMEOUTS.adapterSeconds,
      dialect: 'antigravity',
      // Not "before-write only" here: the after-write report cannot reach an Antigravity
      // session (PostToolUse must print `{}`), so a lore-integrity failure is noted here
      // instead, with kind `after-write` (adapters.ts, POST_WRITE_ADAPTER's emit_post).
      refusalsFile: input.paths.refusals,
    });

    const pluginJson: LaunchFile = {
      path: `${PLUGIN_DIR}/plugin.json`,
      content: '{"name":"lore"}\n',
    };
    const rulesFile: LaunchFile = {
      path: `${PLUGIN_DIR}/rules/AGENTS.md`,
      content: input.instructions,
    };
    const skillFiles: LaunchFile[] = input.skills.map((skill) => ({
      path: `${PLUGIN_DIR}/skills/${skill.name}/SKILL.md`,
      content: skill.text,
    }));
    const mcpConfig: LaunchFile = {
      path: `${PLUGIN_DIR}/mcp_config.json`,
      content: `${JSON.stringify(
        {
          mcpServers: {
            [input.connection.serverName]: {
              serverUrl: input.connection.url,
              headers: { [input.connection.header.name]: input.connection.header.value },
            },
          },
        },
        null,
        2,
      )}\n`,
    };
    const hooksConfig: LaunchFile = {
      path: `${PLUGIN_DIR}/hooks.json`,
      content: `${JSON.stringify(
        {
          'lore-guard': {
            PreToolUse: [
              {
                matcher: '*',
                hooks: [
                  {
                    type: 'command',
                    command: shellCommandLine(preWriteArgv),
                    timeout: PRE_WRITE_TIMEOUTS.hookSeconds,
                  },
                ],
              },
            ],
            PostToolUse: [
              {
                matcher: AGY_POST_WRITE_MATCHER,
                hooks: [
                  {
                    type: 'command',
                    command: shellCommandLine(postWriteArgv),
                    timeout: POST_WRITE_TIMEOUTS.hookSeconds,
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    };
    const shellRules: LaunchFile = {
      path: 'shell-rules.json',
      content: `${JSON.stringify(
        {
          allow: sessionAllowRules(tools, input.repositories),
          deny: [...SESSION_DENY_RULES],
        },
        null,
        2,
      )}\n`,
    };

    return {
      // A session is started as `agy --add-dir <Space> --add-dir <session folder>` (2.3, runE):
      // the Space first, so a relative path a session writes lands there, and the session
      // folder second, so the plugin in it is loaded. Nothing is written into the Space.
      args: [...input.paramArgv, '--add-dir', input.spaceRoot, '--add-dir', input.paths.dir],
      env: {},
      files: [pluginJson, rulesFile, ...skillFiles, mcpConfig, hooksConfig, shellRules],
    };
  },
};
