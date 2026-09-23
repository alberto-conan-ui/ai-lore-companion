/**
 * The generated files of one guarded session (phase M4.4; M10.5 moves what is
 * Claude Code-only behind the adapter), in
 * `<userData>/spaces/<key>/sessions/<session id>/`:
 *
 *   hooks/pre-write.py    the before-write adapter (every engine)
 *   hooks/post-write.py   the after-write adapter (every engine)
 *   settings.json         Claude Code: permissions, the two hooks, `env`
 *   mcp.json              Claude Code: the session server's address and the session's token
 *   <an adapter's own>    whatever else that engine's adapter's `launch` names in its `LaunchFile`s
 *
 * `writeSessionFiles` writes the two adapters, then each `LaunchFile` of the
 * engine's `SessionLaunch` (`engines/types.ts`); `buildSessionSettings` and
 * `buildSessionMcpConfig` build `settings.json` and `mcp.json`'s content for
 * the Claude Code adapter (`engines/claude-code.ts`), which is the only
 * adapter that uses them today.
 *
 * The folder and every folder inside it have mode 0700 and every file 0600
 * (architecture document, section 5.14): the folder is outside the Space, and
 * `mcp.json` holds the token. The folder is removed when the session ends.
 */

import { chmod, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { type SessionSpend, isSessionSpend } from '@ai-lore-companion/core';
import type { SessionConnection } from '../session-server/index.js';
import { POST_WRITE_ADAPTER, PRE_WRITE_ADAPTER, SPEND_ADAPTER } from './adapters.js';
import { hookArgv, shellCommandLine } from './command-line.js';
import {
  FILE_WRITING_MATCHER,
  POST_WRITE_TIMEOUTS,
  PRE_WRITE_TIMEOUTS,
  SESSION_DIR_MODE,
  SESSION_FILES,
  SESSION_FILE_MODE,
  SESSION_ID_ENV,
  SPEND_HOOK_TIMEOUTS,
} from './constants.js';
import type { SessionLaunch } from './engines/types.js';
import { sessionPermissions } from './permissions.js';

/** The absolute paths of one session's files. */
export type SessionFilePaths = {
  dir: string;
  settings: string;
  mcp: string;
  hooksDir: string;
  preWrite: string;
  postWrite: string;
  refusals: string;
  /** Written by the spend adapter: what the engine reported the session spent (M14.6). */
  spend: string;
  spendHook: string;
};

/** The paths of the files of the session `sessionId` under `sessionsDir` (`DeskPaths.sessions`). */
export function sessionFilePaths(sessionsDir: string, sessionId: string): SessionFilePaths {
  const dir = join(sessionsDir, sessionId);
  return {
    dir,
    settings: join(dir, SESSION_FILES.settings),
    mcp: join(dir, SESSION_FILES.mcp),
    hooksDir: join(dir, SESSION_FILES.hooksDir),
    preWrite: join(dir, SESSION_FILES.preWrite),
    postWrite: join(dir, SESSION_FILES.postWrite),
    refusals: join(dir, SESSION_FILES.refusals),
    spend: join(dir, SESSION_FILES.spend),
    spendHook: join(dir, SESSION_FILES.spendHook),
  };
}

/** The full names of the session server's tools, as Claude Code names them. */
export function sessionToolNames(
  connection: Pick<SessionConnection, 'serverName' | 'tools'>,
): string[] {
  return connection.tools.map((tool) => `mcp__${connection.serverName}__${tool}`);
}

/** What a session's files are made from. Every path is absolute. */
export type SessionFilesInput = {
  sessionId: string;
  spaceRoot: string;
  /** The folder of the desk's records (`DeskPaths.desk`). */
  deskDir: string;
  /** The absolute path of `python3`. */
  python: string;
  /** The copied check scripts to run before a write, in order. */
  beforeChecks: readonly string[];
  /** The copied check scripts to run after a write to the Lore, in order. */
  afterChecks: readonly string[];
  /** The names of the Space's repositories, from its manifest: each gets its read-only `git -C` rules. */
  repositories: readonly string[];
  connection: SessionConnection;
};

type HookEntry = {
  matcher: string;
  hooks: { type: 'command'; command: string; timeout: number }[];
};

/** A `Stop` hook entry: unlike `PreToolUse`/`PostToolUse`, Claude Code's `Stop` is not tool-matched. */
type StopHookEntry = {
  hooks: { type: 'command'; command: string; timeout: number }[];
};

/** The content of `settings.json`, as an object. */
export function buildSessionSettings(
  input: SessionFilesInput,
  paths: SessionFilePaths,
): {
  permissions: ReturnType<typeof sessionPermissions>;
  hooks: { PreToolUse: HookEntry[]; PostToolUse: HookEntry[]; Stop: StopHookEntry[] };
  env: Record<string, string>;
} {
  const tools = sessionToolNames(input.connection);
  const requestTool = tools.find((tool) => tool.endsWith('__request_writing'));
  const shared = {
    python: input.python,
    spaceRoot: input.spaceRoot,
    deskDir: input.deskDir,
    sessionId: input.sessionId,
  };
  const preWrite = shellCommandLine(
    hookArgv({
      ...shared,
      adapter: paths.preWrite,
      checks: input.beforeChecks,
      childSeconds: PRE_WRITE_TIMEOUTS.childSeconds,
      adapterSeconds: PRE_WRITE_TIMEOUTS.adapterSeconds,
      dialect: 'claude',
      ...(requestTool !== undefined ? { requestTool } : {}),
      refusalsFile: paths.refusals,
    }),
  );
  const postWrite = shellCommandLine(
    hookArgv({
      ...shared,
      adapter: paths.postWrite,
      checks: input.afterChecks,
      childSeconds: POST_WRITE_TIMEOUTS.childSeconds,
      adapterSeconds: POST_WRITE_TIMEOUTS.adapterSeconds,
      dialect: 'claude',
    }),
  );
  // M14.6: a `Stop` hook, not a `SessionEnd` hook, so the file survives a killed
  // terminal (`SPEND_ADAPTER`'s own comment, `adapters.ts`). It takes no `--check`
  // and no `--dialect`: it never decides anything, so `hookArgv` is not used for it.
  const spendCommand = shellCommandLine([
    input.python,
    paths.spendHook,
    '--out',
    paths.spend,
    '--adapter-seconds',
    String(SPEND_HOOK_TIMEOUTS.adapterSeconds),
  ]);
  return {
    permissions: sessionPermissions(tools, input.repositories),
    hooks: {
      // Every entry sets `timeout`: the engine's default is 600 seconds, and a hook that
      // reaches its timeout lets the write through. The adapter refuses before that.
      PreToolUse: [
        {
          matcher: FILE_WRITING_MATCHER,
          hooks: [{ type: 'command', command: preWrite, timeout: PRE_WRITE_TIMEOUTS.hookSeconds }],
        },
      ],
      PostToolUse: [
        {
          matcher: FILE_WRITING_MATCHER,
          hooks: [
            { type: 'command', command: postWrite, timeout: POST_WRITE_TIMEOUTS.hookSeconds },
          ],
        },
      ],
      Stop: [
        {
          hooks: [
            { type: 'command', command: spendCommand, timeout: SPEND_HOOK_TIMEOUTS.hookSeconds },
          ],
        },
      ],
    },
    // No `MCP_TOOL_TIMEOUT`: the session server's `await_answer` waits 45 seconds,
    // under the 60 seconds after which the engine's client gives a silent call up.
    env: { [SESSION_ID_ENV]: input.sessionId },
  };
}

/** The tools that write a file, which a guarded session leaves to the before-write adapter. */
const FILE_WRITING_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'] as const;

/**
 * The content of `settings.json` for a session of a Space with standard-file
 * Lore (`standard-lore.ts`, ai-lore#144). It has no `PreToolUse` and no
 * `PostToolUse` hook, so no check runs on a write, and it allows the
 * file-writing tools, so a write does not ask. It sets no `defaultMode` and no
 * deny rule: the engine is started without `--setting-sources ''`
 * (`engineArgv`), so the Space's committed `.claude/settings.json` and the
 * Human Lead's own settings decide the rest. The `Stop` hook that reports what
 * the session spent is kept.
 */
export function buildStandardSessionSettings(
  input: Pick<SessionFilesInput, 'sessionId' | 'python' | 'connection'>,
  paths: SessionFilePaths,
): {
  permissions: { allow: string[] };
  hooks: { Stop: StopHookEntry[] };
  env: Record<string, string>;
} {
  const spendCommand = shellCommandLine([
    input.python,
    paths.spendHook,
    '--out',
    paths.spend,
    '--adapter-seconds',
    String(SPEND_HOOK_TIMEOUTS.adapterSeconds),
  ]);
  return {
    permissions: {
      allow: ['Read', 'Grep', 'Glob', ...FILE_WRITING_TOOLS, ...sessionToolNames(input.connection)],
    },
    hooks: {
      Stop: [
        {
          hooks: [
            { type: 'command', command: spendCommand, timeout: SPEND_HOOK_TIMEOUTS.hookSeconds },
          ],
        },
      ],
    },
    env: { [SESSION_ID_ENV]: input.sessionId },
  };
}

/** The content of `mcp.json`, as an object. It holds the session's token. */
export function buildSessionMcpConfig(connection: SessionConnection): {
  mcpServers: Record<string, { type: 'http'; url: string; headers: Record<string, string> }>;
} {
  return {
    mcpServers: {
      [connection.serverName]: {
        type: 'http',
        url: connection.url,
        headers: { [connection.header.name]: connection.header.value },
      },
    },
  };
}

async function makePrivateDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: SESSION_DIR_MODE });
  // `mkdir` applies the process's umask, and leaves a folder that exists as it is.
  await chmod(path, SESSION_DIR_MODE);
}

