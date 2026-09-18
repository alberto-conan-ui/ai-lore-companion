/**
 * Running a Python 3 script from a test, as a child process through the real
 * command runner. The check scripts and the skeleton generators of the Lore
 * template are Python; a machine without `python3` fails these tests with a
 * message that says so, and does not skip them.
 */

import { execFileRunner } from '../../src/space/exec/exec-file-runner.js';
import type { RunResult } from '../../src/space/exec/runner.js';
import './temp.js';

/**
 * Run `python3 <script> <args>` with `cwd` as the working folder, which must be
 * under the temporary folder. Returns the exit code and the output; throws
 * only when `python3` is missing or the run was refused.
 */
export async function runPython(
  script: string,
  args: readonly string[],
  opts: { cwd: string; input?: string; env?: Record<string, string> },
): Promise<RunResult> {
  const result = await execFileRunner.run('python3', [script, ...args], {
    cwd: opts.cwd,
    input: opts.input,
    env: opts.env,
    timeoutMs: 60_000,
  });
  if (result.failure === 'not-found') {
    throw new Error('python3 is not on this machine; the tests of the Lore scripts need it');
  }
  if (result.failure === 'refused') {
    throw new Error(`python3 was refused by the live-system guard: ${result.stderr}`);
  }
  return result;
}
