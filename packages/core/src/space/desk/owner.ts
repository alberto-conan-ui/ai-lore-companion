/**
 * The owner file of a desk: `owner.json`, which names the app instance that
 * writes the desk's records.
 *
 * A development build and an installed build share one data folder, so two
 * running instances can open the same desk. The first one writes the owner
 * file. A second one that finds a live owner opens the desk with writing
 * disabled. An owner whose process no longer runs is stale and is replaced.
 *
 * How staleness is decided. The owner file holds the process id and the start
 * time of the owning process. The owner is stale when no process has that id
 * (`process.kill(pid, 0)` fails with `ESRCH`); when the operating system says
 * that the process with that id started at another time, because then the id
 * was given to another program after the owner ended; or when the id is this
 * process's own and the start time is another. The start time is the one the
 * operating system keeps for the process (`exec/process-start.ts`), which does
 * not move when the clock is changed. Where the operating system does not give
 * it, a process with the owner's id reads as a live owner, so a live owner is
 * never replaced. The caller can pass its own `isOwnerRunning`.
 *
 * How two instances are kept apart. The file is created with a hard link from
 * a finished temporary file, which fails when the file exists, so of two
 * instances that start together one becomes the owner. An owner file that is
 * stale or cannot be read is replaced only by the instance that holds the
 * takeover file (`owner.json.takeover`, created the same way), and only when
 * the owner file still has the text that instance read, so an instance that
 * read a stale file cannot remove the file another instance has written since.
 * Every write of a record confirms the owner file first (`confirmDeskOwnership`).
 */

import {
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { readProcessStartedAt } from '../exec/process-start.js';
import { atomicTempPathFor, writeFileAtomicSync } from '../fs/atomic-write.js';
import { type Failure, type Result, errorCode, errorMessage, fail, ok } from '../result.js';
import { isDeskOwner, isJsonObject } from './guards.js';
import type { DeskFailureKind, DeskInstance, DeskNotice, DeskOwner } from './types.js';

/** The name of the owner file inside the desk folder. */
export const DESK_OWNER_FILE = 'owner.json';

/** The `version` written into the owner file. */
export const DESK_OWNER_VERSION = 1;

/** Permission bits of the desk folder: the Human Lead's account only. */
export const DESK_DIR_MODE = 0o700;

/** Permission bits of every file in the desk folder: the Human Lead's account only. */
export const DESK_FILE_MODE = 0o600;

/** The ending of the file an instance holds while it replaces an owner file. */
const TAKEOVER_SUFFIX = '.takeover';

/** How often `takeDeskOwnership` looks again while another instance replaces the owner file. */
const TAKEOVER_ATTEMPTS = 100;

/** How long it waits between two looks, in milliseconds. */
const TAKEOVER_WAIT_MS = 20;

/**
 * How far the start time in an owner file may be from the operating system's
 * and still name the same process. The operating system gives whole seconds,
 * and an instance that could not ask it records a time computed from the clock.
 */
const START_TIME_TOLERANCE_MS = 2000;

/** Decides whether the process an owner file names is still running. */
export type OwnerProbe = (owner: DeskOwner) => boolean;

/** What `takeDeskOwnership` found. */
export type OwnershipOutcome = {
  /** Whether this instance owns the desk and may write its records. */
  owned: boolean;
  /** The owner the file names now: this instance, or the live one that was found. */
  owner: DeskOwner;
  /** What happened to an earlier owner file, for the header. */
  notices: DeskNotice[];
};

let currentInstance: DeskInstance | null = null;

/**
 * This process as a desk instance. Its start time is the one the operating
 * system keeps, or, where that cannot be read, the clock less the time the
 * process has run. It is read once.
 */
export function currentDeskInstance(): DeskInstance {
  if (currentInstance === null) {
    const startedAt =
      readProcessStartedAt(process.pid) ??
      new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString();
    currentInstance = { pid: process.pid, startedAt };
  }
  return { ...currentInstance };
}

/** Whether a process with the id `pid` exists. A process of another account counts as existing. */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (caught) {
    return errorCode(caught) === 'EPERM';
  }
}

/**
 * Whether the process that wrote `owner` still runs: a process with its id
 * exists and, where the operating system says when that process started, it
 * started at the time the owner file holds. The default `OwnerProbe`.
 */
export function isDeskOwnerRunning(owner: DeskInstance): boolean {
  if (!isProcessRunning(owner.pid)) return false;
  const started = readProcessStartedAt(owner.pid);
  if (started === null) return true;
  return Math.abs(Date.parse(started) - Date.parse(owner.startedAt)) <= START_TIME_TOLERANCE_MS;
}

/** A time as it appears in the name of a file that was set aside: `20260918T101112345Z`. */
export function fileStamp(at: Date): string {
  return at.toISOString().replace(/[-:.]/g, '');
}

/** What is at `path`, without following a symbolic link: a file, something else, or nothing. */
function entryKind(path: string): 'file' | 'other' | 'none' {
  try {
    return lstatSync(path).isFile() ? 'file' : 'other';
  } catch {
    return 'none';
  }
}

