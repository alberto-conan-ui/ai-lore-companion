import type { Dirent, Stats } from 'node:fs';
import { type FileHandle, lstat, open, readdir, realpath, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative } from 'node:path';
import type { SessionRecord } from '@ai-lore-companion/core';
import { readHandover } from '@ai-lore-companion/core';
import type {
  DashboardActivitySession,
  DashboardDefinitionDiagnostic,
  DashboardWorkbenchDocument,
  DashboardWorkbenchHandover,
  DashboardWorkbenchSnapshot,
} from '../../shared/ipc/space/dashboard-report.types.js';
import {
  DASHBOARD_DEFAULT_LIMIT,
  DASHBOARD_DEFAULT_RECENT_DAYS,
} from '../../shared/ipc/space/dashboard-report.types.js';

const MAX_FILES = 2000;
const MAX_DIRECTORIES = 500;
const MAX_READ_BYTES = 256 * 1024;
const MAX_TEXT = 4096;
const MAX_ACTIVITY = 50;
const SESSION_ID = /(s-[A-Za-z0-9][A-Za-z0-9._-]*)\.md$/;

export type DashboardWorkbenchOptions = {
  workbenchRoot: string;
  sessions?: readonly SessionRecord[];
  recentDays?: number;
  limit?: number;
  /** Each document widget gets its own metadata window before the shared cap. */
  windows?: readonly { recentDays: number; limit: number }[];
  now?: () => Date;
};

type FileRecord = {
  path: string;
  relativePath: string;
  createdAt: number;
  modifiedAt: number;
  timestampKind: 'creation' | 'modification';
};

function diagnostic(
  kind: DashboardDefinitionDiagnostic['kind'],
  message: string,
  path?: string,
): DashboardDefinitionDiagnostic {
  return { kind, message, ...(path === undefined ? {} : { path }) };
}

function titleOf(text: string, fallback: string): string {
  const heading = text.split(/\r?\n/).find((line) => /^\s*#\s+\S/.test(line));
  const title = heading?.replace(/^\s*#\s+/, '').trim();
  return title === undefined || title === '' ? fallback : title.slice(0, 200);
}

function timestamp(stats: { birthtimeMs: number; mtimeMs: number }): {
  at: number;
  kind: 'creation' | 'modification';
} {
  if (Number.isFinite(stats.birthtimeMs) && stats.birthtimeMs > 0)
    return { at: stats.birthtimeMs, kind: 'creation' };
  return { at: stats.mtimeMs, kind: 'modification' };
}

async function insideRoot(root: string, candidate: string): Promise<boolean> {
  try {
    const realRoot = await realpath(root);
    const real = await realpath(candidate);
    const rel = relative(realRoot, real);
    return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../'));
  } catch {
    return false;
  }
}

/** Read at most one bounded prefix from a stable descriptor. */
async function readBoundedText(path: string, maximum: number): Promise<string> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, 'r');
    const buffer = Buffer.alloc(maximum);
    const result = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, result.bytesRead).toString('utf8');
  } catch {
    return '';
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function walkMarkdown(
  root: string,
  folder: string,
  problems: DashboardDefinitionDiagnostic[],
  budget: { files: number; directories: number; visited: Set<string> },
): Promise<FileRecord[]> {
  if (budget.files >= MAX_FILES || budget.directories >= MAX_DIRECTORIES) return [];
  let realFolder: string;
  try {
    realFolder = await realpath(folder);
  } catch {
    return [];
  }
  if (budget.visited.has(realFolder)) return [];
  budget.visited.add(realFolder);
  budget.directories += 1;
  const result: FileRecord[] = [];
  let entries: Dirent[];
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch (caught) {
    problems.push(
      diagnostic(
        'unreadable',
        `The Workbench folder could not be read: ${String(caught)}.`,
        folder,
      ),
    );
    return result;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (budget.files >= MAX_FILES || budget.directories >= MAX_DIRECTORIES) break;
    if (entry.name.startsWith('.')) continue;
    const path = join(folder, entry.name);
    let info: Stats;
    try {
      if (entry.isSymbolicLink() && !(await insideRoot(root, path))) {
        problems.push(
          diagnostic(
            'unsafe-path',
            'The Workbench link points outside the Workbench and was skipped.',
            path,
          ),
        );
        continue;
      }
      info = await stat(path);
    } catch (caught) {
      problems.push(
        diagnostic('unreadable', `The Workbench entry could not be read: ${String(caught)}.`, path),
      );
      continue;
    }
    if (info.isDirectory()) {
      result.push(...(await walkMarkdown(root, path, problems, budget)));
      continue;
    }
    budget.files += 1;
    if (!info.isFile() || extname(entry.name).toLowerCase() !== '.md') continue;
    const when = timestamp(info);
    result.push({
      path,
      relativePath: relative(root, path).split('/').join('/'),
      createdAt: when.kind === 'creation' ? when.at : 0,
      modifiedAt: info.mtimeMs,
      timestampKind: when.kind,
    });
  }
  return result;
}

function documentOf(file: FileRecord, title: string): DashboardWorkbenchDocument {
  return {
    id: `draft:${file.relativePath}`,
    path: file.relativePath,
    title,
    kind: /(?:^|[._-])spec(?:[._-]|$)/i.test(file.relativePath) ? 'spec' : 'document',
    reviewCandidate: true,
    timestamp: new Date(file.createdAt || file.modifiedAt).toISOString(),
    timestampKind: file.timestampKind,
    modifiedAt: new Date(file.modifiedAt).toISOString(),
  };
}

function handoverOf(file: FileRecord, text: string): DashboardWorkbenchHandover {
  const sessionId = file.relativePath.match(SESSION_ID)?.[1] ?? null;
  const handover = readHandover(text);
  return {
    id: `handover:${file.relativePath}`,
    path: file.relativePath,
    title: titleOf(text, basename(file.relativePath, '.md')),
    sessionId,
    text: handover === null ? null : handover.slice(0, MAX_TEXT),
    timestamp: new Date(file.createdAt || file.modifiedAt).toISOString(),
    timestampKind: file.timestampKind,
    modifiedAt: new Date(file.modifiedAt).toISOString(),
    historical: true,
  };
}

async function handovers(
  root: string,
  problems: DashboardDefinitionDiagnostic[],
  limit: number,
  allowed = true,
): Promise<DashboardWorkbenchHandover[]> {
  if (!allowed) return [];
  const folder = join(root, 'journal');
  const files = await walkMarkdown(root, folder, problems, {
    files: 0,
    directories: 0,
    visited: new Set(),
  });
  const records: DashboardWorkbenchHandover[] = [];
  // Journal files are bounded and read one at a time; this avoids opening a
  // large batch of historical files while the Workbench is being edited.
  for (const file of files.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, limit)) {
    const text = await readBoundedText(file.path, MAX_READ_BYTES);
    records.push(handoverOf(file, text));
  }
  return records.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)).slice(0, limit);
}

