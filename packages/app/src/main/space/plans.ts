/**
 * The Plans band's service of a Space (alberto-conan-ui/ai-lore-companion#34, the companion's side of
 * alberto-conan-ui/ai-lore#398).
 *
 * One service per Space, kept as a service of its context. It runs the Space's own tool,
 * `python3 tools/plan/plans.py --json`, in the Space folder, and keeps what it answered in memory. It reads GitHub
 * only through that tool, which reads only through the shared reader (a 30-second cache counted from the start of a
 * read, one read in flight across processes, a refusal blocking exactly its own API). This service never calls GitHub
 * and never runs the Project read that tripped the rate limit.
 *
 * Rules it keeps (the rules of ai-lore#397, in TypeScript):
 *
 * - Unknown is never shown as known. The answer is validated; one that cannot be read is `failed`, never a list.
 * - A list is held only while it is the newest read. A failed, refused or unreachable read holds NO list: nothing
 *   saved stands in for it. The time of the last read that answered is kept, to be said beside the failure.
 * - A read that started earlier never replaces one that started later.
 * - Nothing waits for ever: the tool has a timeout, the server ping has a timeout, and starting the server has one.
 * - One read at a time: a request made while one runs is served by it.
 *
 * It also opens a row: it finds the dashboard of the unit from the list it holds (never from a path the renderer
 * sends), makes sure `tools/plan/edit.py` answers on 127.0.0.1:8765 (starting it, as a child this service owns and
 * stops at teardown, when nothing answers), and gives the URL to open.
 *
 * This file imports nothing from Electron, so a headless test drives it.
 */

import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandRunner } from '@ai-lore-companion/core';
import { z } from 'zod';
import type {
  SpacePlansOpenResult,
  SpacePlansOutcome,
  SpacePlansState,
  SpacePlansUnit,
} from '../../shared/ipc.js';
import { type SpaceContext, defineSpaceService } from './context.js';
import { liveGitHubAllowed } from './live-github.js';
import type { SpaceLog } from './log.js';

export const PLANS_TOOL = 'tools/plan/plans.py';
export const EDIT_TOOL = 'tools/plan/edit.py';
/** The longest one read may run: longer than the reader's own cap on a cached read (90 s), so the tool ends first. */
export const PLANS_TIMEOUT_MS = 120_000;
export const DASHBOARD_PORT = 8765;
export const DASHBOARD_ORIGIN = `http://127.0.0.1:${DASHBOARD_PORT}`;
/** One look at `/api/ping`. */
export const PING_TIMEOUT_MS = 2_000;
/** The longest the service waits for a server it started to answer. */
export const SERVER_START_WAIT_MS = 15_000;
const SERVER_POLL_MS = 250;

const DEMO_STATES = ['incomplete', 'refused', 'unreachable', 'empty'] as const;

const unitSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  level: z.enum(['Epic', 'Focus']),
  kind: z.enum(['epic', 'sub-epic', 'focus']),
  depth: z.number().int().min(0),
  stage: z.string().nullable(),
  updated: z.number().nullable(),
  updated_exact: z.boolean(),
  on_github: z.boolean(),
  // a path on the dashboards' server: never a URL of another host, never a path that leaves it
  dashboard: z
    .string()
    .regex(/^\/[A-Za-z0-9._\-/]*$/)
    .refine((path) => !path.startsWith('//') && !path.split('/').includes('..')),
});

const toolSchema = z.object({
  ok: z.literal(true),
  state: z.enum(['complete', 'incomplete', 'refused', 'unreachable', 'failed']),
  read_at: z.number().nullable(),
  units: z.array(unitSchema),
  missing: z.array(z.object({ what: z.string(), why: z.string() }).passthrough()),
  head: z.string(),
  text: z.string(),
  note: z.string(),
});

/** What the tool answered, validated; or why it cannot be used. */
export type ParsedPlans =
  | {
      ok: true;
      outcome: SpacePlansOutcome;
      readAt: number | null;
      units: readonly (SpacePlansUnit & { dashboard: string })[];
      head: string;
      text: string;
      missing: readonly string[];
      note: string;
    }
  | { ok: false; message: string };

