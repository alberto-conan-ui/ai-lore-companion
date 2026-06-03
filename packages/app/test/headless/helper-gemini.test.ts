import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type GeminiHelperDeps,
  type GeminiHost,
  createGeminiHelper,
  geminiLaunchArgs,
  geminiMcpSettings,
  parseGeminiResult,
  readOnlyPolicyToml,
} from '../../src/main/helper/gemini.js';
import type { McpReport } from '../../src/main/helper/mcp-host.js';
import type { HelperEventPayload, HelperReportPayload } from '../../src/shared/ipc.js';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));
const PROMPT = 'Read status.index.md and summarize what is pending.';
const HOST: GeminiHost = {
  binary: 'gemini',
  cwd: '/proj/.ai-lore-x/memory',
  includeDirs: ['/proj'],
  model: 'gemini-2.5-flash',
};

// --- pure builders: the read-only guarantee in test form ---------------------

test('the read-only policy denies every mutation + network-egress tool', () => {
  const toml = readOnlyPolicyToml();
  for (const tool of [
    'write_file',
    'replace',
    'run_shell_command',
    'web_fetch',
    'google_web_search',
  ]) {
    assert.match(toml, new RegExp(`"${tool}"`), `${tool} must be in the policy`);
  }
  assert.match(toml, /decision = "deny"/);
  assert.doesNotMatch(toml, /decision = "(allow|ask_user)"/);
});

test('launch args use default approval mode (NOT plan) + the admin policy + json', () => {
  const args = geminiLaunchArgs({
    prompt: PROMPT,
    policyPath: '/tmp/p.toml',
    model: 'gemini-2.5-flash',
  });
  // The CR5/spike lesson: plan mode is unsafe headless (the model exits it and writes).
  const mode = args[args.indexOf('--approval-mode') + 1];
  assert.equal(mode, 'default');
  assert.ok(!args.includes('plan'), 'must not launch in plan mode');
  assert.equal(args[args.indexOf('--admin-policy') + 1], '/tmp/p.toml');
  assert.equal(args[args.indexOf('-o') + 1], 'json');
  assert.ok(args.includes('--skip-trust'));
  assert.equal(args[args.indexOf('-p') + 1], PROMPT);
  assert.equal(args[args.indexOf('--model') + 1], 'gemini-2.5-flash');
});

test('launch args omit --model when no model is configured', () => {
  const args = geminiLaunchArgs({ prompt: PROMPT, policyPath: '/tmp/p.toml' });
  assert.ok(!args.includes('--model'));
});

test('launch args add an --include-directories for each included root', () => {
  const args = geminiLaunchArgs({
    prompt: PROMPT,
    policyPath: '/tmp/p.toml',
    includeDirs: ['/proj', '/proj/extra'],
  });
  const included = args
    .map((a, i) => (a === '--include-directories' ? args[i + 1] : null))
    .filter((v): v is string => v !== null);
  assert.deepEqual(included, ['/proj', '/proj/extra']);
});

test('launch args omit --include-directories when none are given', () => {
  const args = geminiLaunchArgs({ prompt: PROMPT, policyPath: '/tmp/p.toml' });
  assert.ok(!args.includes('--include-directories'));
});

test('parseGeminiResult reads the response field', () => {
  const r = parseGeminiResult(JSON.stringify({ session_id: 'x', response: 'all clear' }));
  assert.deepEqual(r, { answer: 'all clear' });
});

test('parseGeminiResult tolerates leading noise before the JSON', () => {
  const r = parseGeminiResult(`Ripgrep is not available.\n${JSON.stringify({ response: 'hi' })}`);
  assert.deepEqual(r, { answer: 'hi' });
});

test('parseGeminiResult errors on unparseable output', () => {
  const r = parseGeminiResult('not json at all');
  assert.ok('error' in r);
});

