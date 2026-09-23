/**
 * The guarded AI sessions of one Space (phase M4.4), as a service of its
 * context.
 *
 * Starting a session, in this order (architecture document, section 5.6):
 * check the engine, `python3` and the install; record the session on the desk
 * in Read only (`startSession`); register it on the session server (its token
 * is returned once); write the session's folder; spawn the engine in the Space
 * window's PTY with the Space's folder as working directory and the session's
 * id in `SESSION_ID_ENV`. A step that fails undoes the steps before it.
 *
 * Ending a session, when its engine exits or when the window asks: the
 * refusals the adapter noted go into the log, the desk records the end with
 * the present commit of each root the session held (`endSession` with
 * `closes`), the session's issue on the Agents board takes the handover and
 * moves to Done (phase M4.7, bounded by `BOARD_UPDATE_WAIT_MS`), the session
 * leaves the server, and its folder is removed.
 *
 * When the service is built (the first time a Space's sessions are used in
 * this run of the app) it removes the session folders of that desk that no
 * open session record names: a session that was running when the app stopped
 * left its folder, and its token died with the app.
 */

import { randomBytes } from 'node:crypto';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type CommandRunner,
  type EngineCheck,
  type EngineEntry,
  type SessionPurpose,
  type SessionSpend,
  endSession,
  engineNameOf,
  listSessions,
  profileOf,
  readLore,
  splitParamText,
  startSession,
} from '@ai-lore-companion/core';
import type { DashboardRefreshReason } from '../../../shared/ipc/space/dashboard-report.types.js';
import type { SpaceContext } from '../context.js';
import { defineSpaceService } from '../context.js';
import type { DashboardReportService } from '../dashboard-report.js';
import { spaceDesk } from '../desk-service.js';
import { spaceProjectRefresh } from '../project-refresh.js';
import { spaceRepositories } from '../repositories.js';
import { type BoardNote, boardWithin, sessionBoard } from '../session-server/board.js';
import { BOARD_UPDATE_WAIT_MS } from '../session-server/constants.js';
import { sessionCloseCommits, sessionServer } from '../session-server/index.js';
import { loreTemplateDir } from '../template-dir.js';
import { spaceUi } from '../ui-store.js';
import {
  DASHBOARD_REFRESH_TIMEOUT_MS,
  MAX_LOGGED_REFUSALS,
  REQUIRED_CHECKS,
  SESSION_ID_ENV,
} from './constants.js';
import { paramEffect } from './engine-options.js';
import { adapterFor } from './engines/index.js';
import { sessionInstructions } from './engines/instructions.js';
import { readInstalledSkills } from './engines/skills.js';
import type { EngineAdapter } from './engines/types.js';
import {
  type SessionFilePaths,
  readNotedRefusals,
  removeSessionFiles,
  removeSessionFoldersExcept,
  sessionFilePaths,
  writeSessionFiles,
} from './files.js';
import {
  type SessionStartFailure,
  type VerifiedInstall,
  checkSessionEngine,
  checkStartParams,
  findPython3,
  verifyInstall,
} from './preflight.js';
import { hasStandardLore } from './standard-lore.js';

/** A started session, as the window receives it. */
export type StartedSession = {
  sessionId: string;
  ptyId: string;
  engineId: string;
  /** The guard-changing options this start's parameters held, by name. Empty when none. */
  unguarded: string[];
};

export type StartedSessionResult =
  | { ok: true; value: StartedSession }
  | { ok: false; error: SessionStartFailure };

export type DashboardUpdateResult = {
  requestId: string;
  definitionHash: string;
  status: 'requested' | 'updating' | 'updated' | 'failed';
  coalesced?: boolean;
  message?: string;
};

/** What is ready for a start: the engine, `python3` and the install. */
export type SessionReadiness =
  | {
      ok: true;
      value: {
        engine: EngineEntry;
        python: string;
        install: VerifiedInstall;
        /** The count of `readInstalledSkills`, for the Lore readiness report (M10.5). */
        skillCount: number;
        /** The Space has an `AGENTS.md` (`standard-lore.ts`, ai-lore#144). */
        standardLore?: boolean;
      };
    }
  | { ok: false; error: SessionStartFailure };

export type SpaceSessions = {
  /** Check what a start needs, without starting. */
  readiness(engineId: string): Promise<SessionReadiness>;
  /** `params` are the ticked parameters' texts; every one must be a parameter of the engine now. */
  start(engineId: string, params: readonly string[]): Promise<StartedSessionResult>;
  /** Ensure this window-owned Space has one automatic PM session. */
  ensurePm(): Promise<StartedSessionResult>;
  /** Queue one transient guarded PM refresh; concurrent requests share the pending request. */
  requestDashboardUpdate(
    requesterSessionId?: string,
    reason?: DashboardRefreshReason,
  ): Promise<DashboardUpdateResult>;
  /** End a session of this service. `false` when it has no such session. The engine is stopped. */
  end(sessionId: string): Promise<boolean>;
  /** The ids of the sessions running now. */
  live(): string[];
};

