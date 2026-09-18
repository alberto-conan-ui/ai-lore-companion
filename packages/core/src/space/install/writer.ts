/**
 * The writer of the install into Claude Code: it reads what the last install
 * recorded, compares it with the projection and with what is on disk, and
 * writes, keeps or removes each file.
 *
 * The rules of an install that is run again:
 *
 * - `install.json` lists every file the install wrote, with the SHA-256 it had
 *   when it was written. Only a file in that list is ever replaced or removed.
 * - A file in the list that the projection no longer has (its card was removed
 *   from the Lore) is deleted, and its skill folder with it when the folder is
 *   then empty.
 * - A file in the list whose hash on disk is not the recorded one was edited by
 *   hand. It is left alone and reported, unless the caller passes
 *   `overwriteEdited`. (The architecture document does not cover this case;
 *   this is the phase's choice.)
 * - A file that is not in the list and is where a projected file goes is left
 *   alone and reported, unless it already has the projected content, in which
 *   case it is recorded and not written.
 * - A file with the projected content is not written again, and `install.json`
 *   is written only when its text changes, so a second install of the same Lore
 *   writes nothing.
 * - A folder or a symbolic link at a path of the projection or of `install.json`
 *   is never written, followed or removed. It is reported, and the other files
 *   are installed.
 * - A path that `install.json` does not list yet is added to it before the
 *   file is written, and `install.json` is written in full at the end. An
 *   install that stops half way is finished by the next one, and no file is
 *   left that no record lists.
 * - An `install.json` of a later format is a failure, and nothing is written.
 * - Every path, from the projection and from `install.json`, is joined to the
 *   install folder with `safeJoin`. A path that leads outside is reported and
 *   nothing is written or removed there.
 */

import { createHash } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, readFile, rename, rm, rmdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { atomicTempPathFor, writeFileAtomic } from '../fs/atomic-write.js';
import { safeJoin, sha256File } from '../fs/index.js';
import type { ResolvedLore } from '../lore/types.js';
import { type Failure, type Result, errorCode, errorMessage, fail, ok } from '../result.js';
import {
  CLAUDE_CODE_INSTALL_LAYOUT,
  CLAUDE_CODE_PLUGIN_PREFIX,
  claudeCodeInstallPaths,
  projectClaudeCode,
} from './claude-code.js';
import {
  INSTALL_RECORD_VERSION,
  type InstallAction,
  type InstallFailureKind,
  type InstallOptions,
  type InstallOutcome,
  type InstallPlan,
  type InstallRecord,
  type InstallReport,
  type InstalledCardRef,
  type InstalledFile,
  type InstalledFileKind,
  type ProjectedFile,
} from './types.js';

type InstallResult<T> = Result<T, Failure<InstallFailureKind>>;

const FILE_KINDS: readonly InstalledFileKind[] = ['plugin-manifest', 'skill', 'check'];
const SHA256 = /^[0-9a-f]{64}$/;

const sha256Text = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');

