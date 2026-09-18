/**
 * The app's typecheck: `npm run typecheck -w @ai-lore-companion/app`.
 *
 * `tsconfig.json` is a solution file (`files: []` with two references), so
 * `tsc --noEmit` on it checks no file. This script checks the two projects
 * themselves:
 *
 * - `tsconfig.node.json` (main, preload, shared, this folder) must have no error.
 * - `tsconfig.web.json` (renderer, shared) had errors in v0.8 components when
 *   the check was repaired on 2026-09-18. They are recorded in
 *   `typecheck-baseline.json`, as a count per file, error code and message,
 *   with no line number, so that an edit elsewhere in a file does not move them.
 *   The check fails when an error is not in the baseline or occurs more often
 *   than the baseline says. An error that was fixed is reported, and the
 *   baseline is then lowered with `npm run typecheck -w @ai-lore-companion/app -- --update`.
 *   `--update` refuses to record an error that is new.
 *
 * It writes nothing unless `--update` is given. `--print` prints the baseline
 * that matches the current state and changes nothing.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_FILE = join(APP_DIR, 'typecheck-baseline.json');
const STRICT_PROJECT = 'tsconfig.node.json';
const BASELINED_PROJECT = 'tsconfig.web.json';
const MAX_MESSAGE_LENGTH = 160;

type Baseline = {
  note: string;
  project: string;
  total: number;
  errors: Record<string, number>;
};

type TscRun = { status: number; errors: string[]; output: string };

/** `file(line,col): error TS1234: message` */
const ERROR_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

function runTsc(project: string): TscRun {
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  const run = spawnSync(process.execPath, [tsc, '-p', project, '--noEmit', '--pretty', 'false'], {
    cwd: APP_DIR,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const errors: string[] = [];
  for (const line of output.split('\n')) {
    const match = ERROR_LINE.exec(line.trimEnd());
    if (!match) continue;
    const [, file = '', , , code = '', message = ''] = match;
    errors.push(`${file.replaceAll('\\', '/')}: ${code}: ${message.slice(0, MAX_MESSAGE_LENGTH)}`);
  }
  return { status: run.status ?? 1, errors, output };
}

function countByKey(keys: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of [...keys].sort()) counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}

function readBaseline(): Baseline {
  const parsed: unknown = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || !('errors' in parsed)) {
    throw new Error(`${BASELINE_FILE} has no "errors" object`);
  }
  const errors: Record<string, number> = {};
  for (const [key, count] of Object.entries((parsed as { errors: object }).errors)) {
    if (typeof count === 'number') errors[key] = count;
  }
  const note = 'note' in parsed && typeof parsed.note === 'string' ? parsed.note : '';
  const total = Object.values(errors).reduce((sum, count) => sum + count, 0);
  return { note, project: BASELINED_PROJECT, total, errors };
}

function main(): number {
  const mode = process.argv.includes('--update')
    ? 'update'
    : process.argv.includes('--print')
      ? 'print'
      : 'check';

  const strict = runTsc(STRICT_PROJECT);
  if (strict.status !== 0) {
    console.error(strict.output);
    console.error(`typecheck: ${STRICT_PROJECT} failed (main, preload, shared).`);
    return 1;
  }
  console.log(`typecheck: ${STRICT_PROJECT} has no error.`);

  const web = runTsc(BASELINED_PROJECT);
  if (web.status !== 0 && web.errors.length === 0) {
    // tsc failed without a line this script can read: a bad option, a missing file.
    console.error(web.output);
    console.error(`typecheck: ${BASELINED_PROJECT} failed and reported no error line.`);
    return 1;
  }
  const current = countByKey(web.errors);
  const baseline = readBaseline();

  const grown: string[] = [];
  const fixed: string[] = [];
  for (const [key, count] of Object.entries(current)) {
    const allowed = baseline.errors[key] ?? 0;
    if (count > allowed) grown.push(`  ${key}  (now ${count}, baseline ${allowed})`);
  }
  for (const [key, allowed] of Object.entries(baseline.errors)) {
    const count = current[key] ?? 0;
    if (count < allowed) fixed.push(`  ${key}  (now ${count}, baseline ${allowed})`);
  }

  if (mode === 'print') {
    const next: Baseline = { ...baseline, total: web.errors.length, errors: current };
    console.log(JSON.stringify(next, null, 2));
    return 0;
  }

  if (grown.length > 0) {
    console.error(
      `typecheck: ${BASELINED_PROJECT} has errors that are not in typecheck-baseline.json:`,
    );
    console.error(grown.join('\n'));
    console.error('\nThe lines tsc reported:\n');
    console.error(web.output);
    console.error('Fix them. The baseline only holds errors that existed before 2026-09-18.');
    return 1;
  }

  if (mode === 'update') {
    const next: Baseline = { ...baseline, total: web.errors.length, errors: current };
    writeFileSync(BASELINE_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    console.log(`typecheck: baseline lowered to ${web.errors.length} errors.`);
    return 0;
  }

  console.log(
    `typecheck: ${BASELINED_PROJECT} has ${web.errors.length} errors, all in the baseline of ${baseline.total}.`,
  );
  if (fixed.length > 0) {
    console.log('Fixed since the baseline was written; lower it with `-- --update`:');
    console.log(fixed.join('\n'));
  }
  return 0;
}

process.exit(main());