/** Validate the tool's output. An answer that cannot be read is a failure, never an empty or a complete list. */
export function parsePlans(stdout: string): ParsedPlans {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout.trim());
  } catch {
    return { ok: false, message: 'The plans tool answered something that is not JSON.' };
  }
  const parsed = toolSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: 'The plans tool answered something this app cannot read.' };
  }
  const tool = parsed.data;
  const lists = tool.state === 'complete' || tool.state === 'incomplete';
  if (lists && (tool.read_at === null || !Number.isFinite(tool.read_at))) {
    return { ok: false, message: 'The plans tool gave a list with no time for when it was read.' };
  }
  const seen = new Set<number>();
  for (const unit of tool.units) {
    if (seen.has(unit.number)) {
      return { ok: false, message: 'The plans tool listed one unit twice.' };
    }
    seen.add(unit.number);
  }
  return {
    ok: true,
    outcome: tool.state,
    readAt: lists && tool.read_at !== null ? tool.read_at * 1000 : null,
    // a list that was not read lists nothing, whatever the tool put in it
    units: lists
      ? tool.units.map((unit) => ({
          number: unit.number,
          title: unit.title,
          kind: unit.kind,
          depth: unit.depth,
          stage: unit.stage,
          updated: unit.updated === null ? null : unit.updated * 1000,
          updatedExact: unit.updated_exact,
          onGitHub: unit.on_github,
          dashboard: unit.dashboard,
        }))
      : [],
    head: tool.head,
    text: tool.text,
    missing: tool.missing.map((entry) => `${entry.what}: ${entry.why}`),
    note: tool.note,
  };
}

/** What a plans service is built from. */
export type SpacePlansOptions = {
  runner: CommandRunner;
  /** The Space folder: where the tool is run. */
  root: string;
  /** Whether this run may reach live GitHub. Default: `liveGitHubAllowed(process.env)`. */
  liveGitHub?: boolean;
  /** The environment read for the demo switches. Default `process.env`. */
  env?: Record<string, string | undefined>;
  /** Replaces `fetch` for the look at `/api/ping`. */
  fetch?: typeof fetch;
  /** Replaces `child_process.spawn` for the dashboards' server. */
  spawn?: (bin: string, args: readonly string[], cwd: string) => ChildProcess;
  /** Replaces the wait between two looks at a server that is starting. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: SpaceLog;
  space?: string;
  /** Whether the tool exists in this Space. Default: the file `tools/plan/plans.py` exists. */
  toolExists?: () => boolean;
};

export type SpacePlans = {
  current(): SpacePlansState;
  /** Read now; resolves with the state after the run that serves this request. */
  refresh(): Promise<SpacePlansState>;
  /** The dashboard of a unit on the list, and the server it needs running; the caller opens the URL. */
  open(number: number): Promise<SpacePlansOpenResult>;
  subscribe(listener: (state: SpacePlansState) => void): () => void;
  /** Stop the dashboards' server this service started, if any. */
  dispose(): void;
};

const EMPTY: Omit<SpacePlansState, 'version' | 'reading'> = {
  outcome: null,
  units: null,
  readAt: null,
  lastReadAt: null,
  head: '',
  text: '',
  missing: [],
  note: '',
};

const defaultSleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

