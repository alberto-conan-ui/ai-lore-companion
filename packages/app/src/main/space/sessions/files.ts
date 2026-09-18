/**
 * The generated files of one guarded session (phase M4.4), in
 * `<userData>/spaces/<key>/sessions/<session id>/`:
 *
 *   settings.json        permissions, the two hooks, `env`
 *   mcp.json             the session server's address and the session's token
 *   hooks/pre-write.py   the before-write adapter
 *   hooks/post-write.py  the after-write adapter
 *
 * The folder and `hooks/` have mode 0700 and every file 0600 (architecture
 * document, section 5.14): the folder is outside the Space, and `mcp.json`
 * holds the token. The folder is removed when the session ends.
 */

import { chmod, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SessionConnection } from '../session-server/index.js';
import { POST_WRITE_ADAPTER, PRE_WRITE_ADAPTER } from './adapters.js';
import { hookArgv, shellCommandLine } from './command-line.js';
import {
  FILE_WRITING_MATCHER,
  POST_WRITE_TIMEOUTS,
  PRE_WRITE_TIMEOUTS,
  SESSION_DIR_MODE,
  SESSION_FILES,
  SESSION_FILE_MODE,
  SESSION_ID_ENV,
} from './constants.js';
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

/** The content of `settings.json`, as an object. */
export function buildSessionSettings(
  input: SessionFilesInput,
  paths: SessionFilePaths,
): {
  permissions: ReturnType<typeof sessionPermissions>;
  hooks: { PreToolUse: HookEntry[]; PostToolUse: HookEntry[] };
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
    }),
  );
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
    },
    // No `MCP_TOOL_TIMEOUT`: the session server's `await_answer` waits 45 seconds,
    // under the 60 seconds after which the engine's client gives a silent call up.
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
 * Write the files of one session. The session's folder must not exist yet. On
 * a failure the folder is removed again and the error is thrown.
 */
export async function writeSessionFiles(
  sessionsDir: string,
  input: SessionFilesInput,
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
    await writePrivateFile(
      paths.mcp,
      `${JSON.stringify(buildSessionMcpConfig(input.connection), null, 2)}\n`,
    );
    await writePrivateFile(
      paths.settings,
      `${JSON.stringify(buildSessionSettings(input, paths), null, 2)}\n`,
    );
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
