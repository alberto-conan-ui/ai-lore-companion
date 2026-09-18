/**
 * What the local steps of the migration share: the ledger record each step
 * appends last, the failure sentence of a step that stopped, and a write of
 * bytes that never leaves part of a file.
 */

import { readdir, rename, rm, writeFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { atomicTempPathFor, isAtomicTempName } from '../../fs/atomic-write.js';
import { type Result, errorMessage, fail, ok } from '../../result.js';
import type { StepError } from '../../steps/types.js';
import type { MigrationContext } from '../context.js';
import { appendMigrationLedger, ledgerHasStep } from '../ledger.js';
import type { MigrationStepId } from '../types.js';

/**
 * Append the step's `step-done` record to the ledger, once. Each local step
 * calls this last, after everything its `isDone` asks for is in place.
 */
export function recordStepDone(
  ctx: MigrationContext,
  stepId: MigrationStepId,
  created: string[],
): Result<void, StepError> {
  if (ledgerHasStep(ctx, stepId)) return ok(undefined);
  const appended = appendMigrationLedger(ctx, { kind: 'step-done', stepId, created });
  return appended.ok ? ok(undefined) : appended;
}

/** The failure of a local step: which step stopped and why, and that running again continues. */
export function stepStopped(
  kind: string,
  title: string,
  reason: string,
): { ok: false; error: StepError } {
  const cause = reason.trim().replace(/[.!?]$/, '');
  return fail(
    kind,
    `The step "${title}" stopped: ${cause}. What was done stays in place, and running the migration again continues from here.`,
  );
}

/** Write `bytes` to `path` beside it first and rename over it, so no part of a file is ever left. */
export async function writeBytesAtomic(
  path: string,
  bytes: Buffer,
  mode?: number,
): Promise<Result<void, StepError>> {
  const temp = atomicTempPathFor(path);
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temp, bytes, mode === undefined ? {} : { mode });
    await rename(temp, path);
    return ok(undefined);
  } catch (caught) {
    await rm(temp, { force: true }).catch(() => undefined);
    return fail('write-failed', `${path} could not be written: ${errorMessage(caught)}`);
  }
}

/** Remove what an interrupted copy or write left under `dir`: the temporary files of atomic writes. */
export async function removeLeftoverTemps(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await removeLeftoverTemps(path);
    else if (isAtomicTempName(entry.name)) await rm(path, { force: true });
  }
}