export function createSpacePlans(options: SpacePlansOptions): SpacePlans {
  const env = options.env ?? process.env;
  const fetchFn = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const fields = options.space === undefined ? {} : { space: options.space };
  const toolExists = options.toolExists ?? (() => existsSync(join(options.root, PLANS_TOOL)));
  const spawnServer =
    options.spawn ??
    ((bin, args, cwd): ChildProcess => nodeSpawn(bin, [...args], { cwd, stdio: 'ignore' }));
  const demo = env.COCKPIT_PLANS_DEMO === '1';
  const simulated = DEMO_STATES.find((state) => state === env.COCKPIT_PLANS_SIMULATE);
  const liveGitHub = options.liveGitHub ?? liveGitHubAllowed(env);

  const listeners = new Set<(state: SpacePlansState) => void>();
  let held: Omit<SpacePlansState, 'version' | 'reading'> = { ...EMPTY };
  /** The dashboards' paths of the rows held: what `open` looks up. Never taken from the renderer. */
  let dashboards = new Map<number, string>();
  let version = 0;
  let running: Promise<SpacePlansState> | null = null;
  let server: ChildProcess | null = null;
  let disposed = false;

  const current = (): SpacePlansState => {
    version += 1;
    return { version, reading: running !== null, ...held };
  };
  const emit = (): void => {
    if (disposed || listeners.size === 0) return;
    const state = current();
    for (const listener of listeners) listener(state);
  };

  const fail = (head: string, text: string): void => {
    // nothing is held as a list; only the time of the last read that answered stays, to be said beside this
    dashboards = new Map();
    held = {
      ...EMPTY,
      outcome: 'failed',
      lastReadAt: held.lastReadAt,
      head,
      text,
    };
  };

  const take = (parsed: ParsedPlans): void => {
    if (!parsed.ok) {
      fail('Plans could not be read', parsed.message);
      return;
    }
    const lists = parsed.outcome === 'complete' || parsed.outcome === 'incomplete';
    if (lists) {
      // a read that started earlier than the one held never replaces it
      if (held.readAt !== null && parsed.readAt !== null && parsed.readAt < held.readAt) return;
      dashboards = new Map(parsed.units.map((unit) => [unit.number, unit.dashboard]));
      held = {
        outcome: parsed.outcome,
        units: parsed.units.map((unit) => ({
          number: unit.number,
          title: unit.title,
          kind: unit.kind,
          depth: unit.depth,
          stage: unit.stage,
          updated: unit.updated,
          updatedExact: unit.updatedExact,
          onGitHub: unit.onGitHub,
        })),
        readAt: parsed.readAt,
        lastReadAt: parsed.readAt,
        head: parsed.outcome === 'complete' ? '' : parsed.head,
        text: parsed.outcome === 'complete' ? '' : parsed.text,
        missing: parsed.outcome === 'complete' ? [] : parsed.missing,
        note: parsed.note,
      };
      return;
    }
    dashboards = new Map();
    held = {
      ...EMPTY,
      outcome: parsed.outcome,
      lastReadAt: held.lastReadAt,
      head: parsed.head,
      text: parsed.text,
      note: parsed.note,
    };
  };

  const readOnce = async (): Promise<void> => {
    if (!toolExists()) {
      dashboards = new Map();
      held = { ...EMPTY, outcome: 'unavailable' };
      return;
    }
    if (!liveGitHub && !demo) {
      fail('Plans could not be read', 'Live GitHub is not read in a test or end-to-end run.');
      return;
    }
    const args = [
      PLANS_TOOL,
      '--json',
      ...(demo ? ['--demo', ...(simulated === undefined ? [] : ['--simulate', simulated])] : []),
    ];
    const result = await options.runner.run('python3', args, {
      cwd: options.root,
      timeoutMs: PLANS_TIMEOUT_MS,
    });
    if (result.failure === 'timeout') {
      fail(
        'Plans could not be read',
        `The read did not finish in ${String(PLANS_TIMEOUT_MS / 1000)} seconds, so it was stopped.`,
      );
    } else if (result.failure === 'not-found') {
      fail('Plans could not be read', 'python3 was not found on this machine.');
    } else if (result.failure !== undefined) {
      fail('Plans could not be read', `The plans tool did not run: ${result.stderr.trim()}`);
    } else if (result.code !== 0) {
      const tail = result.stderr.trim().split('\n').slice(-2).join(' ');
      fail(
        'Plans could not be read',
        `The plans tool stopped with code ${String(result.code)}. ${tail}`.trim(),
      );
    } else {
      take(parsePlans(result.stdout));
    }
  };

  const refresh = (): Promise<SpacePlansState> => {
    if (disposed) return Promise.resolve(current());
    if (running !== null) return running;
    // started on a later tick, so `running` is set when the first state is pushed and says it is reading
    const run = Promise.resolve().then(async (): Promise<SpacePlansState> => {
      emit();
      try {
        await readOnce();
      } catch (caught) {
        fail('Plans could not be read', caught instanceof Error ? caught.message : String(caught));
        options.log?.warn('plans-read-failed', {
          ...fields,
          message: caught instanceof Error ? caught.message : String(caught),
        });
      }
      running = null;
      const state = current();
      for (const listener of listeners) listener(state);
      return state;
    });
    running = run;
    return run;
  };

  const ping = async (): Promise<boolean> => {
    try {
      const response = await fetchFn(`${DASHBOARD_ORIGIN}/api/ping`, {
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      });
      if (!response.ok) return false;
      const body: unknown = await response.json();
      return typeof body === 'object' && body !== null && (body as { ok?: unknown }).ok === true;
    } catch {
      return false;
    }
  };

  /** Make sure the dashboards' server answers. `null` when it does; else why it does not. */
  const ensureServer = async (): Promise<{ started: boolean; problem: string | null }> => {
    if (await ping()) return { started: false, problem: null };
    const gone: { why: string | null } = { why: null };
    if (server === null || server.exitCode !== null || server.killed) {
      const args = [EDIT_TOOL, ...(demo ? ['--demo'] : [])];
      const child = spawnServer('python3', args, options.root);
      server = child;
      child.once('error', (error) => {
        gone.why = `python3 could not start ${EDIT_TOOL}: ${error.message}`;
      });
      child.once('exit', (code) => {
        gone.why = `${EDIT_TOOL} stopped (exit ${String(code)}) before it answered. Is something else using port ${String(DASHBOARD_PORT)}?`;
        if (server === child) server = null;
      });
    }
    const deadline = now() + SERVER_START_WAIT_MS;
    while (now() < deadline) {
      await sleep(SERVER_POLL_MS);
      if (gone.why !== null) return { started: true, problem: gone.why };
      if (await ping()) return { started: true, problem: null };
    }
    // it did not answer in time: a server this service started is stopped, not left half-started
    if (server !== null) {
      server.kill();
      server = null;
    }
    return {
      started: true,
      problem: `${EDIT_TOOL} did not answer within ${String(SERVER_START_WAIT_MS / 1000)} seconds.`,
    };
  };

  const open = async (number: number): Promise<SpacePlansOpenResult> => {
    const path = dashboards.get(number);
    if (path === undefined) {
      return {
        ok: false,
        error: {
          kind: 'not-listed',
          message: `#${String(number)} is not on the list that was last read, so its dashboard was not opened.`,
        },
      };
    }
    const served = await ensureServer();
    if (served.problem !== null) {
      return {
        ok: false,
        error: {
          kind: 'server-not-started',
          message: `The dashboards' server is not running. ${served.problem} Start it with: python3 ${EDIT_TOOL}`,
        },
      };
    }
    return { ok: true, url: `${DASHBOARD_ORIGIN}${path}`, startedServer: served.started };
  };

  return {
    current,
    refresh,
    open,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      listeners.clear();
      if (server !== null) {
        server.kill();
        server = null;
      }
    },
  };
}

/** Test seam: replaces what the service is built from, for the Spaces opened after it. */
export type SpacePlansSettings = Partial<Omit<SpacePlansOptions, 'root' | 'space'>>;

let settings: SpacePlansSettings = {};

export function configureSpacePlans(next: SpacePlansSettings | null): void {
  settings = next ?? {};
}

/** The plans service of an open Space. */
export const spacePlans = defineSpaceService<SpacePlans>({
  id: 'plans',
  create: (context: SpaceContext) =>
    createSpacePlans({
      runner: context.runner,
      root: context.root,
      log: context.log,
      space: context.key,
      ...settings,
    }),
  dispose: (service) => service.dispose(),
});