test('parseGeminiResult surfaces a JSON error field instead of "no answer"', () => {
  const r = parseGeminiResult(JSON.stringify({ session_id: 'x', error: { code: 500 } }));
  assert.ok('error' in r);
  assert.match((r as { error: string }).error, /500/);
});

// --- the headless manager ----------------------------------------------------

function makeGemini(over: Partial<GeminiHelperDeps> = {}) {
  const events: HelperEventPayload[] = [];
  const reports: HelperReportPayload[] = [];
  const runArgs: { args: string[]; cwd: string }[] = [];
  const cleaned: string[] = [];
  const mcpSettingsWrites: { loreDir: string; url: string; token: string }[] = [];
  const mcpSettingsCleaned: string[] = [];
  const mcpUnregistered: string[] = [];
  let mcpRegistered:
    | { sessionId: string; token: string; onReport: (r: McpReport) => void }
    | undefined;
  let idN = 0;
  const deps: GeminiHelperDeps = {
    run: async (_binary, args, cwd) => {
      runArgs.push({ args, cwd });
      return JSON.stringify({ response: 'Pending: CR7 is being built.' });
    },
    materializePolicy: () => ({ dir: '/tmp/gem-0', policyPath: '/tmp/gem-0/readonly.policy.toml' }),
    cleanup: (dir) => cleaned.push(dir),
    mcpHost: {
      listen: async () => 5555,
      endpoint: (sessionId) => `http://127.0.0.1:5555/mcp/${sessionId}`,
      register: async (s) => {
        mcpRegistered = s;
      },
      unregister: async (id) => {
        mcpUnregistered.push(id);
      },
    },
    emitReport: (_winId, report) => reports.push(report),
    writeMcpSettings: (loreDir, opts) => mcpSettingsWrites.push({ loreDir, ...opts }),
    cleanupMcpSettings: (loreDir) => mcpSettingsCleaned.push(loreDir),
    emit: (_winId, event) => events.push(event),
    newId: () => `gid${idN++}`,
    ...over,
  };
  return {
    helper: createGeminiHelper(deps),
    events,
    reports,
    runArgs,
    cleaned,
    mcpSettingsWrites,
    mcpSettingsCleaned,
    mcpUnregistered,
    get mcpRegistered() {
      return mcpRegistered;
    },
    phases: () => events.map((e) => e.phase),
  };
}

test('connect emits connecting → ready (headless is ready at once)', async () => {
  const h = makeGemini();
  await h.helper.connect(1, HOST);
  assert.deepEqual(h.phases(), ['connecting', 'ready']);
});

test('the engine advertises itself: id gemini, no visible session', () => {
  const h = makeGemini();
  assert.equal(h.helper.id, 'gemini');
  assert.equal(h.helper.hasVisibleSession, false);
});

test('submit runs gemini in the host cwd (the lore repo) with the included payload, thinking → answered', async () => {
  const h = makeGemini();
  await h.helper.submit(1, HOST, PROMPT);
  assert.equal(h.runArgs.length, 1);
  assert.equal(h.runArgs[0]?.cwd, '/proj/.ai-lore-x/memory');
  assert.ok(h.runArgs[0]?.args.includes('--admin-policy'));
  // The payload root is handed in as a readable dir.
  const args = h.runArgs[0]?.args ?? [];
  assert.equal(args[args.indexOf('--include-directories') + 1], '/proj');
  assert.deepEqual(h.phases(), ['thinking', 'answered']);
  assert.equal(h.events.at(-1)?.answer, 'Pending: CR7 is being built.');
  // No visible terminal → never emits a ptyId.
  assert.ok(h.events.every((e) => e.ptyId === undefined));
});

test('a run failure surfaces an error phase carrying the engine reason', async () => {
  const h = makeGemini({
    run: async () => {
      throw new Error('Gemini error 500');
    },
  });
  await h.helper.submit(1, HOST, PROMPT);
  const last = h.events.at(-1);
  assert.equal(last?.phase, 'error');
  assert.match(last?.error ?? '', /Gemini error 500/);
});