/** What the service takes from its surroundings. A headless test replaces them. */
export type SpaceSessionParts = {
  /** The engines of the app's registry. */
  engines: () => readonly EngineEntry[];
  /** The `PATH` to look for `python3` with; `null` uses the app's own. */
  loginPath: () => Promise<string | null>;
  runner: (context: SpaceContext) => CommandRunner;
  /** A new session id. */
  newId: () => string;
  /** Whether `engine` is installed and signed in (A.10). Default: `probeEngineOfApp`. */
  probeEngine: (engine: EngineEntry) => Promise<EngineCheck>;
  /** Timeout for a transient dashboard refresh; tests use a short bound. */
  dashboardRefreshTimeoutMs?: number;
};

let parts: SpaceSessionParts | null = null;

/** Set what the service is built with. The app sets it once from `main/space/ipc/sessions.ts`; a test sets its own. */
export function configureSpaceSessions(next: SpaceSessionParts): void {
  parts = next;
}

/**
 * A session id: `s-`, the date and time in UTC, and six random hexadecimal
 * characters, for example `s-20260918-2048-a1b2c3`. It matches the form the
 * session server and journal-append-forward accept.
 */
export function newSessionId(now: Date = new Date()): string {
  const iso = now.toISOString();
  const stamp = `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 16).replace(':', '')}`;
  return `s-${stamp}-${randomBytes(3).toString('hex')}`;
}

type Live = {
  ptyId: string | null;
  engineId: string;
  purpose?: SessionPurpose;
  paths: SessionFilePaths;
  ending: Promise<void> | null;
  adapter: EngineAdapter;
};

/** What a session's close records when its engine reported nothing readable. */
const NO_SPEND: SessionSpend = { source: 'none' };

/** The first user turn of every new PM process. The CLI submits it after its own startup UI. */
export const PM_INITIAL_PROMPT =
  'You are the PM. Read get_dashboard_context first, then update the dashboard by calling report_dashboard with complete typed values.';

function isPmPurpose(purpose: SessionPurpose | undefined): boolean {
  return purpose === 'pm' || purpose === 'dashboard-refresh';
}

type RefreshRun = {
  requestId: string;
  definitionHash: string;
  requesterSessionId?: string;
  sessionId: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  starting: Promise<void> | null;
  done: boolean;
};

function optionWithValue(argv: readonly string[], long: string, short?: string): boolean {
  if (argv.length === 1 && argv[0]?.startsWith(`${long}=`)) return true;
  if (argv.length === 2 && (argv[0] === long || (short !== undefined && argv[0] === short)))
    return argv[1] !== '';
  if (short !== undefined && argv.length === 1 && argv[0]?.startsWith(short))
    return argv[0].length > short.length;
  return false;
}

/**
 * PM startup adds one native initial prompt. Default-on parameters are
 * therefore deliberately narrower than ordinary session parameters: accept
 * only shapes known not to select a subcommand, add another prompt, or consume
 * the trailing positional prompt as a variadic option.
 */
export function pmInitialPromptParamConflict(
  adapter: Pick<EngineAdapter, 'catalogId'>,
  params: readonly string[],
): string | null {
  for (const text of params) {
    const argv = splitParamText(text);
    let safe = false;
    switch (adapter.catalogId) {
      case 'claude-code':
        safe =
          optionWithValue(argv, '--model') ||
          optionWithValue(argv, '--effort') ||
          (argv.length === 1 && ['--chrome', '--no-chrome'].includes(argv[0] as string));
        break;
      case 'codex': {
        const config =
          argv.length === 2 && (argv[0] === '-c' || argv[0] === '--config')
            ? argv[1]
            : argv.length === 1 && (argv[0]?.startsWith('-c=') || argv[0]?.startsWith('--config='))
              ? argv[0].slice(argv[0].indexOf('=') + 1)
              : argv.length === 1 && argv[0]?.startsWith('-c') && argv[0].length > 2
                ? argv[0].slice(2)
                : undefined;
        safe =
          optionWithValue(argv, '--model', '-m') ||
          (config !== undefined && /^\s*(?:model|model_reasoning_effort)\s*=/.test(config)) ||
          (argv.length === 1 && argv[0] === '--no-alt-screen');
        break;
      }
      case 'opencode':
        safe =
          optionWithValue(argv, '--model', '-m') ||
          (argv.length === 1 && ['--mini', '--no-replay'].includes(argv[0] as string));
        break;
      case 'antigravity':
        safe = false;
        break;
    }
    if (!safe) return text;
  }
  return null;
}

