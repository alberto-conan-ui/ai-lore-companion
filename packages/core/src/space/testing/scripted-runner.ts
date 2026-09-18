/**
 * A `CommandRunner` that starts no process. A test lists the commands it
 * expects with the result each gives, passes the runner to the code under
 * test, and reads `calls` afterwards to check the argument arrays.
 */

import type { CommandRunner, RunOptions, RunResult } from '../exec/runner.js';

/** One command the code under test asked for. */
export type ScriptedCall = { bin: string; args: readonly string[]; opts: RunOptions };

/** What a rule answers: a result (missing fields default to success), or a function of the call. */
export type ScriptedReply =
  | Partial<RunResult>
  | ((call: ScriptedCall) => Partial<RunResult> | Promise<Partial<RunResult>>);

/** One expected command. */
export type ScriptedRule = {
  bin: string;
  /**
   * An array matches a call whose arguments begin with it; a function decides
   * by itself; when missing, every call of `bin` matches.
   */
  args?: readonly string[] | ((args: readonly string[]) => boolean);
  reply?: ScriptedReply;
  /** How many calls the rule answers before it is used up. Default: no limit. */
  times?: number;
};

/** A scripted runner, with what it was asked. */
export type ScriptedRunner = CommandRunner & {
  /** Every call, in order, including calls that matched no rule. */
  readonly calls: ScriptedCall[];
  /** Add a rule. Rules are tried in the order they were added. Returns the runner. */
  on(rule: ScriptedRule): ScriptedRunner;
};

function matches(rule: ScriptedRule, call: ScriptedCall): boolean {
  if (rule.bin !== call.bin) return false;
  if (rule.args === undefined) return true;
  if (typeof rule.args === 'function') return rule.args(call.args);
  return rule.args.every((arg, index) => call.args[index] === arg);
}

/**
 * Build a scripted runner. A call that matches no rule rejects with an error
 * naming the command, so that a test fails at the command it did not expect.
 */
export function createScriptedRunner(rules: readonly ScriptedRule[] = []): ScriptedRunner {
  const pending = rules.map((rule) => ({ rule, left: rule.times ?? Number.POSITIVE_INFINITY }));
  const calls: ScriptedCall[] = [];
  const runner: ScriptedRunner = {
    calls,
    on(rule: ScriptedRule): ScriptedRunner {
      pending.push({ rule, left: rule.times ?? Number.POSITIVE_INFINITY });
      return runner;
    },
    async run(bin: string, args: readonly string[], opts: RunOptions = {}): Promise<RunResult> {
      const call: ScriptedCall = { bin, args: [...args], opts };
      calls.push(call);
      const entry = pending.find(
        (candidate) => candidate.left > 0 && matches(candidate.rule, call),
      );
      if (entry === undefined) {
        throw new Error(`scripted runner: no rule for ${bin} ${args.join(' ')}`);
      }
      entry.left -= 1;
      const reply = entry.rule.reply;
      const given = typeof reply === 'function' ? await reply(call) : (reply ?? {});
      return { code: 0, stdout: '', stderr: '', ...given };
    },
  };
  return runner;
}
