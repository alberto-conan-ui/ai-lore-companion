/**
 * Whether an engine is signed in. This is the one place that knows how each
 * engine is asked. Phase M9.3 widened it from Claude Code alone to every
 * engine of the catalog, dispatching on the catalog entry's `signInCheck`.
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

import type { EngineEntry } from '../../engines/index.js';
import { CLAUDE_BINARY_NAME, catalogEntryFor, isClaudeEngine } from '../engines/catalog.js';
import type { EngineSignInState, ProbeRun } from './types.js';

/**
 * `CLAUDE_BINARY_NAME` and `isClaudeEngine` are defined in `../engines/catalog.js`
 * (the catalog's own `canRunGuardedSession` needs them) and re-exported here so
 * that this file's existing readers, and `machine/index.ts`, keep working.
 */
export { CLAUDE_BINARY_NAME, isClaudeEngine };

/** The arguments that ask Claude Code for its authentication status as JSON. */
export const CLAUDE_AUTH_STATUS_ARGS: readonly string[] = ['auth', 'status', '--json'];

/** The literal command that signs Claude Code in. */
export const CLAUDE_SIGN_IN_COMMAND = 'claude auth login';

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

/** Ask Claude Code with `claude auth status --json` and read `loggedIn`. */
async function probeClaudeAuthStatus(
  engine: EngineEntry,
  run: ProbeRun,
): Promise<EngineSignInState> {
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

/**
 * Ask an engine by running it with `args` and reading its exit code: `0` is
 * signed in, any other code with no `failure` is not signed in, and a
 * `failure` is undetermined with the reason.
 */
async function probeExitCode(
  engine: EngineEntry,
  run: ProbeRun,
  args: readonly string[],
): Promise<EngineSignInState> {
  const result = await run(engine.binary, args);
  const command = `${engine.binary} ${args.join(' ')}`;
  if (result.failure === 'timeout') {
    return { kind: 'undetermined', reason: `\`${command}\` did not answer in time.` };
  }
  if (result.failure !== undefined) {
    return { kind: 'undetermined', reason: `\`${command}\` could not be run (${result.failure}).` };
  }
  return result.code === 0 ? { kind: 'signed-in' } : { kind: 'not-signed-in' };
}

/** ANSI escape sequences, as they appear in a terminal-formatted CLI answer. Built at runtime (not a regex literal) so the escape character is not written into the source. */
const ANSI_ESCAPE = String.fromCharCode(27);
const ANSI_SEQUENCE = new RegExp(`${ANSI_ESCAPE}\\[[0-9;?]*[A-Za-z]`, 'g');

/** A line that opens with a bullet, as OpenCode lists a signed-in provider. */
const OPENCODE_BULLET_LINE = /^\s*[●•]\s+\S/m;

/** The count `opencode auth list` gives ("N credentials"), case-insensitive. */
const OPENCODE_CREDENTIALS_COUNT = /(\d+)\s+credentials?\b/i;

/**
 * Read `opencode auth list`'s answer (ANSI sequences already removed by the
 * caller is not required; this function removes them itself): `true` when a
 * credentials count above 0 is found, `false` when the count is 0, `true`
 * when no count is found but a bulleted provider line is, otherwise `null`
 * (the answer was not understood).
 */
export function parseOpencodeAuthList(stdout: string): boolean | null {
  const text = stdout.replace(ANSI_SEQUENCE, '');
  const counted = OPENCODE_CREDENTIALS_COUNT.exec(text);
  if (counted !== null) return Number(counted[1]) > 0;
  if (OPENCODE_BULLET_LINE.test(text)) return true;
  return null;
}

/** Ask OpenCode with `opencode auth list`. */
async function probeOpencodeAuthList(
  engine: EngineEntry,
  run: ProbeRun,
): Promise<EngineSignInState> {
  const result = await run(engine.binary, ['auth', 'list']);
  const command = `${engine.binary} auth list`;
  if (result.failure === 'timeout') {
    return { kind: 'undetermined', reason: `\`${command}\` did not answer in time.` };
  }
  if (result.failure !== undefined) {
    return { kind: 'undetermined', reason: `\`${command}\` could not be run (${result.failure}).` };
  }
  const parsed = parseOpencodeAuthList(`${result.stdout}\n${result.stderr}`);
  if (parsed === true) return { kind: 'signed-in' };
  if (parsed === false) return { kind: 'not-signed-in' };
  return {
    kind: 'undetermined',
    reason: '`opencode auth list` gave an answer that was not understood.',
  };
}

/**
 * Find whether `engine` is signed in, by the catalog entry it was merged
 * into. A hand-added Claude Code (kept with other arguments) is asked the
 * same way as the catalog's Claude Code. An engine that is neither in the
 * catalog nor Claude Code, and a catalog engine whose `signInCheck` is
 * `none`, answer `not-checked`: the companion knows no way to ask them.
 */
export async function probeEngineSignIn(
  engine: EngineEntry,
  run: ProbeRun,
): Promise<EngineSignInState> {
  const catalog = catalogEntryFor(engine);
  if (catalog === null) {
    return isClaudeEngine(engine) ? probeClaudeAuthStatus(engine, run) : { kind: 'not-checked' };
  }
  switch (catalog.signInCheck.kind) {
    case 'claude-auth-status':
      return probeClaudeAuthStatus(engine, run);
    case 'exit-code':
      return probeExitCode(engine, run, catalog.signInCheck.args);
    case 'opencode-auth-list':
      return probeOpencodeAuthList(engine, run);
    case 'none':
      return { kind: 'not-checked' };
  }
}