/**
 * Rename `path` to `<path>.<label>-<stamp>`, adding a counter when that name is
 * taken. Returns the new path. Shared with the record store.
 */
export function setAside(path: string, label: string, at: Date): Result<string, Failure<string>> {
  const base = `${path}.${label}-${fileStamp(at)}`;
  const isFile = entryKind(path) === 'file';
  for (let n = 0; n < 100; n += 1) {
    const target = n === 0 ? base : `${base}-${n}`;
    try {
      if (isFile) {
        // `linkSync` fails when the target exists, so an earlier file is never replaced.
        linkSync(path, target);
        rmSync(path, { force: true });
      } else {
        // A symbolic link or a folder is moved as it is: a hard link would follow the link.
        if (entryKind(target) !== 'none') continue;
        renameSync(path, target);
      }
      return ok(target);
    } catch (caught) {
      if (errorCode(caught) === 'EEXIST') continue;
      return fail('write-failed', `cannot set ${path} aside: ${errorMessage(caught)}`);
    }
  }
  return fail('write-failed', `cannot set ${path} aside: every name is taken`);
}

type OwnerFileState =
  | { state: 'missing' }
  | { state: 'owner'; owner: DeskOwner; text: string }
  | { state: 'unreadable'; reason: string; text: string };

function readOwnerFile(path: string): Result<OwnerFileState, Failure<DeskFailureKind>> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (caught) {
    if (errorCode(caught) === 'ENOENT') return ok({ state: 'missing' });
    return fail('read-failed', `cannot read ${path}: ${errorMessage(caught)}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (caught) {
    return ok({ state: 'unreadable', reason: errorMessage(caught), text });
  }
  if (isJsonObject(data) && isDeskOwner(data)) {
    const { pid, startedAt, openedAt } = data;
    return ok({ state: 'owner', owner: { pid, startedAt, openedAt }, text });
  }
  if (isJsonObject(data) && typeof data.version === 'number' && data.version > DESK_OWNER_VERSION) {
    return fail(
      'newer-version',
      `${path} has version ${data.version}, and this build reads version ${DESK_OWNER_VERSION}. A newer build of the companion wrote it; it is left as it is.`,
    );
  }
  return ok({ state: 'unreadable', reason: 'it does not name a process', text });
}

/** The owner the desk folder's owner file names, or `null` when there is none that can be read. */
export function readDeskOwner(deskDir: string): Result<DeskOwner | null, Failure<DeskFailureKind>> {
  const read = readOwnerFile(join(deskDir, DESK_OWNER_FILE));
  if (!read.ok) return read;
  return ok(read.value.state === 'owner' ? read.value.owner : null);
}

function sameInstance(owner: DeskInstance, instance: DeskInstance): boolean {
  return owner.pid === instance.pid && owner.startedAt === instance.startedAt;
}

function ownerText(owner: DeskOwner): string {
  return `${JSON.stringify({ version: DESK_OWNER_VERSION, ...owner }, null, 2)}\n`;
}

/**
 * Create `path` with `text` unless it exists. `false` when another instance
 * created it first, or removed the temporary file; the caller looks again.
 */
function createFileExclusive(
  path: string,
  text: string,
): Result<boolean, Failure<DeskFailureKind>> {
  const temp = atomicTempPathFor(path);
  try {
    writeFileSync(temp, text, { encoding: 'utf8', mode: DESK_FILE_MODE, flag: 'wx' });
    linkSync(temp, path);
    return ok(true);
  } catch (caught) {
    const code = errorCode(caught);
    if (code === 'EEXIST' || code === 'ENOENT') return ok(false);
    return fail('write-failed', `cannot write ${path}: ${errorMessage(caught)}`);
  } finally {
    try {
      rmSync(temp, { force: true });
    } catch {
      // Left behind; its name marks it as a temporary file, and opening a desk removes those.
    }
  }
}

/** Stop this thread for `ms` milliseconds. Opening a desk is synchronous. */
function waitSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Remove a takeover file whose instance no longer runs, or that cannot be read. */
function clearDeadTakeover(marker: string, isOwnerRunning: OwnerProbe): void {
  const read = readOwnerFile(marker);
  if (!read.ok || read.value.state === 'missing') return;
  if (read.value.state === 'owner' && isOwnerRunning(read.value.owner)) return;
  try {
    rmSync(marker, { force: true });
  } catch {
    // Still there; the next look tries again.
  }
}

/**
 * Put `owner` in place of an owner file that is stale or cannot be read, when
 * the file still has the text `seen.text`. `false` when another instance holds
 * the takeover file or the owner file has changed; the caller looks again.
 */
function replaceOwnerFile(
  path: string,
  seen: Exclude<OwnerFileState, { state: 'missing' }>,
  owner: DeskOwner,
  at: Date,
  notices: DeskNotice[],
): Result<boolean, Failure<DeskFailureKind>> {
  const marker = `${path}${TAKEOVER_SUFFIX}`;
  const held = createFileExclusive(marker, ownerText(owner));
  if (!held.ok || !held.value) return held;
  try {
    const again = readOwnerFile(path);
    if (!again.ok) return again;
    if (again.value.state === 'missing' || again.value.text !== seen.text) return ok(false);
    if (seen.state === 'unreadable') {
      const aside = setAside(path, 'corrupt', at);
      if (!aside.ok) return fail('write-failed', aside.error.message);
      notices.push({
        kind: 'corrupt-file',
        file: path,
        setAsideAs: aside.value,
        at: at.toISOString(),
        message: `${path} could not be read (${seen.reason}). It was set aside as ${aside.value}.`,
      });
      return createFileExclusive(path, ownerText(owner));
    }
    // The rename of an atomic write puts the new owner in place with no moment without an owner file.
    const written = writeFileAtomicSync(path, ownerText(owner), { mode: DESK_FILE_MODE });
    if (!written.ok) return written;
    notices.push({
      kind: 'stale-owner-replaced',
      file: path,
      previous: seen.owner,
      message: `The desk was last opened by process ${seen.owner.pid}, which no longer runs. This instance took it over.`,
    });
    return ok(true);
  } finally {
    try {
      rmSync(marker, { force: true });
    } catch {
      // The next instance that finds it sees that this one still runs or not, and removes it.
    }
  }
}

/**
 * Make `instance` the owner of the desk folder `deskDir`, unless a live owner
 * is found. The folder is created when missing. `owned: false` is a successful
 * result: the caller opens the desk with writing disabled.
 */
export function takeDeskOwnership(
  deskDir: string,
  instance: DeskInstance,
  options: { now?: () => Date; isOwnerRunning?: OwnerProbe } = {},
): Result<OwnershipOutcome, Failure<DeskFailureKind>> {
  const now = options.now ?? (() => new Date());
  const isOwnerRunning = options.isOwnerRunning ?? isDeskOwnerRunning;
  const path = join(deskDir, DESK_OWNER_FILE);
  const notices: DeskNotice[] = [];
  try {
    mkdirSync(deskDir, { recursive: true, mode: DESK_DIR_MODE });
  } catch (caught) {
    return fail('write-failed', `cannot create ${deskDir}: ${errorMessage(caught)}`);
  }

  // Another instance can take the desk between two steps; each pass reads the file again.
  for (let attempt = 0; attempt < TAKEOVER_ATTEMPTS; attempt += 1) {
    const read = readOwnerFile(path);
    if (!read.ok) return read;
    const found = read.value;
    const owner: DeskOwner = { ...instance, openedAt: now().toISOString() };

    if (found.state === 'missing') {
      const created = createFileExclusive(path, ownerText(owner));
      if (!created.ok) return created;
      if (created.value) return ok({ owned: true, owner, notices });
      continue;
    }
    if (found.state === 'owner') {
      if (sameInstance(found.owner, instance)) {
        return ok({ owned: true, owner: found.owner, notices });
      }
      const reusedOwnId = found.owner.pid === instance.pid;
      if (!reusedOwnId && isOwnerRunning(found.owner)) {
        return ok({ owned: false, owner: found.owner, notices });
      }
    }
    const replaced = replaceOwnerFile(path, found, owner, now(), notices);
    if (!replaced.ok) return replaced;
    if (replaced.value) return ok({ owned: true, owner, notices });
    clearDeadTakeover(`${path}${TAKEOVER_SUFFIX}`, isOwnerRunning);
    waitSync(TAKEOVER_WAIT_MS);
  }
  return fail('write-failed', `cannot settle who owns ${deskDir}: the owner file keeps changing`);
}

/** Whether the owner file of `deskDir` still names `instance`. Checked before every record write. */
export function confirmDeskOwnership(
  deskDir: string,
  instance: DeskInstance,
): Result<void, Failure<DeskFailureKind>> {
  const read = readDeskOwner(deskDir);
  if (!read.ok) return read;
  if (read.value !== null && sameInstance(read.value, instance)) return ok(undefined);
  const holder = read.value === null ? 'no instance' : `process ${read.value.pid}`;
  return fail(
    'not-owner',
    `this instance no longer owns the desk ${deskDir}: its owner file names ${holder}`,
  );
}

/** Remove the owner file of `deskDir` when it names `instance`. Another instance's file is left. */
export function releaseDeskOwnership(
  deskDir: string,
  instance: DeskInstance,
): Result<void, Failure<DeskFailureKind>> {
  const read = readDeskOwner(deskDir);
  if (!read.ok) return read;
  if (read.value === null || !sameInstance(read.value, instance)) return ok(undefined);
  try {
    rmSync(join(deskDir, DESK_OWNER_FILE), { force: true });
    return ok(undefined);
  } catch (caught) {
    return fail(
      'write-failed',
      `cannot remove the owner file of ${deskDir}: ${errorMessage(caught)}`,
    );
  }
}