const byPath = (a: { path: string }, b: { path: string }): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/** The text of `install.json` for `record`. */
function recordText(record: InstallRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

function isRecordOf<T extends object>(value: unknown): value is { [K in keyof T]?: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCardRef(value: unknown): (InstalledCardRef & { sha256: string }) | null {
  if (!isRecordOf<InstalledCardRef & { sha256: string }>(value)) return null;
  const { part, name, layer, path, replacesDefault, when, sha256 } = value;
  if (part !== 'verbs' && part !== 'processes' && part !== 'contracts') return null;
  if (layer !== 'core' && layer !== 'default' && layer !== 'own') return null;
  if (when !== null && when !== 'before' && when !== 'after' && when !== 'both') return null;
  if (typeof name !== 'string' || typeof path !== 'string') return null;
  if (typeof replacesDefault !== 'boolean') return null;
  if (typeof sha256 !== 'string' || !SHA256.test(sha256)) return null;
  return { part, name, layer, path, replacesDefault, when, sha256 };
}

function parseInstalledFile(value: unknown): InstalledFile | null {
  if (!isRecordOf<InstalledFile>(value)) return null;
  const { path, kind, sha256, cards } = value;
  if (typeof path !== 'string' || path === '') return null;
  if (!FILE_KINDS.includes(kind as InstalledFileKind)) return null;
  if (typeof sha256 !== 'string' || !SHA256.test(sha256)) return null;
  if (!Array.isArray(cards)) return null;
  const refs = cards.map(parseCardRef);
  if (refs.some((ref) => ref === null)) return null;
  return {
    path,
    kind: kind as InstalledFileKind,
    sha256,
    cards: refs.filter((ref): ref is InstalledCardRef & { sha256: string } => ref !== null),
  };
}

/** What `parseInstallRecord` returns for a record of a later format. */
const NEWER_RECORD = Symbol('newer install record');

/**
 * The record in the text of an `install.json`, `NEWER_RECORD` for a record of a
 * later format, or a sentence that says why the text is not a record.
 */
function parseInstallRecord(text: string): InstallRecord | typeof NEWER_RECORD | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (caught) {
    return `it is not JSON: ${errorMessage(caught)}`;
  }
  if (!isRecordOf<InstallRecord>(parsed)) return 'it is not a JSON object';
  if (typeof parsed.version === 'number' && parsed.version > INSTALL_RECORD_VERSION) {
    return NEWER_RECORD;
  }
  if (parsed.version !== INSTALL_RECORD_VERSION) {
    return `its version is not ${INSTALL_RECORD_VERSION}`;
  }
  if (parsed.engine !== 'claude-code') return 'its engine is not claude-code';
  if (typeof parsed.prefix !== 'string' || typeof parsed.space !== 'string') {
    return 'it has no prefix or no space';
  }
  if (!Array.isArray(parsed.files)) return 'it has no list of files';
  const files = parsed.files.map(parseInstalledFile);
  if (files.some((file) => file === null))
    return 'an item of its list of files is not a file record';
  return {
    version: INSTALL_RECORD_VERSION,
    engine: 'claude-code',
    prefix: parsed.prefix,
    space: parsed.space,
    files: files.filter((file): file is InstalledFile => file !== null),
  };
}

/**
 * Read the `install.json` of the install folder `targetDir`
 * (`ClaudeCodeInstallPaths.dir`). The value is `null` when nothing was
 * installed there yet. A file that is there and cannot be read as a record
 * gives the failure `install-record-unreadable`, and a record whose version is
 * later than this code's gives `install-record-newer`.
 */
export async function readInstallRecord(
  targetDir: string,
): Promise<
  Result<InstallRecord | null, Failure<'install-record-unreadable' | 'install-record-newer'>>
> {
  const joined = safeJoin(targetDir, CLAUDE_CODE_INSTALL_LAYOUT.record);
  if (!joined.ok) return fail('install-record-unreadable', joined.error.message);
  let text: string;
  try {
    text = await readFile(joined.value, 'utf8');
  } catch (caught) {
    if (errorCode(caught) === 'ENOENT') return ok(null);
    return fail(
      'install-record-unreadable',
      `${joined.value} cannot be read: ${errorMessage(caught)}`,
    );
  }
  const record = parseInstallRecord(text);
  if (record === NEWER_RECORD) {
    return fail(
      'install-record-newer',
      `${joined.value} was written by a later version of the companion than this one, which reads version ${INSTALL_RECORD_VERSION}`,
    );
  }
  if (typeof record === 'string') {
    return fail('install-record-unreadable', `${joined.value} is not an install record: ${record}`);
  }
  return ok(record);
}

/** What `hashOnDisk` gives for a folder, a symbolic link or anything else that is not a regular file. */
const NOT_A_FILE = 'not-a-file';

/**
 * The SHA-256 of the regular file at `path`, `null` when nothing is there,
 * `NOT_A_FILE` for anything else that is there, or a failure. The path itself
 * is not followed when it is a symbolic link.
 */
async function hashOnDisk(path: string): Promise<InstallResult<string | null>> {
  try {
    const info = await lstat(path);
    if (!info.isFile()) return ok(NOT_A_FILE);
  } catch (caught) {
    const code = errorCode(caught);
    if (code === 'ENOENT' || code === 'ENOTDIR') return ok(null);
    return fail('target-invalid', `${path} cannot be read: ${errorMessage(caught)}`);
  }
  const hash = await sha256File(path);
  if (!hash.ok) return fail('target-invalid', hash.error.message);
  return ok(hash.value);
}

/** A projected file with the hash its content has, and the hash of each of its cards. */
type HashedFile = { file: ProjectedFile; record: InstalledFile };

async function hashProjectedFile(
  lore: ResolvedLore,
  file: ProjectedFile,
  reports: InstallReport[],
): Promise<HashedFile | null> {
  const cards: InstalledFile['cards'] = [];
  for (const ref of file.cards) {
    const cardPath = safeJoin(lore.spaceRoot, ref.path);
    const hash = cardPath.ok ? await sha256File(cardPath.value) : cardPath;
    if (!hash.ok) {
      reports.push({
        kind: 'source-unreadable',
        path: cardPath.ok ? cardPath.value : ref.path,
        message: `${hash.error.message}; nothing was installed for the card ${ref.name}`,
      });
      return null;
    }
    cards.push({ ...ref, sha256: hash.value });
  }
  let sha256: string;
  if (file.content !== null) {
    sha256 = sha256Text(file.content);
  } else {
    const source = file.copyFrom ?? '';
    const hash = await sha256File(source);
    if (!hash.ok) {
      reports.push({
        kind: 'source-unreadable',
        path: source,
        message: `${hash.error.message}; the check script was not copied`,
      });
      return null;
    }
    sha256 = hash.value;
  }
  return { file, record: { path: file.path, kind: file.kind, sha256, cards } };
}

type PlannedWrite = { absolute: string; file: ProjectedFile };
type PlannedRemoval = { absolute: string; record: InstalledFile };

/** A plan with the absolute paths the writer needs, which the public plan leaves out. */
type WorkPlan = {
  plan: InstallPlan;
  writes: PlannedWrite[];
  removals: PlannedRemoval[];
  /** The files of the `install.json` that was read, as they were listed. Empty when there was none. */
  previousFiles: InstalledFile[];
};

async function buildPlan(
  lore: ResolvedLore,
  installDir: string,
  options: InstallOptions,
): Promise<InstallResult<WorkPlan>> {
  const paths = claudeCodeInstallPaths(installDir);
  const overwriteEdited = options.overwriteEdited === true;

  try {
    const info = await lstat(paths.dir);
    if (!info.isDirectory()) {
      return fail(
        'target-invalid',
        `${paths.dir} is not a folder, so nothing can be installed in it`,
      );
    }
  } catch (caught) {
    if (errorCode(caught) !== 'ENOENT') {
      return fail('target-invalid', `${paths.dir} cannot be read: ${errorMessage(caught)}`);
    }
  }

  const projection = projectClaudeCode(lore);
  const reports: InstallReport[] = [...projection.reports];

  const previous = await readInstallRecord(paths.dir);
  if (!previous.ok && previous.error.kind === 'install-record-newer') {
    return fail(
      'install-record-newer',
      `${previous.error.message}; nothing was written or removed, because this version cannot tell which files that install owns`,
    );
  }
  if (!previous.ok) {
    reports.push({
      kind: 'install-record-unreadable',
      path: paths.record,
      message: `${previous.error.message}; the install treats every file that is already in the folder as a file it did not write`,
    });
  }
  const recorded = new Map<string, InstalledFile>();
  for (const file of previous.ok && previous.value !== null ? previous.value.files : []) {
    recorded.set(file.path, file);
  }

  const actions: InstallAction[] = [];
  const kept: InstalledFile[] = [];
  const writes: PlannedWrite[] = [];
  const removals: PlannedRemoval[] = [];
  const projectedPaths = new Set<string>();

  for (const projected of projection.files) {
    const joined = safeJoin(paths.dir, projected.path);
    if (!joined.ok || projected.path === CLAUDE_CODE_INSTALL_LAYOUT.record) {
      // Reported once: the path is not looked at again as a file that is no longer projected.
      projectedPaths.add(projected.path);
      reports.push({
        kind: 'outside-target',
        path: projected.path,
        message: `${projected.path} is not a path inside the install folder ${paths.dir}; nothing was written there`,
      });
      continue;
    }
    const hashed = await hashProjectedFile(lore, projected, reports);
    if (hashed === null) continue;
    projectedPaths.add(projected.path);

    const onDisk = await hashOnDisk(joined.value);
    if (!onDisk.ok) return onDisk;
    const before = recorded.get(projected.path);
    const base = { path: projected.path, kind: projected.kind };

    if (onDisk.value === NOT_A_FILE) {
      actions.push({ ...base, action: 'keep-foreign', overwritesEdit: false });
      reports.push({
        kind: 'not-installed-by-companion',
        path: joined.value,
        message: `${projected.path} is in the install folder and is a folder or a symbolic link, which an install never writes; it was left as it is, and the projected file was not written`,
      });
    } else if (onDisk.value === hashed.record.sha256) {
      actions.push({ ...base, action: 'unchanged', overwritesEdit: false });
      kept.push(hashed.record);
    } else if (onDisk.value === null || before?.sha256 === onDisk.value) {
      actions.push({ ...base, action: 'write', overwritesEdit: false });
      kept.push(hashed.record);
      writes.push({ absolute: joined.value, file: projected });
    } else if (before === undefined) {
      actions.push({ ...base, action: 'keep-foreign', overwritesEdit: false });
      reports.push({
        kind: 'not-installed-by-companion',
        path: joined.value,
        message: `${projected.path} is in the install folder and was not written by an install; it was left as it is, and the projected file was not written`,
      });
    } else if (overwriteEdited) {
      actions.push({ ...base, action: 'write', overwritesEdit: true });
      kept.push(hashed.record);
      writes.push({ absolute: joined.value, file: projected });
    } else {
      actions.push({ ...base, action: 'keep-edited', overwritesEdit: false });
      kept.push(before);
      reports.push({
        kind: 'edited-by-hand',
        path: joined.value,
        message: `${projected.path} was changed by hand since it was installed; it was left as it is, and the projected file was not written`,
      });
    }
  }

  for (const before of [...recorded.values()].sort(byPath)) {
    if (projectedPaths.has(before.path)) continue;
    const joined = safeJoin(paths.dir, before.path);
    if (!joined.ok || before.path === CLAUDE_CODE_INSTALL_LAYOUT.record) {
      reports.push({
        kind: 'outside-target',
        path: before.path,
        message: `install.json lists ${before.path}, which is not a path inside the install folder ${paths.dir}; nothing was removed there`,
      });
      continue;
    }
    const onDisk = await hashOnDisk(joined.value);
    if (!onDisk.ok) return onDisk;
    const base = { path: before.path, kind: before.kind };
    if (onDisk.value === null) {
      actions.push({ ...base, action: 'forget', overwritesEdit: false });
    } else if (onDisk.value === NOT_A_FILE) {
      actions.push({ ...base, action: 'forget', overwritesEdit: false });
      reports.push({
        kind: 'not-installed-by-companion',
        path: joined.value,
        message: `install.json lists ${before.path}, which is a folder or a symbolic link, and an install never writes one; it was left as it is and is no longer listed`,
      });
    } else if (onDisk.value === before.sha256 || overwriteEdited) {
      actions.push({ ...base, action: 'remove', overwritesEdit: onDisk.value !== before.sha256 });
      removals.push({ absolute: joined.value, record: before });
    } else {
      actions.push({ ...base, action: 'keep-edited', overwritesEdit: false });
      kept.push(before);
      reports.push({
        kind: 'edited-by-hand',
        path: joined.value,
        message: `${before.path} is no longer projected from the Lore and was changed by hand since it was installed; it was left as it is`,
      });
    }
  }

  const record: InstallRecord = {
    version: INSTALL_RECORD_VERSION,
    engine: 'claude-code',
    prefix: CLAUDE_CODE_PLUGIN_PREFIX,
    space: lore.spaceRoot,
    files: kept.sort(byPath),
  };
  let recordOnDisk: string | null = null;
  try {
    recordOnDisk = await readFile(paths.record, 'utf8');
  } catch {
    recordOnDisk = null;
  }
  return ok({
    plan: {
      paths,
      actions: actions.sort(byPath),
      record,
      recordChanges: recordOnDisk !== recordText(record),
      reports,
    },
    writes,
    removals,
    previousFiles: [...recorded.values()],
  });
}

/**
 * What an install of `lore` under `installDir` (a desk's `install` folder,
 * `DeskPaths.install`) would do, without writing anything: one action per file,
 * the record `install.json` would hold, and the reports. The setup and
 * migration screens show this plan before anything happens.
 */
export async function planClaudeCodeInstall(
  lore: ResolvedLore,
  installDir: string,
  options: InstallOptions = {},
): Promise<InstallResult<InstallPlan>> {
  const work = await buildPlan(lore, installDir, options);
  return work.ok ? ok(work.value.plan) : work;
}

/** Copy the bytes of `source` to `destination` through a temporary file and a rename. */
async function copyFileAtomic(source: string, destination: string): Promise<InstallResult<void>> {
  const temp = atomicTempPathFor(destination);
  try {
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, temp);
    // The copy is run as `python3 <path>`, so it needs no execute bit.
    await chmod(temp, 0o644);
    await rename(temp, destination);
    return ok(undefined);
  } catch (caught) {
    await rm(temp, { force: true }).catch(() => undefined);
    return fail('write-failed', `cannot copy ${source} to ${destination}: ${errorMessage(caught)}`);
  }
}

