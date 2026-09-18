/**
 * The migration's ledger, `desk/migration.json` in the desk of the new Space
 * (section 5.9). It records each completed step with what it made, step 1's
 * record of the source repositories, and each issue step 11 created, so that a
 * run that was stopped asks GitHub less. It is consulted first by the GitHub
 * steps; when it is lost, the markers on GitHub still prevent duplicates, and
 * the local steps ask the disk.
 *
 * Kept through the desk's store, like every other record of the desk. Reading
 * uses a desk that does not write, so the plan writes nothing.
 */

import type { Desk } from '../desk/desk.js';
import { isIssueRef, isJsonObject } from '../desk/guards.js';
import { closeDesk, openDesk } from '../desk/open.js';
import { currentDeskInstance } from '../desk/owner.js';
import { type DeskRecordFile, appendDeskRecord, readDeskRecords } from '../desk/store.js';
import { deskPaths } from '../layout/desk-paths.js';
import { type Result, fail, ok } from '../result.js';
import type { StepError } from '../steps/types.js';
import type { MigrationContext } from './context.js';
import {
  MIGRATION_STEP_IDS,
  type MigrationLedgerRecord,
  type MigrationRepositoryState,
  type MigrationStepId,
} from './types.js';

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

function isRepositoryState(value: unknown): value is MigrationRepositoryState {
  return (
    isJsonObject(value) &&
    isText(value.path) &&
    (value.head === null || isText(value.head)) &&
    isText(value.statusText)
  );
}

function isStepId(value: unknown): value is MigrationStepId {
  return MIGRATION_STEP_IDS.some((id) => id === value);
}

/** Whether `value` is a record of the ledger this build understands. */
export function isMigrationLedgerRecord(value: unknown): value is MigrationLedgerRecord {
  if (!isJsonObject(value) || !isText(value.source) || !isText(value.at)) return false;
  switch (value.kind) {
    case 'source-state':
      return isRepositoryState(value.payload) && isRepositoryState(value.lore);
    case 'step-done':
      return isStepId(value.stepId) && Array.isArray(value.created) && value.created.every(isText);
    case 'issue':
      return isText(value.key) && isIssueRef(value.issue);
    default:
      return false;
  }
}

/** The ledger's record file. */
export const MIGRATION_LEDGER_FILE: DeskRecordFile<MigrationLedgerRecord> = {
  name: 'migration',
  guard: isMigrationLedgerRecord,
};

/** A desk handle that reads only: no owner file is written and nothing is set aside. */
function readingDesk(userDataDir: string, spaceRoot: string): Desk {
  const instance = currentDeskInstance();
  return {
    paths: deskPaths(userDataDir, spaceRoot),
    writable: false,
    instance,
    owner: { ...instance, openedAt: new Date(0).toISOString() },
    now: () => new Date(),
    notices: [],
  };
}

/**
 * The ledger's records for the migration of `source` into the Space at
 * `spaceRoot`, oldest first. A missing ledger is an empty list; a ledger that
 * cannot be read is an empty list too, since the steps then ask the real state.
 * Writes nothing.
 */
export function readMigrationLedger(
  userDataDir: string,
  spaceRoot: string,
  source: string,
): MigrationLedgerRecord[] {
  const records = readDeskRecords(readingDesk(userDataDir, spaceRoot), MIGRATION_LEDGER_FILE);
  return records.ok ? records.value.filter((record) => record.source === source) : [];
}

/** Whether the ledger in `ctx` records `stepId` as done. */
export function ledgerHasStep(ctx: MigrationContext, stepId: MigrationStepId): boolean {
  return ctx.ledger.some((record) => record.kind === 'step-done' && record.stepId === stepId);
}

/** The records of one kind in the ledger of `ctx`. */
export function ledgerRecords<K extends MigrationLedgerRecord['kind']>(
  ctx: MigrationContext,
  kind: K,
): Extract<MigrationLedgerRecord, { kind: K }>[] {
  return ctx.ledger.filter(
    (record): record is Extract<MigrationLedgerRecord, { kind: K }> => record.kind === kind,
  );
}

/** A record of the ledger before the source and the time are filled in. */
export type MigrationLedgerEntry =
  | Omit<Extract<MigrationLedgerRecord, { kind: 'source-state' }>, 'source' | 'at'>
  | Omit<Extract<MigrationLedgerRecord, { kind: 'step-done' }>, 'source' | 'at'>
  | Omit<Extract<MigrationLedgerRecord, { kind: 'issue' }>, 'source' | 'at'>;

/**
 * Append `entry` to the ledger of the Space in `ctx`, and to `ctx.ledger`.
 * Opens the desk for the write and closes it after. Fails with `desk-held`
 * when another running companion holds the desk.
 */
export function appendMigrationLedger(
  ctx: MigrationContext,
  entry: MigrationLedgerEntry,
): Result<MigrationLedgerRecord, StepError> {
  const at = (ctx.deps.now ?? (() => new Date()))().toISOString();
  const record: MigrationLedgerRecord = { ...entry, source: ctx.source.root, at };
  const desk = openDesk(deskPaths(ctx.deps.userDataDir, ctx.spaceRoot));
  if (!desk.ok) return desk;
  try {
    if (!desk.value.writable) {
      return fail(
        'desk-held',
        "Another running companion holds the desk of this Space, so the migration's ledger was not written. Close it and run the migration again.",
      );
    }
    const appended = appendDeskRecord(desk.value, MIGRATION_LEDGER_FILE, record);
    if (!appended.ok) return appended;
    ctx.ledger.push(appended.value);
    return ok(appended.value);
  } finally {
    closeDesk(desk.value);
  }
}
