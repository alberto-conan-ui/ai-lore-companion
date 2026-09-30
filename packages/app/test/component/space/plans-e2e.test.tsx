import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { createSpacePlans } from '../../../src/main/space/plans.js';
import { usePlansState } from '../../../src/renderer/src/space/dashboard/usePlansState.js';
import { BandPlans } from '../../../src/renderer/src/space/dashboard/v2/BandPlans.js';

// H2 of the review of #398: the end-to-end demonstration runs the REAL path, not a model of it. The companion's real main-side
// service (`main/space/plans.ts`) runs the real `plans.py` code (through the Space's own stand-in script, which only supplies the
// fake GitHub and a fake clock) in a real child process; the real hook (`usePlansState`) and band schedule it under fake timers;
// the tool starts 0.3 to 0.7 s after each tick; a row is opened through the real `open()` (the path looked up at the click); and
// the page it opens (`/gh/<n>`) is the real `ghlive.js` refreshing itself against the real `serve_live`, on the same cache folder.
// It needs the Space's tools (AI_LORE_SPACE, default: the Space this repository sits in) and python3; without them it is skipped.

const SPACE = process.env.AI_LORE_SPACE ?? resolve(process.cwd(), '../../../..');
const TESTS = join(SPACE, 'tools/plan/tests');
const HAVE =
  existsSync(join(TESTS, 'e2e398_tool.py')) && existsSync(join(SPACE, 'tools/plan/ghlive.js'));
const FOCUS = 346;
const T0 = 1_800_000_000_000;
const DELAY_S = 2;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function jitterSeq(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return 0.3 + (x % 401) / 1000; // 0.3 .. 0.7 s
  };
}

type Outcome = {
  list: number | null;
  page: number | null;
  listBound: number;
  pageBound: number;
  opened: string;
};