/**
 * Install `lore` into Claude Code under `installDir` (a desk's `install`
 * folder): write the plugin manifest, one skill per verb and per process, a
 * copy of each check script, and `install.json`. It writes no hook and nothing
 * outside `<installDir>/claude-code/`. Run again, it removes what it installed
 * before and the Lore no longer has, leaves alone every file it did not write
 * and every file edited by hand (reporting them), and writes nothing when
 * nothing changed. With `dryRun` it returns the plan and writes nothing.
 */
export async function installClaudeCode(
  lore: ResolvedLore,
  installDir: string,
  options: InstallOptions = {},
): Promise<InstallResult<InstallOutcome>> {
  const work = await buildPlan(lore, installDir, options);
  if (!work.ok) return work;
  const { plan, writes, removals, previousFiles } = work.value;
  if (options.dryRun === true) return ok({ plan, applied: false, written: [], removed: [] });

  const written: string[] = [];
  const removed: string[] = [];

  // A file at a path that `install.json` does not list yet is listed before it is
  // written, so a process that stops before the last step leaves no file that the
  // next install cannot account for. Files that are listed keep their recorded hash.
  const listed = new Set(previousFiles.map((file) => file.path));
  const writtenPaths = new Set(writes.map((write) => write.file.path));
  const added = plan.record.files.filter(
    (file) => writtenPaths.has(file.path) && !listed.has(file.path),
  );
  if (added.length > 0) {
    const interim: InstallRecord = {
      ...plan.record,
      files: [...previousFiles, ...added].sort(byPath),
    };
    const result = await writeFileAtomic(plan.paths.record, recordText(interim));
    if (!result.ok) return fail('write-failed', result.error.message);
  }

  for (const { absolute, file } of writes) {
    const result: InstallResult<void> =
      file.content !== null
        ? await writeFileAtomic(absolute, file.content)
        : await copyFileAtomic(file.copyFrom ?? '', absolute);
    if (!result.ok) return fail('write-failed', result.error.message);
    written.push(file.path);
  }

  for (const { absolute, record } of removals) {
    try {
      await rm(absolute, { force: true });
      // A skill's folder goes with its file when nothing else is in it.
      if (record.kind === 'skill') await rmdir(dirname(absolute)).catch(() => undefined);
    } catch (caught) {
      return fail('write-failed', `cannot remove ${absolute}: ${errorMessage(caught)}`);
    }
    removed.push(record.path);
  }

  if (plan.recordChanges) {
    const result = await writeFileAtomic(plan.paths.record, recordText(plan.record));
    if (!result.ok) return fail('write-failed', result.error.message);
    written.push(CLAUDE_CODE_INSTALL_LAYOUT.record);
  }
  return ok({ plan, applied: true, written, removed });
}