async function writePrivateFile(path: string, content: string): Promise<void> {
  // `wx`: a file that is already there is not written through. A session's folder is new.
  await writeFile(path, content, { mode: SESSION_FILE_MODE, flag: 'wx' });
  await chmod(path, SESSION_FILE_MODE);
}

/**
 * A `LaunchFile` path, joined to the session's folder. Refuses a path that is
 * absolute, holds `..` as a segment, or a NUL character (M10.5).
 */
function launchFilePath(dir: string, relative: string): string {
  if (isAbsolute(relative) || relative.includes('\0') || relative.split('/').includes('..')) {
    throw new Error(`an adapter named a file outside the session folder: ${relative}`);
  }
  return join(dir, ...relative.split('/'));
}

/**
 * Write the files of one session: the two Python adapters, then each file of
 * `launch` (M10.5, `engines/types.ts` `LaunchFile`). The session's folder must
 * not exist yet. On a failure the folder is removed again and the error is
 * thrown.
 */
export async function writeSessionFiles(
  sessionsDir: string,
  input: { sessionId: string },
  launch: SessionLaunch,
): Promise<SessionFilePaths> {
  const paths = sessionFilePaths(sessionsDir, input.sessionId);
  await makePrivateDir(dirname(paths.dir));
  // Not recursive: a folder that exists belongs to something else, and the call fails.
  await mkdir(paths.dir, { mode: SESSION_DIR_MODE });
  try {
    await chmod(paths.dir, SESSION_DIR_MODE);
    await makePrivateDir(paths.hooksDir);
    await writePrivateFile(paths.preWrite, PRE_WRITE_ADAPTER);
    await writePrivateFile(paths.postWrite, POST_WRITE_ADAPTER);
    // Written for every engine, as the two adapters above are: only Claude Code's
    // settings.json wires it up as a Stop hook (M14.6), and it is otherwise unused.
    await writePrivateFile(paths.spendHook, SPEND_ADAPTER);
    for (const file of launch.files) {
      const target = launchFilePath(paths.dir, file.path);
      await makePrivateDir(dirname(target));
      await writePrivateFile(target, file.content);
    }
  } catch (caught) {
    await removeSessionFiles(sessionsDir, input.sessionId);
    throw caught;
  }
  return paths;
}