function activityOf(sessions: readonly SessionRecord[]): DashboardActivitySession[] {
  return sessions
    .filter((session) => session.closedAt === undefined)
    .map((session) => ({
      id: session.id,
      startedAt: session.startedAt,
      mode: session.mode,
      ...(session.purpose === undefined ? {} : { purpose: session.purpose }),
      ...(session.item === undefined
        ? {}
        : { item: { title: session.item.url, url: session.item.url } }),
    }))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, MAX_ACTIVITY);
}

/** Read only the deterministic Workbench and desk-session evidence for a dashboard. */
export async function readDashboardWorkbench(
  options: DashboardWorkbenchOptions,
): Promise<DashboardWorkbenchSnapshot> {
  const now = options.now ?? (() => new Date());
  const recentDays = options.recentDays ?? DASHBOARD_DEFAULT_RECENT_DAYS;
  const limit = options.limit ?? DASHBOARD_DEFAULT_LIMIT;
  const problems: DashboardDefinitionDiagnostic[] = [];
  let draftsAllowed = true;
  let journalAllowed = true;
  // The configured root is trusted only as a directory boundary. Validate
  // the root and its two top-level inputs before recursive traversal so a
  // symlink there cannot silently move the scan outside Workbench.
  try {
    const rootInfo = await lstat(options.workbenchRoot);
    if (rootInfo.isSymbolicLink()) {
      problems.push(
        diagnostic(
          'unsafe-path',
          'The Workbench root is a symbolic link and was skipped.',
          options.workbenchRoot,
        ),
      );
      return {
        observedAt: now().toISOString(),
        documents: [],
        handovers: [],
        activity: activityOf(options.sessions ?? []),
        problems,
      };
    }
    for (const folder of ['drafts', 'journal']) {
      const path = join(options.workbenchRoot, folder);
      try {
        const info = await lstat(path);
        if (info.isSymbolicLink() && !(await insideRoot(options.workbenchRoot, path))) {
          problems.push(
            diagnostic(
              'unsafe-path',
              'The Workbench folder link points outside the Workbench and was skipped.',
              path,
            ),
          );
          if (folder === 'drafts') draftsAllowed = false;
          else journalAllowed = false;
        }
      } catch {
        // An absent top-level folder is a valid empty Workbench input.
      }
    }
  } catch {
    // A missing Workbench is represented by empty factual sections.
  }
  const drafts = draftsAllowed
    ? await walkMarkdown(options.workbenchRoot, join(options.workbenchRoot, 'drafts'), problems, {
        files: 0,
        directories: 0,
        visited: new Set(),
      })
    : [];
  const windows =
    options.windows === undefined || options.windows.length === 0
      ? [{ recentDays, limit }]
      : options.windows;
  const selected = new Map<string, FileRecord>();
  for (const window of windows) {
    const windowCutoff = now().getTime() - window.recentDays * 24 * 60 * 60 * 1000;
    for (const file of drafts
      .filter((candidate) => (candidate.createdAt || candidate.modifiedAt) >= windowCutoff)
      .sort((a, b) => b.modifiedAt - a.modifiedAt)
      .slice(0, window.limit)) {
      selected.set(file.path, file);
    }
  }
  const documents = [...selected.values()]
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
    .slice(0, MAX_FILES);
  const documentResults: DashboardWorkbenchDocument[] = [];
  for (const file of documents) {
    const content = await readBoundedText(file.path, MAX_TEXT);
    documentResults.push(documentOf(file, titleOf(content, basename(file.relativePath, '.md'))));
  }
  return {
    observedAt: now().toISOString(),
    documents: documentResults,
    handovers: await handovers(options.workbenchRoot, problems, limit, journalAllowed),
    activity: activityOf(options.sessions ?? []),
    problems,
  };
}
