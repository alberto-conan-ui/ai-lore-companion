import assert from 'node:assert/strict';
import { test } from 'node:test';
import { helperLaunchArgs, mcpConfigJson, settingsJson } from '../../src/main/helper/hooks.js';

// CR5 — the read-only guarantee in test form: the helper must launch with the
// deny-writes settings profile, and that profile must deny every mutation +
// network-egress tool and allow only read-shaped ones. Plan mode was tried as a
// supported-API guard but backed out (it regressed the Q&A UX — the helper
// behaved as a planning agent); read-only now rests on this profile alone, so
// the deny/allow assertions below ARE the guarantee.

test('the launch args carry the settings profile and the model — and nothing else', () => {
  const args = helperLaunchArgs({ settingsPath: '/tmp/x/settings.json', model: 'haiku' });
  // No --permission-mode: plan mode was backed out (regressed Q&A).
  assert.ok(!args.includes('--permission-mode'), 'helper must not launch in plan mode');
  const s = args.indexOf('--settings');
  assert.ok(s >= 0, 'launch args must carry the deny-writes --settings profile');
  assert.equal(args[s + 1], '/tmp/x/settings.json');
  const m = args.indexOf('--model');
  assert.ok(m >= 0);
  assert.equal(args[m + 1], 'haiku');
});

test('the settings profile denies every mutation + network-egress tool', () => {
  const json = settingsJson({ sessionStartScript: '/tmp/x/s.mjs', stopScript: '/tmp/x/p.mjs' });
  const parsed = JSON.parse(json) as {
    permissions: { allow: string[]; deny: string[] };
  };
  // Writes (the safety guarantee) and network egress (the exfiltration path for
  // prompt-injection-from-project-content) are all denied.
  for (const tool of ['Write', 'Edit', 'NotebookEdit', 'Bash', 'WebFetch', 'WebSearch']) {
    assert.ok(parsed.permissions.deny.includes(tool), `${tool} must be denied`);
  }
});

test('the settings profile allows only read-shaped tools', () => {
  const json = settingsJson({ sessionStartScript: '/tmp/x/s.mjs', stopScript: '/tmp/x/p.mjs' });
  const parsed = JSON.parse(json) as {
    permissions: { allow: string[]; deny: string[] };
  };
  assert.deepEqual([...parsed.permissions.allow].sort(), ['Glob', 'Grep', 'Read']);
});

// CR10 — the structured egress is a SECOND capability layered beside the
// deny-writes profile: the helper loads one local MCP server and is
// pre-authorized to call its report tool. Read-only is untouched — the deny
// list above is unchanged and the report tool writes to the app, not the project.
test('with an mcp-config the launch loads ONLY that server and pre-authorizes the report tool', () => {
  const args = helperLaunchArgs({
    settingsPath: '/tmp/x/settings.json',
    model: 'haiku',
    mcpConfigPath: '/tmp/x/mcp.json',
  });
  const c = args.indexOf('--mcp-config');
  assert.ok(c >= 0, 'must pass the session mcp-config');
  assert.equal(args[c + 1], '/tmp/x/mcp.json');
  // --strict-mcp-config keeps the user's own MCP servers out of the read-only session.
  assert.ok(args.includes('--strict-mcp-config'));
  const a = args.indexOf('--allowedTools');
  assert.ok(a >= 0, 'the report tool must be pre-authorized (no prompt the PTY can answer)');
  assert.ok(args.slice(a + 1).includes('mcp__ailore__report_dashboard'));
  // The deny-writes guard is still the launch's spine.
  assert.ok(args.includes('--settings'));
  assert.ok(!args.includes('--permission-mode'));
});

test('without an mcp-config the launch carries no MCP flags (unchanged)', () => {
  const args = helperLaunchArgs({ settingsPath: '/tmp/x/settings.json', model: 'haiku' });
  assert.ok(!args.includes('--mcp-config'));
  assert.ok(!args.includes('--allowedTools'));
});

test('the mcp-config names one local http server carrying the bearer token', () => {
  const json = mcpConfigJson({ url: 'http://127.0.0.1:7000/mcp/s1', token: 'tok-123' });
  const parsed = JSON.parse(json) as {
    mcpServers: Record<string, { type: string; url: string; headers: Record<string, string> }>;
  };
  const server = parsed.mcpServers.ailore;
  assert.ok(server, 'the server key must be the tool-namespace prefix (ailore)');
  assert.equal(server.type, 'http');
  assert.equal(server.url, 'http://127.0.0.1:7000/mcp/s1');
  assert.equal(server.headers.Authorization, 'Bearer tok-123');
});