function describe(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/** The two corpus cards the PM reads. A Space's resolved card wins; an older Space gets the shipped default. */
async function pmCorpusPaths(
  spaceRoot: string,
): Promise<{ ok: true; value: string[] } | { ok: false; message: string }> {
  const names = ['pm', 'dashboard'];
  const lore = await readLore(spaceRoot);
  if (!lore.ok) {
    return { ok: false, message: `the Space Lore could not be read (${lore.error.message})` };
  }
  const resolved = new Map(
    lore.value.parts.corpus
      .filter((entry) => names.includes(entry.name))
      .map((entry) => [entry.name, entry.path]),
  );
  const template = loreTemplateDir();
  if (!template.ok && names.some((name) => !resolved.has(name))) {
    return {
      ok: false,
      message: `the shipped PM corpus is unavailable (${template.error.message})`,
    };
  }
  const paths = names.flatMap((name) => {
    const own = resolved.get(name);
    if (own !== undefined) return [own];
    return template.ok ? [join(template.value, 'lore', 'corpus', 'default', `${name}.md`)] : [];
  });
  try {
    await Promise.all(paths.map((path) => access(path)));
  } catch (caught) {
    return { ok: false, message: `the PM corpus card cannot be read (${describe(caught)})` };
  }
  return { ok: true, value: paths };
}

function createSpaceSessions(context: SpaceContext, use: SpaceSessionParts): Held {
  // The server first (it builds the desk first), so both are disposed after this service.
  const server = context.service(sessionServer);
  const desk = context.service(spaceDesk);
  const board = context.service(sessionBoard);
  const live = new Map<string, Live>();
  let pmSessionId: string | null = null;
  let pmStarting: Promise<StartedSessionResult> | null = null;
  let refreshRun: RefreshRun | null = null;
  let disposing = false;

  type DashboardServiceLike = Pick<
    DashboardReportService,
    'definition' | 'refreshContext' | 'request' | 'attachRequest' | 'beginRequest' | 'failRequest'
  >;

  const dashboardService = (): DashboardServiceLike => {
    const service = server.getDashboardService();
    if (service === null) throw new Error('The dashboard report service is unavailable.');
    return service;
  };

  function failRefresh(run: RefreshRun, kind: string, message: string): void {
    if (run.done) return;
    run.done = true;
    if (run.timer !== null) clearTimeout(run.timer);
    dashboardService().failRequest(run.requestId, { kind, message });
    if (refreshRun === run) refreshRun = null;
    // `failRefresh` can run from `finish` itself. Deferring the end lets
    // `ended` publish its in-flight promise before we try to end the same
    // entry again.
    if (run.sessionId !== null) setImmediate(() => void end(run.sessionId as string));
  }

  function observeDashboardReport(sessionId: string, input: unknown, result: unknown): void {
    const run = refreshRun;
    if (run === null || run.done) return;
    if (run.sessionId !== sessionId) return;
    if (result === null || typeof result !== 'object') return;
    if ((result as { ok?: unknown }).ok !== true) {
      const error = (result as { error?: { kind?: unknown; message?: unknown } }).error;
      failRefresh(
        run,
        typeof error?.kind === 'string' ? error.kind : 'invalid-report',
        typeof error?.message === 'string'
          ? error.message
          : 'The PM dashboard report was rejected.',
      );
      return;
    }
    if (
      input === null ||
      typeof input !== 'object' ||
      (input as { definitionHash?: unknown }).definitionHash !== run.definitionHash
    ) {
      failRefresh(
        run,
        'stale-definition',
        'The dashboard definition changed while the refresh was running.',
      );
      return;
    }
    run.done = true;
    if (run.timer !== null) clearTimeout(run.timer);
    if (refreshRun === run) refreshRun = null;
    // Let the MCP response leave the process before unregistering the transient session.
    setImmediate(() => void end(sessionId));
  }

  function guardDashboardReport(
    sessionId: string,
    input: unknown,
  ): { ok: true } | { ok: false; error: { kind: string; message: string } } {
    const run = refreshRun;
    if (run === null || run.done) return { ok: true };
    if (run.sessionId !== sessionId) {
      return {
        ok: false,
        error: {
          kind: 'request-mismatch',
          message: 'This dashboard refresh session is not the current transient request.',
        },
      };
    }
    if (
      input === null ||
      typeof input !== 'object' ||
      (input as { definitionHash?: unknown }).definitionHash !== run.definitionHash
    ) {
      failRefresh(
        run,
        'stale-definition',
        'This dashboard refresh used an obsolete definition. Request a new update.',
      );
      return {
        ok: false,
        error: {
          kind: 'stale-definition',
          message: 'This dashboard refresh used an obsolete definition. Request a new update.',
        },
      };
    }
    return { ok: true };
  }

  server.setDashboardReportObserver(observeDashboardReport);
  server.setDashboardReportGuard(guardDashboardReport);
  server.setDashboardUpdateHandler((requesterSessionId) =>
    requestDashboardUpdate(requesterSessionId),
  );

  const cleanup = (async () => {
    const opened = desk.open();
    if (!opened.ok) return;
    const records = listSessions(opened.value);
    if (!records.ok) return;
    const keep = new Set(records.value.filter((s) => s.closedAt === undefined).map((s) => s.id));
    const removed = await removeSessionFoldersExcept(context.desk.sessions, keep);
    for (const id of removed)
      context.log.info('session-folder-removed', { space: context.key, session: id });
  })().catch((caught: unknown) => {
    context.log.warn('session-folder-cleanup-failed', {
      space: context.key,
      message: describe(caught),
    });
  });

  async function readiness(engineId: string): Promise<SessionReadiness> {
    const engine = checkSessionEngine(use.engines(), engineId);
    if (!engine.ok) return engine;
    const probed = await use.probeEngine(engine.value);
    if (probed.installed.kind === 'missing') {
      return {
        ok: false,
        error: {
          kind: 'engine-not-installed',
          message: `No AI session was started: ${engine.value.name} is not installed.`,
        },
      };
    }
    if (probed.signIn.kind === 'not-signed-in') {
      return {
        ok: false,
        error: {
          kind: 'engine-not-signed-in',
          message: `No AI session was started: ${engine.value.name} is installed and not signed in.`,
        },
      };
    }
    const python = await findPython3(use.runner(context), await use.loginPath(), context.root);
    if (!python.ok) return python;
    const install = await verifyInstall(context.desk.install);
    if (!install.ok) return install;
    if (!install.value.beforeChecks[0]?.endsWith(REQUIRED_CHECKS[0])) {
      return {
        ok: false,
        error: {
          kind: 'check-missing',
          message: `No AI session was started: the install does not run ${REQUIRED_CHECKS[0]} before a write. Install the Lore again.`,
        },
      };
    }
    const skills = await readInstalledSkills(context.desk.install, context.root);
    return {
      ok: true,
      value: {
        engine: engine.value,
        python: python.value,
        install: install.value,
        skillCount: skills.length,
        standardLore: await hasStandardLore(context.root),
      },
    };
  }

  async function finish(sessionId: string, entry: Live): Promise<void> {
    if (entry.purpose === 'dashboard-refresh' && refreshRun?.sessionId === sessionId) {
      failRefresh(
        refreshRun,
        'engine-exited',
        'The transient PM refresh session ended before it reported dashboard data.',
      );
    }
    /** What the Agents board answered for the handover, and `null` when the session has no issue. */
    let handover: BoardNote | null = null;
    const refusals = await readNotedRefusals(entry.paths, MAX_LOGGED_REFUSALS);
    for (const refusal of refusals) {
      context.log.info('write-guard-refused', {
        space: context.key,
        session: sessionId,
        kind: refusal.kind,
        tool: refusal.tool,
        path: refusal.path,
        reason: refusal.reason,
      });
    }
    const spend = entry.adapter.readSpend
      ? await entry.adapter.readSpend({ sessionId, paths: entry.paths }).catch(() => NO_SPEND)
      : NO_SPEND;
    // Remove the MCP token (and a PM's report publishing right) before the desk
    // reflects the end, so no call can arrive for a session already marked closed.
    await server.unregisterSession(sessionId);
    const opened = desk.open();
    if (opened.ok) {
      const closes = await sessionCloseCommits(context, opened.value, sessionId);
      const ended = endSession(opened.value, sessionId, { closes, spend });
      if (!ended.ok) {
        context.log.warn('session-end-not-recorded', {
          space: context.key,
          session: sessionId,
          kind: ended.error.kind,
        });
      }
      // The session's issue, when it has one, takes the handover and moves to Done.
      // The note says whether it landed: a handover that did not reach GitHub is the
      // session's whole record of itself, so the reason is carried to `session-ended`
      // below rather than left in the board's own log line (the Space's issue #58).
      handover = await boardWithin(board.closed(sessionId), BOARD_UPDATE_WAIT_MS);
    } else {
      context.log.warn('session-end-not-recorded', {
        space: context.key,
        session: sessionId,
        kind: opened.error.kind,
      });
    }
    await removeSessionFiles(context.desk.sessions, sessionId);
    live.delete(sessionId);
    if (entry.purpose === 'pm' && pmSessionId === sessionId) pmSessionId = null;
    context.log.info('session-ended', {
      space: context.key,
      session: sessionId,
      ...(handover === null
        ? {}
        : handover.updated
          ? { handover: handover.issue }
          : { handoverFailed: handover.message }),
    });
  }

  function ended(sessionId: string): Promise<void> {
    const entry = live.get(sessionId);
    if (!entry) return Promise.resolve();
    entry.ending ??= finish(sessionId, entry).catch((caught: unknown) => {
      live.delete(sessionId);
      context.log.error('session-end-failed', {
        space: context.key,
        session: sessionId,
        message: describe(caught),
      });
    });
    return entry.ending;
  }

  async function start(
    engineId: string,
    params: readonly string[],
    purpose?: SessionPurpose,
    requestId?: string,
    onSessionId?: (sessionId: string) => void,
  ): Promise<StartedSessionResult> {
    await cleanup;
    if (disposing) {
      return {
        ok: false,
        error: {
          kind: 'start-failed',
          message: 'No AI session was started: the Space window is closing.',
        },
      };
    }
    const pty = context.ptyService;
    if (!pty) {
      return {
        ok: false,
        error: {
          kind: 'no-terminal',
          message: 'No AI session was started: the Space window has no terminal service.',
        },
      };
    }
    const ready = await readiness(engineId);
    if (!ready.ok) {
      context.log.warn('session-not-started', { space: context.key, kind: ready.error.kind });
      return ready;
    }
    const { engine, python, install } = ready.value;
    const checked = checkStartParams(engine, params);
    if (!checked.ok) {
      context.log.warn('session-not-started', { space: context.key, kind: checked.error.kind });
      return checked;
    }
    const adapter = adapterFor(engine);
    if (adapter === null) {
      const message = `No AI session was started: a guarded session in a Space is started with Claude Code only, and "${engine.name}" is not Claude Code.`;
      context.log.warn('session-not-started', { space: context.key, kind: 'engine-not-supported' });
      return { ok: false, error: { kind: 'engine-not-supported', message } };
    }
    if (isPmPurpose(purpose) && !adapter.supportsInitialPrompt) {
      return {
        ok: false,
        error: {
          kind: 'engine-not-supported',
          message: `No PM session was started: ${engine.name} has no verified way to give a visible interactive session its automatic first dashboard request. Choose Claude Code or Codex CLI for the PM.`,
        },
      };
    }
    const profile = profileOf(engine);
    // A configured profile owns model selection. Letting a clicked parameter add another model
    // makes the engine's precedence part of the security and product contract, so refuse it.
    if (profile.model !== undefined && adapter.modelsSelectedBy(checked.value.argv).length > 0) {
      return {
        ok: false,
        error: {
          kind: 'invalid-argument',
          message: `No AI session was started: ${engine.name}'s profile already selects model ${profile.model}; remove the model parameter from this start.`,
        },
      };
    }
    const modelArgs = adapter.modelArgs(profile.model ?? '');
    const modelEffect = paramEffect(adapter.options, modelArgs);
    if (modelEffect.effect === 'refused') {
      return {
        ok: false,
        error: {
          kind: 'engine-not-supported',
          message: `No AI session was started: the configured model of ${engine.name} uses ${modelEffect.options[0] ?? 'an option'} that the companion reserves.`,
        },
      };
    }
    const unguarded = [...checked.value.unguarded, ...modelEffect.options];
    if (isPmPurpose(purpose) && unguarded.length > 0) {
      return {
        ok: false,
        error: {
          kind: 'engine-not-supported',
          message: `No PM session was started: its configured parameters change the guard (${unguarded.join(', ')}). Remove them from the PM profile.`,
        },
      };
    }
    if (isPmPurpose(purpose)) {
      const conflicting = pmInitialPromptParamConflict(adapter, params);
      if (conflicting !== null) {
        return {
          ok: false,
          error: {
            kind: 'invalid-argument',
            message: `No PM session was started: the default parameter "${conflicting}" is not safe with the automatic first dashboard request. Untick it for the PM profile.`,
          },
        };
      }
    }
    const engineArgs = [...modelArgs, ...checked.value.argv];
    const pmCorpus = isPmPurpose(purpose) ? await pmCorpusPaths(context.root) : null;
    if (pmCorpus !== null && !pmCorpus.ok) {
      return {
        ok: false,
        error: {
          kind: 'session-files-failed',
          message: `No PM session was started: its role instructions are unavailable because ${pmCorpus.message}.`,
        },
      };
    }
    const opened = desk.open();
    if (!opened.ok || !opened.value.writable) {
      return {
        ok: false,
        error: {
          kind: 'desk-unavailable',
          message: opened.ok
            ? 'No AI session was started: another running companion holds the desk of this Space.'
            : `No AI session was started: the desk of this Space cannot be opened (${opened.error.message}).`,
        },
      };
    }
    const sessionId = use.newId();
    onSessionId?.(sessionId);
    const recorded = startSession(opened.value, {
      id: sessionId,
      engine: engine.id,
      ...(unguarded.length > 0 ? { unguarded } : {}),
      profile: {
        id: profile.id,
        name: profile.name,
        engine: engineNameOf(profile),
        ...(profile.model !== undefined ? { model: profile.model } : {}),
      },
      params: [...params],
      ...(purpose !== undefined ? { purpose } : {}),
    });
    if (!recorded.ok) {
      return {
        ok: false,
        error: {
          kind: 'desk-unavailable',
          message: `No AI session was started: the session could not be recorded (${recorded.error.message}).`,
        },
      };
    }
    // The session's issue is created now, in Read only, and not when the
    // session first writes. The Project is writable in Read only, so a reading
    // session can restructure the whole plan and leave nothing on the board to
    // say who did it — one created 38 issues and closed 37 that way, and its
    // issue had to be written by hand afterwards. The board is not waited for:
    // GitHub being slow or unreachable must not stop a session starting.
    void boardWithin(board.started(sessionId), BOARD_UPDATE_WAIT_MS).catch((caught: unknown) => {
      context.log.warn('board-session-started-failed', {
        space: context.key,
        session: sessionId,
        reason: caught instanceof Error ? caught.message : String(caught),
      });
    });
    const undoRecord = () => {
      const undone = endSession(opened.value, sessionId);
      if (!undone.ok)
        context.log.warn('session-end-not-recorded', {
          space: context.key,
          session: sessionId,
          kind: undone.error.kind,
        });
    };
    const connection = isPmPurpose(purpose)
      ? await server.registerSession(sessionId, { purpose, ...(requestId ? { requestId } : {}) })
      : await server.registerSession(sessionId);
    if (!connection.ok) {
      undoRecord();
      return {
        ok: false,
        error: {
          kind: 'session-server-unavailable',
          message: `No AI session was started: the companion's session server did not take the session (${connection.error.message}).`,
        },
      };
    }
    const paths = sessionFilePaths(context.desk.sessions, sessionId);
    const repositories = context.manifest.repositories.map((repository) => repository.name);
    const skills = await readInstalledSkills(context.desk.install, context.root);
    // A PM session stays guarded whatever the Space's Lore is: its role is Read only by design.
    const standardLore =
      ready.value.standardLore === true &&
      adapter.supportsStandardLore === true &&
      !isPmPurpose(purpose);
    const instructions = sessionInstructions({
      spaceRoot: context.root,
      skills,
      adapter,
      ...(standardLore ? { standardLore } : {}),
      ...(isPmPurpose(purpose) ? { purpose, pmCorpusPaths: pmCorpus?.value ?? [] } : {}),
    });
    let launch: ReturnType<typeof adapter.launch>;
    try {
      launch = adapter.launch({
        sessionId,
        spaceRoot: context.root,
        deskDir: context.desk.desk,
        paths,
        python,
        install,
        skills,
        connection: connection.value,
        repositories,
        instructions,
        paramArgv: engineArgs,
        ...(standardLore ? { standardLore } : {}),
        ...(isPmPurpose(purpose) ? { initialPrompt: PM_INITIAL_PROMPT } : {}),
      });
    } catch (caught) {
      await server.unregisterSession(sessionId);
      undoRecord();
      return {
        ok: false,
        error: {
          kind: 'session-files-failed',
          message: `No AI session was started: its files could not be written (${describe(caught)}).`,
        },
      };
    }
    try {
      await writeSessionFiles(context.desk.sessions, { sessionId }, launch);
    } catch (caught) {
      await server.unregisterSession(sessionId);
      undoRecord();
      return {
        ok: false,
        error: {
          kind: 'session-files-failed',
          message: `No AI session was started: its files could not be written (${describe(caught)}).`,
        },
      };
    }
    if (disposing) {
      await server.unregisterSession(sessionId);
      await removeSessionFiles(context.desk.sessions, sessionId);
      undoRecord();
      return {
        ok: false,
        error: {
          kind: 'start-failed',
          message: 'No AI session was started: the Space window is closing.',
        },
      };
    }
    const entry: Live = {
      ptyId: null,
      engineId: engine.id,
      ...(purpose !== undefined ? { purpose } : {}),
      paths,
      ending: null,
      adapter,
    };
    live.set(sessionId, entry);
    try {
      entry.ptyId = pty.spawn(
        { binary: engine.binary, args: launch.args },
        {
          cwd: context.root,
          env: { ...launch.env, [SESSION_ID_ENV]: sessionId },
          onExit: () => void ended(sessionId),
        },
      );
    } catch (caught) {
      await ended(sessionId);
      return {
        ok: false,
        error: {
          kind: 'start-failed',
          message: `No AI session was started: the engine could not be started (${describe(caught)}).`,
        },
      };
    }
    // The token is not logged; the session id, the engine and any unguarded options are.
    context.log.info('session-started', {
      space: context.key,
      session: sessionId,
      engine: engine.id,
      unguarded,
    });
    return {
      ok: true,
      value: { sessionId, ptyId: entry.ptyId, engineId: engine.id, unguarded },
    };
  }

  /** The default-on parameters of an engine. PM starts run them only when none changes the guard. */
  function defaultParams(engine: EngineEntry): string[] {
    return (engine.params ?? []).filter((param) => param.defaultOn).map((param) => param.text);
  }

  async function choosePmEngine(): Promise<
    { ok: true; engine: EngineEntry } | { ok: false; error: SessionStartFailure }
  > {
    const ui = context.service(spaceUi);
    const bound = ui.read('pm-profile').state?.engineId;
    const explicit = typeof bound === 'string' ? bound : null;
    if (explicit !== null) {
      const engine = use.engines().find((candidate) => candidate.id === explicit);
      if (engine === undefined)
        return {
          ok: false,
          error: {
            kind: 'engine-not-found',
            message: `No PM session was started: the configured engine "${explicit}" is not available.`,
          },
        };
      return { ok: true, engine };
    }
    const remembered = ui.read('session-engine').state?.engineId;
    if (typeof remembered === 'string' && (await readiness(remembered)).ok) {
      const engine = use.engines().find((candidate) => candidate.id === remembered);
      if (engine !== undefined && adapterFor(engine)?.supportsInitialPrompt === true)
        return { ok: true, engine };
    }
    for (const candidate of use.engines()) {
      if (
        adapterFor(candidate)?.supportsInitialPrompt === true &&
        (await readiness(candidate.id)).ok
      )
        return { ok: true, engine: candidate };
    }
    return {
      ok: false,
      error: {
        kind: 'engine-not-supported',
        message:
          'No PM session was started: no configured engine is ready for a guarded Space session.',
      },
    };
  }

  async function runDashboardRefresh(run: RefreshRun): Promise<void> {
    const selected = await choosePmEngine();
    if (!selected.ok) {
      failRefresh(run, selected.error.kind, selected.error.message);
      return;
    }
    if (run.done) return;
    dashboardService().beginRequest(run.requestId);
    const started = await start(
      selected.engine.id,
      defaultParams(selected.engine),
      'dashboard-refresh',
      run.requestId,
      (sessionId) => {
        run.sessionId = sessionId;
      },
    );
    if (!started.ok) {
      failRefresh(run, started.error.kind, started.error.message);
      return;
    }
    if (run.done) {
      await end(started.value.sessionId);
      return;
    }
    run.sessionId ??= started.value.sessionId;
    if (!dashboardService().attachRequest(run.requestId, run.sessionId)) {
      failRefresh(run, 'request-mismatch', 'The dashboard refresh is no longer current.');
      await end(run.sessionId);
      return;
    }
  }

  async function requestDashboardUpdate(
    requesterSessionId?: string,
    reason: DashboardRefreshReason = 'agent',
  ): Promise<DashboardUpdateResult> {
    const current = refreshRun;
    if (current !== null && !current.done)
      return {
        requestId: current.requestId,
        definitionHash: current.definitionHash,
        status: 'updating',
        coalesced: true,
      };
    const service = dashboardService();
    const sourceRefreshes = await Promise.allSettled([
      context.service(spaceProjectRefresh).refresh(),
      context.service(spaceRepositories).refresh(),
    ]);
    for (const [index, source] of sourceRefreshes.entries()) {
      if (source.status === 'rejected') {
        context.log.warn('dashboard-source-refresh-failed', {
          space: context.key,
          source: index === 0 ? 'project' : 'repositories',
          message: describe(source.reason),
        });
      }
    }
    try {
      await service.refreshContext();
    } catch (caught) {
      return {
        requestId: '',
        definitionHash: '',
        status: 'failed',
        message: `The dashboard context could not be refreshed: ${describe(caught)}.`,
      };
    }
    const definitionHash = service.definition()?.hash;
    if (typeof definitionHash !== 'string') {
      return {
        requestId: '',
        definitionHash: '',
        status: 'failed',
        message: 'The effective dashboard definition is unavailable; the refresh could not start.',
      };
    }
    const requested = service.request(reason);
    if (requested.coalesced && refreshRun !== null)
      return {
        requestId: requested.request.requestId,
        definitionHash: requested.request.definitionHash ?? definitionHash,
        status: 'updating',
        coalesced: true,
      };
    server.markDashboardRefreshRequested();
    const run: RefreshRun = {
      requestId: requested.request.requestId,
      definitionHash: requested.request.definitionHash ?? definitionHash,
      requesterSessionId,
      sessionId: null,
      timer: null,
      starting: null,
      done: false,
    };
    run.timer = setTimeout(() => {
      if (run.done) return;
      failRefresh(run, 'timeout', 'The PM dashboard refresh timed out before it reported data.');
    }, use.dashboardRefreshTimeoutMs ?? DASHBOARD_REFRESH_TIMEOUT_MS);
    refreshRun = run;
    run.starting = runDashboardRefresh(run).catch((caught: unknown) => {
      failRefresh(run, 'start-failed', describe(caught));
    });
    void run.starting;
    return {
      requestId: run.requestId,
      definitionHash: run.definitionHash,
      status: 'requested',
      coalesced: requested.coalesced,
    };
  }

  async function ensurePm(): Promise<StartedSessionResult> {
    if (pmSessionId !== null) {
      const entry = live.get(pmSessionId);
      if (entry !== undefined && entry.ptyId !== null && entry.ending === null) {
        return {
          ok: true,
          value: {
            sessionId: pmSessionId,
            ptyId: entry.ptyId,
            engineId: entry.engineId,
            unguarded: [],
          },
        };
      }
      pmSessionId = null;
    }
    if (pmStarting !== null) return pmStarting;
    const starting = (async (): Promise<StartedSessionResult> => {
      const ui = context.service(spaceUi);
      const bound = ui.read('pm-profile').state?.engineId;
      const explicit = typeof bound === 'string' ? bound : null;
      let engineId = explicit;
      if (engineId === null) {
        const remembered = ui.read('session-engine').state?.engineId;
        if (typeof remembered === 'string' && (await readiness(remembered)).ok) {
          const engine = use.engines().find((candidate) => candidate.id === remembered);
          if (engine !== undefined && adapterFor(engine)?.supportsInitialPrompt === true)
            engineId = remembered;
        }
      }
      if (engineId === null) {
        for (const candidate of use.engines()) {
          if (
            adapterFor(candidate)?.supportsInitialPrompt === true &&
            (await readiness(candidate.id)).ok
          ) {
            engineId = candidate.id;
            break;
          }
        }
      }
      if (engineId === null) {
        return {
          ok: false,
          error: {
            kind: 'engine-not-supported',
            message:
              'No PM session was started: no configured engine is ready for a guarded Space session.',
          },
        };
      }
      const engine = use.engines().find((candidate) => candidate.id === engineId);
      // An explicit stale setting reaches start so its precise refusal is shown; it is never silently replaced.
      const started = await start(engineId, engine ? defaultParams(engine) : [], 'pm');
      if (started.ok) {
        pmSessionId = started.value.sessionId;
        if (explicit === null) ui.save('pm-profile', { version: 1, engineId });
      }
      return started;
    })().finally(() => {
      pmStarting = null;
    });
    pmStarting = starting;
    return starting;
  }

  async function end(sessionId: string): Promise<boolean> {
    const entry = live.get(sessionId);
    if (!entry) return false;
    if (entry.ptyId !== null) context.ptyService?.kill(entry.ptyId);
    await ended(sessionId);
    return true;
  }

  return {
    readiness,
    start: (engineId, params) => start(engineId, params),
    ensurePm,
    requestDashboardUpdate,
    end,
    live: () => [...live.keys()],
    async dispose() {
      disposing = true;
      const closingRefresh = refreshRun;
      if (closingRefresh !== null && !closingRefresh.done) {
        failRefresh(
          closingRefresh,
          'space-closed',
          'The Space closed before the dashboard refresh completed.',
        );
      }
      // A start that is awaiting readiness/files must finish its rollback before
      // the context releases the server and desk used by that rollback.
      await pmStarting?.catch((caught: unknown) => {
        context.log.warn('pm-start-ended-during-close', { message: describe(caught) });
      });
      await closingRefresh?.starting;
      await Promise.all([...live.keys()].map((id) => end(id)));
    },
  };
}

type Held = SpaceSessions & { dispose(): Promise<void> };

/** The guarded sessions of a Space. `context.service(spaceSessions)` builds it on first use. */
export const spaceSessions = defineSpaceService<SpaceSessions>({
  id: 'sessions',
  create: (context): Held => {
    if (!parts) throw new Error('the sessions of a Space are used before configureSpaceSessions');
    return createSpaceSessions(context, parts);
  },
  dispose: (service) => (service as Held).dispose(),
});
