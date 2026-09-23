/**
 * The Claude Code adapter (phase M10.5): what a guarded session was given
 * before this phase, unchanged, plus the session instructions of section 3.3
 * through `--append-system-prompt` (the Human Lead's answer 8 of section 1).
 */

import { engineArgv } from '../command-line.js';
import { SESSION_FILES } from '../constants.js';
import { CLAUDE_CODE_OPTIONS } from '../engine-options.js';
import {
  buildSessionMcpConfig,
  buildSessionSettings,
  buildStandardSessionSettings,
  readSessionSpend,
  sessionToolNames,
} from '../files.js';
import type { EngineAdapter, SessionLaunch, SessionLaunchInput } from './types.js';

/**
 * A session of a Space with standard-file Lore (`standard-lore.ts`, ai-lore#144):
 * no write hooks, no `lore` plugin, and the Space's and the Human Lead's own
 * settings apply. The session server, its tools and the spend hook stay.
 */
function launchStandard(input: SessionLaunchInput): SessionLaunch {
  const settings = buildStandardSessionSettings(
    { sessionId: input.sessionId, python: input.python, connection: input.connection },
    input.paths,
  );
  const mcp = buildSessionMcpConfig(input.connection);
  return {
    args: engineArgv({
      engineArgs: [...input.paramArgv],
      settingsFile: input.paths.settings,
      mcpFile: input.paths.mcp,
      pluginDir: null,
      isolateSettings: false,
      tools: sessionToolNames(input.connection),
      appendSystemPrompt: input.instructions,
      ...(input.initialPrompt !== undefined ? { initialPrompt: input.initialPrompt } : {}),
    }),
    env: {},
    files: [
      { path: SESSION_FILES.settings, content: `${JSON.stringify(settings, null, 2)}\n` },
      { path: SESSION_FILES.mcp, content: `${JSON.stringify(mcp, null, 2)}\n` },
    ],
  };
}

// Confirmed by a real run (M10.9 item 3, m10-engine-findings.md, "Claude
// Code, phase M10.9"): the PreToolUse hook's `deny` still blocks a write with
// --dangerously-skip-permissions on, so an unguarded Claude Code session's
// guard line keeps the text 3.6 proposed (no "the write-guard does not run"
// fallback).
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
  supportsInitialPrompt: true,
  options: CLAUDE_CODE_OPTIONS,
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
  skillInvocation: (name) => `/lore:${name}`,
  verbsAre: 'invoked',
  // M14.6: read by a `Stop` hook (`SPEND_ADAPTER`, `adapters.ts`), never by this
  // process. `readSessionSpend` gives `{ source: 'none' }` for anything but a
  // well-formed `spend.json`, and never throws.
  readSpend: (input) => readSessionSpend(input.paths),
  supportsStandardLore: true,
  launch(input: SessionLaunchInput): SessionLaunch {
    if (input.standardLore === true) return launchStandard(input);
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
        ...(input.initialPrompt !== undefined ? { initialPrompt: input.initialPrompt } : {}),
      }),
      env: {},
      files: [
        { path: SESSION_FILES.settings, content: `${JSON.stringify(settings, null, 2)}\n` },
        { path: SESSION_FILES.mcp, content: `${JSON.stringify(mcp, null, 2)}\n` },
      ],
    };
  },
};
