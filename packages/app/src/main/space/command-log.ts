/**
 * One log line per `gh` call and per network `git` call (phase M9.6,
 * architecture document A.6).
 *
 * `gh` is asked with a time limit of `GH_CALL_TIMEOUT_MS`
 * (`main/space/github-service.ts`) and `git clone`/`git push` with their own
 * time limits (core's `GIT_CLONE_TIMEOUT_MS`, `GIT_PUSH_TIMEOUT_MS`), so the
 * companion should know when a call is slow before the whole plan's own time
 * limit (`PLAN_TIME_LIMIT_MS`) trips. Output (`stdout`, `stderr`, `input`) is
 * never logged: `SpaceLog` already redacts it by field name, and this module
 * never passes it under another name.
 */

import type { CommandRunner, RunOptions, RunResult } from '@ai-lore-companion/core';
import { graphqlOperationName, runSucceeded } from '@ai-lore-companion/core';
import type { SpaceLog } from './log.js';

/** The `git` subcommands that reach the network, and so are worth their own log line. */
const NETWORK_GIT_SUBCOMMANDS: readonly string[] = ['clone', 'push', 'fetch'];

/** The `outcome` field: `ok`, `failed` (a normal non-zero exit), or the run's own `failure` kind. */
function outcomeOf(result: RunResult): string {
  if (runSucceeded(result)) return 'ok';
  return result.failure ?? 'failed';
}

/**
 * The name of a `gh` call for the log: for `gh api graphql`, the name of the
 * query constant (core's `graphqlOperationName`) or `'graphql'` when it names
 * none; otherwise the first two arguments that are not options.
 */
function ghCallName(args: readonly string[], input: string | undefined): string {
  if (args[0] === 'api' && args[1] === 'graphql') {
    return graphqlOperationName(input ?? '') ?? 'graphql';
  }
  return args
    .filter((arg) => !arg.startsWith('-'))
    .slice(0, 2)
    .join(' ');
}

/**
 * `runner`, with one log line per `gh` call (`which: 'gh'`, every call is
 * logged) or per network `git` call (`which: 'git-network'`, only `clone`,
 * `push` and `fetch`). `log` undefined logs nothing. The time is measured with
 * `performance.now()` and rounded to whole milliseconds.
 */
export function withCommandLog(
  runner: CommandRunner,
  log: SpaceLog | undefined,
  which: 'gh' | 'git-network',
): CommandRunner {
  if (log === undefined) return runner;
  return {
    async run(bin: string, args: readonly string[], opts?: RunOptions): Promise<RunResult> {
      const relevant =
        which === 'gh' || (bin === 'git' && NETWORK_GIT_SUBCOMMANDS.includes(args[0] ?? ''));
      if (!relevant) return runner.run(bin, args, opts);
      const started = performance.now();
      const result = await runner.run(bin, args, opts);
      const ms = Math.round(performance.now() - started);
      const outcome = outcomeOf(result);
      if (which === 'gh') {
        log.info('github-call', {
          name: ghCallName(args, opts?.input),
          ms,
          code: result.code,
          outcome,
        });
      } else {
        log.info('git-network-call', { subcommand: args[0] ?? '', ms, code: result.code, outcome });
      }
      return result;
    },
  };
}
