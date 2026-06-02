import assert from 'node:assert/strict';
import { test } from 'node:test';
import { helperLaunchArgs, settingsJson } from '../../src/main/helper/hooks.js';

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
