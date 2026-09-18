/**
 * Reading and writing one of the desk's record files.
 *
 * Every storage decision of the desk is here and in `owner.ts`: the file
 * format, the atomic write, what happens to a file that cannot be parsed, and
 * what is kept of content this build does not know. The modules for the single
 * records (`sessions.ts`, `claims.ts`, `marks.ts` and the others) call only the
 * functions of this file, so a different store changes this file and not them.
 *
 * The format of a file is `{ "version": 1, "records": [...] }`.
 *
 * - A write is read, change, atomic write, inside one synchronous function, so
 *   two writes in one process cannot interleave. Only the instance that owns
 *   the desk writes, and each write confirms the owner file first.
 * - A temporary file that an interrupted write left behind is never read: a
 *   reader opens the record by its own name.
 * - Top-level fields other than `version` and `records`, fields of a record
 *   that this build does not use, and whole records that do not have the shape
 *   this build knows are written back as they were read. A development build
 *   and an installed build of different versions share the data folder.
 * - A file that is not JSON, or not of the format above, is renamed to
 *   `<name>.corrupt-<time>`, replaced by an empty file, and reported as a
 *   notice on the desk; the record starts empty. A desk that is not writable
 *   reports it and leaves the file where it is.
 * - A symbolic link where a record file should be is set aside in the same way,
 *   as a link; what it points to is neither read nor written.
 * - A file whose `version` is higher than this build's is left untouched, and
 *   reading or writing it fails with `newer-version`, whatever else it holds.
 * - A file larger than `DESK_RECORD_SIZE_LIMIT` is left untouched, and reading
 *   or writing it fails with `read-failed`.
 */

import { lstatSync, readFileSync } from 'node:fs';
import { writeFileAtomicSync } from '../fs/atomic-write.js';
import { type DeskFileName, deskFile } from '../layout/desk-paths.js';
import { type Result, errorCode, errorMessage, fail, ok } from '../result.js';
import { type Desk, type DeskFailure, addDeskNotice } from './desk.js';
import { isJsonObject, toPlainJson } from './guards.js';
import { DESK_DIR_MODE, DESK_FILE_MODE, confirmDeskOwnership, setAside } from './owner.js';
import type { JsonObject, JsonValue } from './types.js';

/** The `version` this build writes into every record file. */
export const DESK_RECORD_VERSION = 1;

/**
 * The largest record file that is read, in bytes. The `write-guard` check
 * script refuses a larger `sessions.json` or `claims.json`, so the limit is the same.
 */
export const DESK_RECORD_SIZE_LIMIT = 8 * 1024 * 1024;

/** One of the desk's record files: its name, and the guard of the records this build understands. */
export type DeskRecordFile<T> = {
  name: DeskFileName;
  guard: (value: unknown) => value is T;
};

/**
 * What a change makes of the records of a file. `records` is the whole new
 * list, or `null` when nothing is to be written. `value` is what the write
 * function returns to its caller.
 */
export type DeskChange<V> = { records: JsonValue[] | null; value: V };

type Loaded = {
  /** The top-level fields of the file other than `version` and `records`. */
  extra: JsonObject;
  /** Every entry of `records`, understood or not, in the file's order. */
  records: JsonValue[];
  /** Whether a file that can be used is on disk. */
  onDisk: boolean;
};

function serialise(extra: JsonObject, records: JsonValue[]): string {
  return `${JSON.stringify({ ...extra, version: DESK_RECORD_VERSION, records }, null, 2)}\n`;
}

function writeDocument(
  path: string,
  extra: JsonObject,
  records: JsonValue[],
): Result<void, DeskFailure> {
  return writeFileAtomicSync(path, serialise(extra, records), {
    mode: DESK_FILE_MODE,
    dirMode: DESK_DIR_MODE,
  });
}

