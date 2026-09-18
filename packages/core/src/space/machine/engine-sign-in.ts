/**
 * Whether an engine is signed in. This is the one place that knows how each
 * engine is asked.
 *
 * How Claude Code is asked is a known unknown that phase M4.1 investigates
 * with the real engine. What phase M3.2 found, reading `claude --help` and
 * `claude auth status --help` of Claude Code 2.1.276 on 2026-09-18:
 * `claude auth status` is a documented command that shows the authentication
 * status, prints JSON by default, and on a signed-in machine exits 0 with an
 * object whose `loggedIn` field is `true`. It starts no session and changes no
 * configuration. What was not observed: the output and the exit code on a
 * machine that is not signed in, the first release that has the command, and
 * what `loggedIn` says when the engine is set up with an API key or another
 * provider. The probe therefore trusts only a boolean `loggedIn` and answers
 * `undetermined` for anything else.
 */

import { basename } from 'node:path';
import type { EngineEntry } from '../../engines/index.js';
import type { EngineSignInState, ProbeRun } from './types.js';

/** The command name of Claude Code, the one engine of the MVP. */
export const CLAUDE_BINARY_NAME = 'claude';

/** The arguments that ask Claude Code for its authentication status as JSON. */
export const CLAUDE_AUTH_STATUS_ARGS: readonly string[] = ['auth', 'status', '--json'];

/** The literal command that signs Claude Code in. */
export const CLAUDE_SIGN_IN_COMMAND = 'claude auth login';

/** Whether the registry entry is Claude Code, judged by the file name of its binary. */
export function isClaudeEngine(engine: EngineEntry): boolean {
  const name = basename(engine.binary).toLowerCase();
  return name === CLAUDE_BINARY_NAME || name === `${CLAUDE_BINARY_NAME}.exe`;
}

/** The `loggedIn` field of the JSON Claude Code prints, or `null` when the text does not hold one. */
export function parseClaudeAuthStatus(stdout: string): boolean | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const loggedIn = (parsed as { loggedIn?: unknown }).loggedIn;
  return typeof loggedIn === 'boolean' ? loggedIn : null;
}

/**
 * Find whether `engine` is signed in. For Claude Code it runs
 * `claude auth status --json` and reads `loggedIn`. For any other engine it
 * answers `undetermined`, because the MVP knows no other engine's command.
 */
export async function probeEngineSignIn(
  engine: EngineEntry,
  run: ProbeRun,
): Promise<EngineSignInState> {
  if (!isClaudeEngine(engine)) {
    return {
      kind: 'undetermined',
      reason: `The companion does not know how to ask ${engine.name} whether it is signed in.`,
    };
  }
  const result = await run(engine.binary, CLAUDE_AUTH_STATUS_ARGS);
  const loggedIn = parseClaudeAuthStatus(result.stdout);
  if (loggedIn === true) return { kind: 'signed-in' };
  if (loggedIn === false) return { kind: 'not-signed-in' };
  const command = `${CLAUDE_BINARY_NAME} ${CLAUDE_AUTH_STATUS_ARGS.join(' ')}`;
  if (result.failure === 'timeout') {
    return { kind: 'undetermined', reason: `\`${command}\` did not answer in time.` };
  }
  if (result.failure !== undefined) {
    return { kind: 'undetermined', reason: `\`${command}\` could not be run (${result.failure}).` };
  }
  return {
    kind: 'undetermined',
    reason: `\`${command}\` exited with code ${result.code} and did not say whether an account is signed in. This version of Claude Code may not have the command.`,
  };
}