test('a turn that never returns times out into an error (no infinite "thinking")', async () => {
  const h = makeGemini({
    run: () => new Promise<string>(() => {}), // never resolves
    turnTimeoutMs: 20,
  });
  await h.helper.submit(1, HOST, PROMPT);
  const last = h.events.at(-1);
  assert.equal(last?.phase, 'error');
  assert.match(last?.error ?? '', /timed out/i);
});

test('a second submit while a turn is in flight is ignored (serialized)', async () => {
  let resolveRun!: (s: string) => void;
  let runs = 0;
  const h = makeGemini({
    run: () => {
      runs++;
      return new Promise<string>((res) => {
        resolveRun = res;
      });
    },
  });
  void h.helper.submit(1, HOST, PROMPT);
  await tick();
  void h.helper.submit(1, HOST, 'another'); // in flight — ignored
  await tick();
  assert.equal(runs, 1);
  resolveRun(JSON.stringify({ response: 'done' }));
  await tick();
});

test('disposeForWindow drops the policy temp dir, the .gemini settings, and unhooks the MCP host', async () => {
  const h = makeGemini();
  await h.helper.connect(1, HOST);
  h.helper.disposeForWindow(1);
  assert.deepEqual(h.cleaned, ['/tmp/gem-0']);
  assert.deepEqual(h.mcpSettingsCleaned, ['/proj/.ai-lore-x/memory']);
  assert.deepEqual(h.mcpUnregistered, ['gid0']);
});

// CR10 — Gemini's structured egress: connect registers the session with the MCP
// host (same id/token), writes the `.gemini/settings.json` into the lore cwd,
// allowlists the server on launch, and routes a report tool call to the window.
test('connect registers the MCP host and writes the .gemini settings into the lore cwd', async () => {
  const h = makeGemini();
  await h.helper.connect(1, HOST);
  assert.equal(h.mcpRegistered?.sessionId, 'gid0');
  assert.equal(h.mcpRegistered?.token, 'gid1');
  // The settings landed in the lore dir (Gemini's cwd) with the session endpoint.
  assert.equal(h.mcpSettingsWrites.length, 1);
  assert.equal(h.mcpSettingsWrites[0]?.loreDir, '/proj/.ai-lore-x/memory');
  assert.match(h.mcpSettingsWrites[0]?.url ?? '', /\/mcp\/gid0$/);
  assert.equal(h.mcpSettingsWrites[0]?.token, 'gid1');
});

test('submit allowlists the MCP server, and a report tool call routes to the window', async () => {
  const h = makeGemini();
  await h.helper.submit(1, HOST, PROMPT);
  // The launch allowlists the ailore MCP server so the report tool needs no prompt.
  const args = h.runArgs[0]?.args ?? [];
  const i = args.indexOf('--allowed-mcp-server-names');
  assert.ok(i >= 0);
  assert.equal(args[i + 1], 'ailore');
  // A tool call lands on the window as a structured report (not scraped stdout).
  h.mcpRegistered?.onReport({ tool: 'report_dashboard', payload: { focuses: [] } });
  assert.deepEqual(h.reports, [
    { sessionId: 'gid0', tool: 'report_dashboard', payload: { focuses: [] } },
  ]);
});

test('the .gemini MCP settings name one local http server carrying the bearer token', () => {
  const json = geminiMcpSettings({
    serverName: 'ailore',
    url: 'http://127.0.0.1:7/mcp/s1',
    token: 'tok',
  });
  const parsed = JSON.parse(json) as {
    mcpServers: Record<
      string,
      { url: string; type: string; trust: boolean; headers: Record<string, string> }
    >;
  };
  const s = parsed.mcpServers.ailore;
  assert.equal(s?.type, 'http');
  assert.equal(s?.url, 'http://127.0.0.1:7/mcp/s1');
  assert.equal(s?.trust, true);
  assert.equal(s?.headers.Authorization, 'Bearer tok');
});