async function scenario(changeAt: number, seed: number): Promise<Outcome> {
  const dir = mkdtempSync(join(tmpdir(), 'plans-e2e-'));
  let service: ReturnType<typeof createSpacePlans> | undefined;
  try {
    const root = join(dir, 'space');
    mkdirSync(join(root, 'tools/plan'), { recursive: true });
    mkdirSync(join(root, 'specs'), { recursive: true });
    writeFileSync(
      join(root, 'tools/plan/plans.py'),
      `import runpy, sys\nrunpy.run_path(${JSON.stringify(join(TESTS, 'e2e398_tool.py'))}, run_name='__main__')\n`,
    );
    const changes = [
      {
        at: T0 / 1000 + changeAt,
        n: FOCUS,
        stage: 'Review',
        title: 'Live dashboards, changed on the fake host',
      },
    ];
    const env = (nowMs: number): NodeJS.ProcessEnv => ({
      ...process.env,
      E2E_NOW: String(nowMs / 1000),
      E2E_CACHE: join(dir, 'cache'),
      E2E_SPECS: join(root, 'specs'),
      E2E_DELAY: String(DELAY_S),
      E2E_CHANGES: JSON.stringify(changes),
      PYTHONDONTWRITEBYTECODE: '1',
    });

    vi.useFakeTimers({ now: T0 });
    const jitter = jitterSeq(seed);
    let longestList = 0;
    let longestPage = 0;
    const runner = {
      run: async (_bin: string, args: readonly string[], opts?: { cwd?: string }) => {
        const startup = jitter() * 1000;
        vi.advanceTimersByTime(startup); // the tick is over; python3 is starting
        const start = Date.now();
        if (process.env.E2E_DEBUG) console.log('tool', (start - T0) / 1000, args.join(' '));
        const p = spawnSync('python3', [...args], {
          cwd: opts?.cwd,
          env: env(start),
          encoding: 'utf8',
        });
        if (p.status !== 0) return { code: p.status ?? -1, stdout: p.stdout, stderr: p.stderr };
        const after = (JSON.parse(p.stdout) as { clock_after: number }).clock_after * 1000;
        vi.advanceTimersByTime(after - start); // the read took this long
        if (args[1] === '--json') longestList = Math.max(longestList, startup + (after - start));
        return { code: 0, stdout: p.stdout, stderr: '' };
      },
    };
    service = createSpacePlans({
      runner,
      root,
      liveGitHub: true,
      env: {},
      toolExists: () => true,
      realRoot: root,
      fetch: (async () => ({
        ok: true,
        json: async () => ({ ok: true, root, demo: false }),
      })) as unknown as typeof fetch,
    });
    const listeners = new Set<(s: unknown) => void>();
    service.subscribe((s) => {
      for (const l of listeners) l(s);
    });
    let openedUrl = '';
    let pageOpen: ((number: number) => void) | null = null;
    (window as unknown as { cockpit: unknown }).cockpit = {
      spacePlansState: async () => ({ ok: true, value: service.current() }),
      spacePlansRefresh: async () => ({ ok: true, value: await service.refresh() }),
      spacePlansOpen: async ({ number }: { number: number }) => {
        const answer = await service.open(number);
        if (answer.ok) {
          openedUrl = answer.url;
          pageOpen?.(Number(answer.url.split('/gh/')[1]));
        }
        return answer;
      },
      onSpacePlansState: (l: (s: unknown) => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    };
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });

    // ---- the dashboard the row opens: the real ghlive.js against the real server path ----
    const ctx = vm.createContext({
      window: { fetch: () => undefined, location: { search: '' } } as Record<string, unknown>,
      document: {
        getElementById: () => null,
        addEventListener: () => undefined,
        querySelector: () => null,
      },
      console,
      Promise,
    });
    (ctx.window as Record<string, unknown>).window = ctx.window;
    for (const f of ['ghunresolved.js', 'ghlive.js']) {
      vm.runInContext(require('node:fs').readFileSync(join(SPACE, 'tools/plan', f), 'utf8'), ctx);
    }
    const server = (
      cmd: string,
      number: number,
    ): {
      status: number;
      config?: Record<string, unknown>;
      body?: unknown;
      clock_after: number;
      start: number;
    } => {
      const start = Date.now();
      const p = spawnSync('python3', [join(TESTS, 'e2e398_server.py'), cmd, String(number)], {
        env: env(start),
        encoding: 'utf8',
      });
      if (p.status !== 0) throw new Error(p.stderr);
      const out = JSON.parse(p.stdout);
      return { ...out, start };
    };
    let firstFp: string | null = null;
    let pageShowed: number | null = null;
    let reloadNow = false;
    let generation = 0; // a page that reloaded is gone: its timers and answers do nothing
    let openedNumber: number | null = null;
    const loadPage = (number: number): void => {
      const r = server('page', number);
      const took = r.clock_after * 1000 - r.start;
      longestPage = Math.max(longestPage, took);
      vi.advanceTimersByTime(took);
      const cfg = r.config as {
        fp: string;
        issue: number;
        state: string;
        readAt: number;
        serverNow: number;
        refreshMs: number;
        minuteMs: number;
      };
      if (firstFp === null) firstFp = cfg.fp;
      else if (cfg.fp !== firstFp && pageShowed === null) pageShowed = Date.now();
      reloadNow = false;
      generation += 1;
      const mine = generation;
      const pageEnv = {
        config: cfg,
        now: () => Date.now(),
        setTimeout: (f: () => void, ms: number) =>
          setTimeout(() => {
            if (mine === generation) f();
          }, ms),
        clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
        visible: () => true,
        busy: () => null,
        fetchLive: () => {
          const live = server('live', number);
          if (process.env.E2E_DEBUG)
            console.log('live', (Date.now() - T0) / 1000, JSON.stringify(live.body));
          const t = live.clock_after * 1000 - live.start;
          longestPage = Math.max(longestPage, t);
          const response = {
            ok: live.status < 300,
            status: live.status,
            json: () => Promise.resolve(live.body),
          };
          return new Promise((done) =>
            setTimeout(() => {
              if (mine === generation) done(response);
            }, t),
          );
        },
        classify: (x: unknown) =>
          (
            ctx.window as { ghUnresolved: { classify: (x: unknown) => unknown } }
          ).ghUnresolved.classify(x),
        reload: () => {
          reloadNow = true;
        },
        fromText: () => '',
        lastOk: () => null,
        rememberOk: () => undefined,
        ui: {
          note: () => undefined,
          banner: () => undefined,
          ok: () => undefined,
          lastOk: () => undefined,
          down: () => undefined,
        },
      };
      const live = (
        ctx.window as { ghLive: { create: (e: unknown) => { start: () => void } } }
      ).ghLive.create(pageEnv);
      live.start();
    };
    pageOpen = (number) => {
      openedNumber = number;
      loadPage(number);
    };

    // ---- the band, mounted: it reads at once, then on the schedule the hook keeps ----
    function Harness() {
      return <BandPlans view={usePlansState()} now={Date.now()} />;
    }
    render(<Harness />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // the row is opened by a click, through the real open(): where it opens is looked up now
    await act(async () => {
      await (
        window as unknown as {
          cockpit: { spacePlansOpen: (a: { number: number }) => Promise<unknown> };
        }
      ).cockpit.spacePlansOpen({ number: FOCUS });
    });
    expect(openedNumber).toBe(FOCUS);

    const tChange = T0 + changeAt * 1000;
    let listShowed: number | null = null;
    const horizon = T0 + 150_000;
    while (Date.now() < horizon && (listShowed === null || pageShowed === null)) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      if (reloadNow) {
        if (process.env.E2E_DEBUG) console.log('reload', (Date.now() - T0) / 1000);
        loadPage(FOCUS);
      }
      const row = document.querySelector(
        `[data-testid="plans-row"][data-number="${String(FOCUS)}"]`,
      );
      if (
        listShowed === null &&
        row?.textContent?.includes('changed on the fake host') &&
        row.textContent.includes('Review')
      ) {
        listShowed = Date.now();
      }
    }
    return {
      list: listShowed === null ? null : (listShowed - tChange) / 1000,
      page: pageShowed === null ? null : (pageShowed - tChange) / 1000,
      listBound: 60 + longestList / 1000,
      pageBound: 60 + longestPage / 1000,
      opened: openedUrl,
    };
  } finally {
    cleanup();
    service?.dispose();
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  }
}