/** Why `data` is not a record file, or `null` when it is one. */
function formatProblem(data: unknown): string | null {
  if (!isJsonObject(data)) return 'it is not a JSON object';
  const version = data.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return 'it has no "version" number';
  }
  if (!Array.isArray(data.records)) return 'it has no "records" list';
  return null;
}

/**
 * Set a file that cannot be parsed aside and put an empty one in its place.
 * With `mustMove`, a failure to do so is a failure of the operation, so that a
 * write never replaces content that was not kept.
 */
function handleCorrupt(
  desk: Desk,
  path: string,
  reason: string,
  mustMove: boolean,
): Result<Loaded, DeskFailure> {
  const at = desk.now();
  const empty: Loaded = { extra: {}, records: [], onDisk: false };
  // A read moves a file too, so it confirms the owner file as a write does.
  if (!desk.writable || !confirmDeskOwnership(desk.paths.desk, desk.instance).ok) {
    addDeskNotice(desk, {
      kind: 'corrupt-file',
      file: path,
      setAsideAs: null,
      at: at.toISOString(),
      message: `${path} cannot be read (${reason}). It is treated as empty. The instance that owns the desk sets it aside.`,
    });
    return ok(empty);
  }
  const aside = setAside(path, 'corrupt', at);
  if (!aside.ok) {
    if (mustMove) return fail('write-failed', aside.error.message);
    addDeskNotice(desk, {
      kind: 'corrupt-file',
      file: path,
      setAsideAs: null,
      at: at.toISOString(),
      message: `${path} cannot be read (${reason}) and could not be set aside. It is treated as empty.`,
    });
    return ok(empty);
  }
  addDeskNotice(desk, {
    kind: 'corrupt-file',
    file: path,
    setAsideAs: aside.value,
    at: at.toISOString(),
    message: `${path} could not be read (${reason}). It was set aside as ${aside.value}, and the record starts empty.`,
  });
  // The write-guard check script refuses when a record file is missing, so an empty one replaces it.
  const written = writeDocument(path, {}, []);
  if (!written.ok && mustMove) return written;
  return ok({ ...empty, onDisk: written.ok });
}

function load(desk: Desk, path: string, mustMove: boolean): Result<Loaded, DeskFailure> {
  let text: string;
  try {
    const info = lstatSync(path);
    if (info.isSymbolicLink()) {
      // A record is a file of this desk. A link is moved aside as it is; what it points to is not read.
      return handleCorrupt(desk, path, 'it is a symbolic link', mustMove);
    }
    if (info.size > DESK_RECORD_SIZE_LIMIT) {
      return fail(
        'read-failed',
        `${path} is larger than ${DESK_RECORD_SIZE_LIMIT} bytes, which no record of the desk is; it is left as it is`,
      );
    }
    text = readFileSync(path, 'utf8');
  } catch (caught) {
    if (errorCode(caught) === 'ENOENT') return ok({ extra: {}, records: [], onDisk: false });
    return fail('read-failed', `cannot read ${path}: ${errorMessage(caught)}`);
  }
  let data: unknown;
  try {
    // A byte-order mark is not part of the JSON text; the next write leaves it out.
    data = JSON.parse(text.startsWith('﻿') ? text.slice(1) : text);
  } catch (caught) {
    return handleCorrupt(desk, path, errorMessage(caught), mustMove);
  }
  // The version is looked at before the rest of the format, which a newer build may have changed.
  if (
    isJsonObject(data) &&
    typeof data.version === 'number' &&
    data.version > DESK_RECORD_VERSION
  ) {
    return fail(
      'newer-version',
      `${path} has version ${data.version}, and this build reads version ${DESK_RECORD_VERSION}. A newer build of the companion wrote it; it is left as it is.`,
    );
  }
  const problem = formatProblem(data);
  if (problem !== null || !isJsonObject(data)) {
    return handleCorrupt(desk, path, problem ?? 'it is not a JSON object', mustMove);
  }
  const { version: _version, records, ...extra } = data;
  return ok({ extra, records: Array.isArray(records) ? records : [], onDisk: true });
}

