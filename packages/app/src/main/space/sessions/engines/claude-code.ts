/**
 * The Claude Code adapter (phase M10.5): what a guarded session was given
 * before this phase, unchanged, plus the session instructions of section 3.3
 * through `--append-system-prompt` (the Human Lead's answer 8 of section 1).
 */

import { engineArgv } from '../command-line.js';
import { SESSION_FILES } from '../constants.js';
import { CLAUDE_CODE_OPTIONS } from '../engine-options.js';
import { buildSessionMcpConfig, buildSessionSettings, sessionToolNames } from '../files.js';
import type { EngineAdapter, SessionLaunch, SessionLaunchInput } from './types.js';

const CAPABILITY: EngineAdapter['capability'] = {
  lore: {
    aspect: 'lore',
    state: 'yes',
    text: "Reads the Lore's instructions, and its verbs as skills (/lore:<name>).",
  },
  sessionTools: {
    aspect: 'session-tools',
    state: 'yes',
    text: "Has the companion's session tools.",
  },
  guard: {
    aspect: 'guard',
    state: 'yes',
    text: "File edits are checked by the write-guard; shell commands follow the session's permission rules.",
  },
};

export const claudeCodeAdapter: EngineAdapter = {
  catalogId: 'claude-code',
  capability: CAPABILITY,
  options: CLAUDE_CODE_OPTIONS,
  skillInvocation: (name) => `/lore:${name}`,
  verbsAre: 'invoked',
  launch(input: SessionLaunchInput): SessionLaunch {
    const settings = buildSessionSettings(
      {
        sessionId: input.sessionId,
        spaceRoot: input.spaceRoot,
        deskDir: input.deskDir,
        python: input.python,
        beforeChecks: input.install.beforeChecks,
        afterChecks: input.install.afterChecks,
        repositories: input.repositories,
        connection: input.connection,
      },
      input.paths,
    );
    const mcp = buildSessionMcpConfig(input.connection);
    return {
      args: engineArgv({
        engineArgs: [...input.paramArgv],
        settingsFile: input.paths.settings,
        mcpFile: input.paths.mcp,
        pluginDir: input.install.pluginDir,
        tools: sessionToolNames(input.connection),
        appendSystemPrompt: input.instructions,
      }),
      env: {},
      files: [
        { path: SESSION_FILES.settings, content: `${JSON.stringify(settings, null, 2)}\n` },
        { path: SESSION_FILES.mcp, content: `${JSON.stringify(mcp, null, 2)}\n` },
      ],
    };
  },
};