test.skipIf(!HAVE)(
  'H2: a change at any moment shows in the list (real service, real tool, real hook timer, jittered start-up) and on the page the row opens, each within 60 s plus its own read',
  async () => {
    const worst = { list: 0, page: 0, listBound: 0, pageBound: 0 };
    let runs = 0;
    const only = process.env.E2E_ONLY?.split(',').map(Number);
    for (const seed of only
      ? [only[1] as number]
      : process.env.E2E_SWEEP
        ? [1, 7, 3, 5, 9]
        : [1, 7]) {
      for (const changeAt of only
        ? [only[0] as number]
        : process.env.E2E_SWEEP
          ? [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40]
          : [14, 23, 31, 40, 49, 58]) {
        const o = await scenario(changeAt, seed);
        runs += 1;
        expect(o.opened).toBe(`http://127.0.0.1:8765/gh/${String(FOCUS)}`);
        expect(
          o.list,
          `the list never showed the change (${String(changeAt)}, ${String(seed)})`,
        ).not.toBeNull();
        expect(
          o.page,
          `the page never showed the change (${String(changeAt)}, ${String(seed)})`,
        ).not.toBeNull();
        expect(o.list as number).toBeLessThanOrEqual(o.listBound);
        expect(o.page as number).toBeLessThanOrEqual(o.pageBound);
        worst.list = Math.max(worst.list, o.list as number);
        worst.page = Math.max(worst.page, o.page as number);
        worst.listBound = Math.max(worst.listBound, o.listBound);
        worst.pageBound = Math.max(worst.pageBound, o.pageBound);
      }
    }
    console.log(
      `H2 real path, ${String(runs)} runs: worst list ${worst.list.toFixed(1)} s (its bound ${worst.listBound.toFixed(1)} s), worst dashboard ${worst.page.toFixed(1)} s (its bound ${worst.pageBound.toFixed(1)} s)`,
    );
  },
  300_000,
);
