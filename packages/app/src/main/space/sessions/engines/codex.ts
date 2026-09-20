/**
 * The Codex CLI adapter (phase M10.7, `m10-architecture.md` 5 M10.7 item 1;
 * decision 5 and 6 of section 4). Everything is given on the command line and
 * in the environment: no file is written into the Space or into the
 * session's folder. The sandbox is the Human Lead's ruling (answer 7 of
 * section 1): `--sandbox read-only --ask-for-approval on-request`, so every
 * shell write asks. The before-write hook on `apply_patch` (also matching
 * `Edit` and `Write`) is given inline with `-c hooks.PreToolUse=…`, together
 * with `--dangerously-bypass-hook-trust` so it need not be trusted by hand
 * first.
 */

import { hookArgv, shellCommandLine } from '../command-line.js';
import { POST_WRITE_TIMEOUTS, PRE_WRITE_TIMEOUTS } from '../constants.js';
import { CODEX_OPTIONS } from '../engine-options.js';
import { sessionToolNames } from '../files.js';
import type { EngineAdapter, SessionLaunch, SessionLaunchInput } from './types.js';

// Checked against a real run (M10.9, m10-engine-findings.md, "Codex CLI,
// phase M10.9"): the -c hooks.PreToolUse value fires and blocks a write into
// the Lore (check 3 passed). Check 2, the session-server round trip, could
// not complete end to end in headless `codex exec`: codex's own approval gate
// refuses an MCP tool call in that mode before it reaches the server, so
// whether an interactive session's own approval prompt asks the Human Lead
// for a session-server call, beyond the companion's dialog, is Unverified —
// left as a manual check (this phase's report). `sessionTools` is corrected
// from the "yes" the 3.6 proposal carried to what was observed: the server is
// configured and the model found its tools, but no call was seen completing.
const CAPABILITY: EngineAdapter['capability'] = {
  lore: {
    aspect: 'lore',
    state: 'partly',
    text: "Reads the Lore's instructions; the verbs are listed in them and are not commands.",
  },
  sessionTools: {
    aspect: 'session-tools',
    state: 'partly',
    text: "The session server is configured and its tools are found; a call completing in a real session was not confirmed (codex's own approval gate blocked it in headless testing).",
  },
  guard: {
    aspect: 'guard',
    state: 'partly',
    text: "File edits are checked by the write-guard; shell commands run in Codex's read-only sandbox and ask you before they write; your own Codex configuration still applies.",
  },
};

/** The tool names the before-write and after-write hooks match (item 1). */
const HOOK_MATCHER = '^(apply_patch|Edit|Write)$';

/**
 * A TOML basic string. JSON's escapes are a subset of TOML's, so
 * `JSON.stringify` gives a valid TOML string (`m10-architecture.md` 5 M10.7).
 */
function tomlString(text: string): string {
  return JSON.stringify(text);
}

/** A TOML bare key when `name` holds only letters, digits, `_` or `-`; a quoted key otherwise. */
function tomlKey(name: string): string {
  return /^[A-Za-z0-9_-]+$/.test(name) ? name : JSON.stringify(name);
}

/** The command string of one hook, `--dialect codex`, with the session's before/after checks. */
function hookCommand(
  input: SessionLaunchInput,
  adapter: string,
  checks: readonly string[],
  timeouts: { childSeconds: number; adapterSeconds: number },
  requestTool: string | undefined,
): string {
  return shellCommandLine(
    hookArgv({
      python: input.python,
      adapter,
      spaceRoot: input.spaceRoot,
      deskDir: input.deskDir,
      sessionId: input.sessionId,
      checks,
      childSeconds: timeouts.childSeconds,
      adapterSeconds: timeouts.adapterSeconds,
      dialect: 'codex',
      ...(requestTool !== undefined ? { requestTool } : {}),
      refusalsFile: input.paths.refusals,
    }),
  );
}

/** The `-c hooks.<Event>=…` value: one matcher, one command hook, with its timeout. */
function hooksTomlValue(matcher: string, command: string, timeoutSeconds: number): string {
  return `[{matcher=${tomlString(matcher)},hooks=[{type="command",command=${tomlString(command)},timeout=${timeoutSeconds}}]}]`;
}

export const codexAdapter: EngineAdapter = {
  catalogId: 'codex',
  capability: CAPABILITY,
  options: CODEX_OPTIONS,
  // Verified against the installed Codex CLI: `--model <MODEL>` is its public
  // session selector. Keeping it out of `-c` also avoids mixing user config
  // with the companion's fixed session configuration.
  modelArgs: (model) => (model === '' ? [] : ['--model', model]),
  modelsSelectedBy: (argv) => {
    const models: string[] = [];
    for (let index = 0; index < argv.length; index += 1) {
      const argument = argv[index] as string;
      if (argument === '--model' && argv[index + 1] !== undefined) {
        models.push(argv[index + 1] as string);
        continue;
      }
      if (argument.startsWith('--model=')) {
        models.push(argument.slice('--model='.length));
        continue;
      }
      const value =
        argument === '-c' || argument === '--config'
          ? argv[index + 1]
          : argument.startsWith('-c=') || argument.startsWith('--config=')
            ? argument.slice(argument.indexOf('=') + 1)
            : undefined;
      if (value?.startsWith('model=')) models.push(value.slice('model='.length));
    }
    return models;
  },
  skillInvocation: (name) => `Run the Lore's ${name}: read its card and follow it.`,
  verbsAre: 'listed',
  launch(input: SessionLaunchInput): SessionLaunch {
    const tools = sessionToolNames(input.connection);
    const requestTool = tools.find((tool) => tool.endsWith('__request_writing'));
    const preWrite = hookCommand(
      input,
      input.paths.preWrite,
      input.install.beforeChecks,
      PRE_WRITE_TIMEOUTS,
      requestTool,
    );
    const postWrite = hookCommand(
      input,
      input.paths.postWrite,
      input.install.afterChecks,
      POST_WRITE_TIMEOUTS,
      undefined,
    );
    const serverName = input.connection.serverName;
    const args = [
      ...input.paramArgv,
      '--sandbox',
      'read-only',
      '--ask-for-approval',
      'on-request',
      '--dangerously-bypass-hook-trust',
      '-c',
      `developer_instructions=${tomlString(input.instructions)}`,
      '-c',
      `mcp_servers.${serverName}.url=${tomlString(input.connection.url)}`,
      '-c',
      `mcp_servers.${serverName}.env_http_headers={${tomlKey(input.connection.header.name)}="AI_LORE_MCP_HEADER"}`,
      '-c',
      `mcp_servers.${serverName}.tool_timeout_sec=120`,
      '-c',
      `hooks.PreToolUse=${hooksTomlValue(HOOK_MATCHER, preWrite, PRE_WRITE_TIMEOUTS.hookSeconds)}`,
      '-c',
      `hooks.PostToolUse=${hooksTomlValue(HOOK_MATCHER, postWrite, POST_WRITE_TIMEOUTS.hookSeconds)}`,
    ];
    return {
      args,
      // The bearer token is never an argument (ps would show it): the MCP server reads it
      // from this environment variable, named on the command line.
      env: { AI_LORE_MCP_HEADER: input.connection.header.value },
      files: [],
    };
  },
};
