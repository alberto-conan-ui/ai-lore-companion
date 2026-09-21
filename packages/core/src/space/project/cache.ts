/**
 * The cache of the Space's GitHub Project: `project-cache.json` on the desk
 * (architecture document, section 5.11). Phase M7.1.
 *
 * The file is a record file of the desk's store (`../desk/store.ts`), so it is
 * written atomically, carries `version`, keeps the fields and entries this
 * build does not know, and a file that cannot be parsed is set aside and
 * reported as a notice on the desk. It holds one record: the last snapshot
 * read, and the last refresh that failed, with its time.
 *
 * A refresh that fails keeps the snapshot as it was and records the failure;
 * a refresh that succeeds replaces the snapshot and clears the failure.
 */

import { isIssueRef, isJsonObject, isWriteTarget, toPlainJson } from '../desk/guards.js';
import type { Desk, DeskFailure } from '../desk/index.js';
import { type DeskRecordFile, readDeskRecords, updateDeskRecords } from '../desk/store.js';
import type { JsonObject, JsonValue } from '../desk/types.js';
import type { GitHubErrorKind } from '../github/errors.js';
import {
  AGENTS_COLUMNS,
  type FieldOption,
  type FocusItem,
  type PlanItem,
  type ProjectSnapshot,
  type SessionIssue,
} from '../github/types.js';
import { type Result, fail, ok } from '../result.js';

/** The last refresh that failed. */
export type ProjectCacheFailure = {
  kind: GitHubErrorKind;
  /** What GitHub or the companion said, as it can be shown. */
  message: string;
  /** ISO 8601. */
  at: string;
};

/** What the cache holds. `snapshot` is `null` until a refresh succeeded once. */
export type ProjectCache = {
  snapshot: ProjectSnapshot | null;
  /** `null` when the last refresh succeeded, or none failed yet. */
  failure: ProjectCacheFailure | null;
};

const ERROR_KINDS: readonly string[] = [
  'unreachable',
  'not-signed-in',
  'missing-scope',
  'not-found',
  'rate-limited',
  'failed',
];

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isListOf<T>(value: unknown, check: (entry: unknown) => entry is T): value is T[] {
  return Array.isArray(value) && value.every((entry) => check(entry));
}

function isFieldOption(value: unknown): value is FieldOption {
  return isJsonObject(value) && isString(value.id) && isString(value.name);
}

function isPlanItem(value: unknown): value is PlanItem {
  return (
    isJsonObject(value) &&
    isIssueRef(value.issue) &&
    isString(value.title) &&
    (value.state === 'open' || value.state === 'closed') &&
    isStringOrNull(value.status) &&
    isListOf(value.labels, isString) &&
    (value.updatedAt === undefined || isString(value.updatedAt))
  );
}

function isFocusItem(value: unknown): value is FocusItem {
  if (!isJsonObject(value)) return false;
  const { stage, stageChangedAt, kind, items, specUrl } = value;
  return (
    isPlanItem(value) &&
    isStringOrNull(stage) &&
    (stageChangedAt === undefined || isStringOrNull(stageChangedAt)) &&
    isStringOrNull(kind) &&
    isListOf(items, isPlanItem) &&
    isStringOrNull(specUrl)
  );
}

function isSessionIssue(value: unknown): value is SessionIssue {
  return (
    isJsonObject(value) &&
    isIssueRef(value.issue) &&
    isString(value.title) &&
    AGENTS_COLUMNS.some((column) => column === value.column) &&
    isListOf(value.targets, isWriteTarget) &&
    typeof value.attended === 'boolean' &&
    isString(value.person) &&
    isString(value.machine) &&
    isString(value.updatedAt)
  );
}