/** Why the desk cannot be written by this instance now, or success. */
function checkWritable(desk: Desk): Result<void, DeskFailure> {
  if (!desk.writable) {
    return fail(
      'not-writable',
      `the desk is held by another running instance of the companion (process ${desk.owner.pid}), so this one does not write its records`,
    );
  }
  return confirmDeskOwnership(desk.paths.desk, desk.instance);
}

/**
 * The records of `file` that this build understands, in the file's order. A
 * missing file is an empty list. Entries that are not understood are counted in
 * a notice on the desk and stay in the file.
 */
export function readDeskRecords<T>(desk: Desk, file: DeskRecordFile<T>): Result<T[], DeskFailure> {
  const path = deskFile(desk.paths, file.name);
  const loaded = load(desk, path, false);
  if (!loaded.ok) return loaded;
  const understood: T[] = [];
  for (const record of loaded.value.records) {
    if (file.guard(record)) understood.push(record);
  }
  const skipped = loaded.value.records.length - understood.length;
  if (skipped > 0) {
    addDeskNotice(desk, {
      kind: 'records-not-understood',
      file: path,
      count: skipped,
      message: `${skipped} of the entries of ${path} do not have the shape this build knows. They are not used, and they are kept.`,
    });
  }
  return ok(understood);
}

/**
 * Read, change and atomically write the records of `file`, in one synchronous
 * step. `change` receives every entry of the file, including those this build
 * does not understand, and returns the whole new list; what it does not touch
 * is written back as it was read.
 */
export function updateDeskRecords<T, V, E = never>(
  desk: Desk,
  file: DeskRecordFile<T>,
  change: (records: readonly JsonValue[]) => Result<DeskChange<V>, DeskFailure | E>,
): Result<V, DeskFailure | E> {
  const writable = checkWritable(desk);
  if (!writable.ok) return writable;
  const path = deskFile(desk.paths, file.name);
  const loaded = load(desk, path, true);
  if (!loaded.ok) return loaded;
  const changed = change(loaded.value.records);
  if (!changed.ok) return changed;
  if (changed.value.records !== null) {
    const written = writeDocument(path, loaded.value.extra, changed.value.records);
    if (!written.ok) return written;
  }
  return ok(changed.value.value);
}

/**
 * Add `record` at the end of `file`. Fails with `invalid-record` when it does
 * not pass the guard. `refuse` sees the file's entries inside the same write
 * and returns the failure that stops it, or `null`.
 */
export function appendDeskRecord<T extends object>(
  desk: Desk,
  file: DeskRecordFile<T>,
  record: T,
  refuse?: (records: readonly JsonValue[]) => DeskFailure | null,
): Result<T, DeskFailure> {
  // A record is written as JSON, so it is checked in the form it will be read back in.
  const plain = toPlainJson(record);
  if (!file.guard(plain) || !isJsonObject(plain)) {
    return fail('invalid-record', `the value does not have the shape of a record of ${file.name}`);
  }
  return updateDeskRecords(desk, file, (records) => {
    const refusal = refuse?.(records) ?? null;
    if (refusal !== null) return { ok: false, error: refusal };
    return ok({ records: [...records, plain], value: plain });
  });
}

/**
 * Write `file` as an empty record file when it is not on disk. The
 * `write-guard` check script refuses when `sessions.json` or `claims.json` is
 * missing, so opening a desk makes sure of both.
 */
export function ensureDeskRecordFile(
  desk: Desk,
  file: { name: DeskFileName },
): Result<void, DeskFailure> {
  const writable = checkWritable(desk);
  if (!writable.ok) return writable;
  const path = deskFile(desk.paths, file.name);
  const loaded = load(desk, path, true);
  if (!loaded.ok) return loaded;
  if (loaded.value.onDisk) return ok(undefined);
  return writeDocument(path, {}, []);
}
