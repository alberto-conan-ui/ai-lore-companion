/**
 * The measurement harness for Focus 3 (Search That Earns Its Name) — the
 * "fast on a 10k-file fixture, measured" gate clause runs here.
 *
 * It drives the real `searchFiles` handler through the headless harness against
 * a deterministic 10k-file fixture and reports per-keystroke latency. With the
 * watcher-fed index (Phase 1) the first keystroke pays a one-time build (a
 * single full walk) and every keystroke after answers from memory; the table
 * below is that in-memory, ranked cost across query scenarios that bracket it:
 *
 *   - no-match     — query matches nothing (a typo, or a prefix that hasn't
 *                    landed yet); ranks every name, returns none.
 *   - rare-match   — matches a sparse set.
 *   - common-match — matches many; the cap is a render limit on ranked hits.
 *   - single char  — the widest fuzzy net.
 *
 * The Phase 0 baseline this improves on — ~31 ms per *every* keystroke, a full
 * uncached `readDirectory` walk re-run on each — is recorded in the focus's
 * journal; the headline below restates it for contrast.
 *
 * It measures the in-process index (the headless harness's service), so the
 * numbers are the index + ranking cost itself. Production runs the same index
 * in a `utilityProcess`, which adds a sub-millisecond message round-trip on top
 * but takes the whole cost off the main thread.
 *
 * Run: `npm run bench:search` (compiles via tsconfig.test.json + electron stub,
 * same as the headless tier). Depends on `core/dist` — `npm run build` first if
 * core changed; this script does not rebuild it.
 *
 * Not a `node --test` file (no `.test.` in the name), so the headless run skips
 * it; it is a standalone script with a single entry point below.
 */
import { registerTree } from '../../src/main/ipc/tree.js';
import { fakeContext, harnessFor } from '../headless/harness.js';
import { type Fixture, buildFixture } from './fixture.js';

type Scenario = { label: string; query: string };

const SCENARIOS: Scenario[] = [
  { label: 'no-match', query: 'zzqq-nonexistent-token' },
  { label: 'rare-match', query: 'readme' },
  { label: 'common-match (.ts)', query: '.ts' },
  { label: 'single char "a"', query: 'a' },
];

/** Iterations timed per scenario, after a warm-up pass. */
const ITERATIONS = 25;

type Sample = {
  label: string;
  query: string;
  hits: number;
  min: number;
  median: number;
  mean: number;
  p95: number;
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

async function measure(invoke: (q: string) => Promise<unknown[]>, scn: Scenario): Promise<Sample> {
  // Warm up — first call primes the OS dir cache; we measure steady state.
  const warm = await invoke(scn.query);
  const times: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    await invoke(scn.query);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const sum = times.reduce((acc, n) => acc + n, 0);
  return {
    label: scn.label,
    query: scn.query,
    hits: warm.length,
    min: times[0] ?? 0,
    median: percentile(times, 50),
    mean: sum / times.length,
    p95: percentile(times, 95),
  };
}

function fmt(ms: number): string {
  return `${ms.toFixed(2)} ms`;
}

async function main(): Promise<void> {
  process.stdout.write('Building 10k-file fixture…\n');
  const fixture: Fixture = buildFixture({ files: 10_000 });
  process.stdout.write(
    `  ${fixture.fileCount} files / ${fixture.dirCount} dirs at ${fixture.root}\n\n`,
  );

  const h = harnessFor(registerTree);
  h.setCtx(fakeContext({ root: fixture.root, lorePath: `${fixture.root}/.ai-lore-proj` }));
  const invoke = (q: string) =>
    h.invoke('searchFiles', { query: q, dirs: [fixture.root] }) as Promise<unknown[]>;

  try {
    // The first keystroke pays the one-time index build (a single full walk).
    // Every keystroke after it answers from memory — that is the Phase 1 win.
    const cold0 = performance.now();
    await invoke('cold-build-probe');
    const coldMs = performance.now() - cold0;

    const samples: Sample[] = [];
    for (const scn of SCENARIOS) samples.push(await measure(invoke, scn));

    process.stdout.write('Search latency — `searchFiles` (watcher-fed index + fuzzy ranking)\n');
    process.stdout.write(
      `cold first keystroke (builds the index, one full walk): ${fmt(coldMs)}\n`,
    );
    process.stdout.write(
      `(${ITERATIONS} iterations each, after a warm-up; in-memory ranked search per call)\n\n`,
    );
    const pad = (s: string, n: number) => s.padEnd(n);
    const padL = (s: string, n: number) => s.padStart(n);
    process.stdout.write(
      `${pad('scenario', 26)}${padL('hits', 6)}${padL('min', 11)}${padL('median', 11)}${padL('mean', 11)}${padL('p95', 11)}\n`,
    );
    process.stdout.write(`${'-'.repeat(76)}\n`);
    for (const s of samples) {
      process.stdout.write(
        `${pad(s.label, 26)}${padL(String(s.hits), 6)}${padL(fmt(s.min), 11)}${padL(fmt(s.median), 11)}${padL(fmt(s.mean), 11)}${padL(fmt(s.p95), 11)}\n`,
      );
    }
    process.stdout.write('\n');

    const worst = samples.reduce((a, b) => (b.median > a.median ? b : a));
    process.stdout.write(
      `Headline: after the one-time build, the worst keystroke ranks all ${fixture.fileCount} files in ~${worst.median.toFixed(2)} ms (median, "${worst.label}"). The pre-index baseline was ~31 ms per keystroke (full uncached walk, every keystroke) — see the Phase 0 capture.\n`,
    );
  } finally {
    h.cleanup();
    fixture.cleanup();
  }
}

void main();