/** Whether `value` has the shape of a `ProjectSnapshot`. Extra fields are allowed. */
export function isProjectSnapshot(value: unknown): value is ProjectSnapshot {
  if (!isJsonObject(value)) return false;
  const { project, stageField } = value;
  return (
    isString(value.fetchedAt) &&
    !Number.isNaN(Date.parse(value.fetchedAt)) &&
    isJsonObject(project) &&
    isString(project.owner) &&
    isInteger(project.number) &&
    isString(project.title) &&
    isString(project.url) &&
    isJsonObject(stageField) &&
    isString(stageField.id) &&
    isListOf(stageField.options, isFieldOption) &&
    isListOf(value.focuses, isFocusItem) &&
    isListOf(value.standalone, isPlanItem) &&
    isListOf(value.sessions, isSessionIssue)
  );
}

function isCacheFailure(value: unknown): value is ProjectCacheFailure {
  return (
    isJsonObject(value) &&
    isString(value.kind) &&
    ERROR_KINDS.includes(value.kind) &&
    isString(value.message) &&
    isString(value.at)
  );
}

/** Whether `value` is the record of the cache file. */
export function isProjectCacheRecord(value: unknown): value is ProjectCache {
  return (
    isJsonObject(value) &&
    (value.snapshot === null || isProjectSnapshot(value.snapshot)) &&
    (value.failure === null || isCacheFailure(value.failure))
  );
}

/** The record file of the cache. */
export const PROJECT_CACHE_FILE: DeskRecordFile<ProjectCache> = {
  name: 'projectCache',
  guard: isProjectCacheRecord,
};

const EMPTY: ProjectCache = { snapshot: null, failure: null };

/**
 * What the cache holds: its last record this build understands, or an empty
 * cache when there is none. A file that cannot be parsed is set aside by the
 * store and reads as empty; the desk's notices say so.
 */
export function readProjectCache(desk: Desk): Result<ProjectCache, DeskFailure> {
  const records = readDeskRecords(desk, PROJECT_CACHE_FILE);
  if (!records.ok) return records;
  const last = records.value.at(-1);
  return ok(last === undefined ? { ...EMPTY } : { snapshot: last.snapshot, failure: last.failure });
}

/**
 * Change the cache in one atomic write. The last understood record is replaced
 * in place, and the fields of it this build does not know are kept; entries
 * that are not understood stay as they are.
 */
function writeProjectCache(
  desk: Desk,
  change: (current: ProjectCache) => ProjectCache,
): Result<ProjectCache, DeskFailure> {
  return updateDeskRecords(desk, PROJECT_CACHE_FILE, (records) => {
    let index = -1;
    for (let at = records.length - 1; at >= 0; at -= 1) {
      if (isProjectCacheRecord(records[at])) {
        index = at;
        break;
      }
    }
    const found = index < 0 ? undefined : (records[index] as JsonObject & ProjectCache);
    const current: ProjectCache =
      found === undefined ? { ...EMPTY } : { snapshot: found.snapshot, failure: found.failure };
    const next = change(current);
    const plain = toPlainJson({ ...(found ?? {}), snapshot: next.snapshot, failure: next.failure });
    if (plain === undefined || !isProjectCacheRecord(plain)) {
      return fail('invalid-record', 'the snapshot does not have the shape of the Project cache');
    }
    const written: JsonValue[] = [...records];
    if (index < 0) written.push(plain as JsonValue);
    else written[index] = plain as JsonValue;
    return ok({ records: written, value: next });
  });
}

/** Keep `snapshot` as the cache, and clear the recorded failure. */
export function recordProjectSnapshot(
  desk: Desk,
  snapshot: ProjectSnapshot,
): Result<ProjectCache, DeskFailure> {
  return writeProjectCache(desk, () => ({ snapshot, failure: null }));
}

/** Record that a refresh failed. The snapshot stays as it was. */
export function recordProjectFailure(
  desk: Desk,
  failure: ProjectCacheFailure,
): Result<ProjectCache, DeskFailure> {
  return writeProjectCache(desk, (current) => ({ snapshot: current.snapshot, failure }));
}