/** Remove the folder of one session. A folder that is not there is not an error. */
export async function removeSessionFiles(sessionsDir: string, sessionId: string): Promise<void> {
  await rm(join(sessionsDir, sessionId), { recursive: true, force: true });
}

/** One refusal the before-write adapter noted. */
export type NotedRefusal = { at: string; kind: string; tool: string; path: string; reason: string };

/** The refusals the before-write adapter noted for the session, oldest first; at most `limit`. */
export async function readNotedRefusals(
  paths: SessionFilePaths,
  limit: number,
): Promise<NotedRefusal[]> {
  let text: string;
  try {
    text = await readFile(paths.refusals, 'utf8');
  } catch {
    return [];
  }
  const refusals: NotedRefusal[] = [];
  for (const line of text.split('\n')) {
    if (refusals.length >= limit) break;
    if (line.trim() === '') continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== 'object' || parsed === null) continue;
      const record = parsed as Record<string, unknown>;
      refusals.push({
        at: String(record.at ?? ''),
        kind: String(record.kind ?? ''),
        tool: String(record.tool ?? ''),
        path: String(record.path ?? ''),
        reason: String(record.reason ?? ''),
      });
    } catch {
      // A line that is not JSON is left out: the session can write this file through the shell.
    }
  }
  return refusals;
}

/**
 * What a session's `spend.json` reads as (M14.6). `{ source: 'none' }` for a
 * missing file, one that is not JSON, or one that is not a well-formed
 * `SessionSpend` — a malformed or unwritten file is never read as a number,
 * and never throws.
 */
export async function readSessionSpend(paths: SessionFilePaths): Promise<SessionSpend> {
  const NO_SPEND: SessionSpend = { source: 'none' };
  let text: string;
  try {
    text = await readFile(paths.spend, 'utf8');
  } catch {
    return NO_SPEND;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return NO_SPEND;
  }
  return isSessionSpend(parsed) ? parsed : NO_SPEND;
}

/**
 * Remove the session folders under `sessionsDir` that `keep` does not name.
 * Returns the names removed. Only folders are looked at, and a symbolic link
 * is removed as a link, not followed.
 */
export async function removeSessionFoldersExcept(
  sessionsDir: string,
  keep: ReadonlySet<string>,
): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(sessionsDir);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const name of names) {
    if (keep.has(name)) continue;
    const path = join(sessionsDir, name);
    try {
      const info = await lstat(path);
      if (!info.isDirectory() && !info.isSymbolicLink()) continue;
      await rm(path, { recursive: true, force: true });
      removed.push(name);
    } catch {
      // Left for the next start of the app.
    }
  }
  return removed;
}
