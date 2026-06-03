import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promptFor } from '../../src/main/helper/hooks.js';

const STATUS = '/proj/.ai-lore-proj/memory/status/status.index.md';

test('the full orient walks the methodology (Claude, has the skill)', () => {
  const p = promptFor('orient', { statusPath: STATUS });
  assert.match(p, /ai_readme\.md/);
  assert.match(p, /focus chain/i);
});

test('the light orient just reads status.index.md (headless Gemini, no skill)', () => {
  const p = promptFor('orient', { statusPath: STATUS, lightOrient: true });
  // One cheap file read — not the full methodology crawl that blows the timeout.
  assert.match(p, /status\.index\.md/);
  assert.doesNotMatch(p, /ai_readme\.md/);
  assert.match(p, /oriented and ready/i);
});

test('summarize-pending points the helper at the status file', () => {
  const p = promptFor('summarize-pending', { statusPath: STATUS });
  assert.match(p, /status\.index\.md/);
  assert.match(p, /pending or in progress/i);
});

test('what-changed with a clean tree asks for a one-line "nothing changed"', () => {
  const p = promptFor('what-changed', { statusPath: STATUS, changedPaths: [] });
  assert.match(p, /no uncommitted changes|clean/i);
  // No bullet list when there's nothing to list.
  assert.doesNotMatch(p, /^- /m);
});

test('what-changed lists the supplied changed paths as a bullet list', () => {
  const p = promptFor('what-changed', {
    statusPath: STATUS,
    changedPaths: ['src/a.ts', '[lore] status/status.index.md'],
  });
  assert.match(p, /- src\/a\.ts/);
  assert.match(p, /- \[lore\] status\/status\.index\.md/);
  assert.match(p, /what changed/i);
});

test('dashboard asks for the FocusBoard JSON and optimises for completeness, not polish', () => {
  const p = promptFor('dashboard', {
    statusPath: STATUS,
    memoryPath: '/lore/memory',
    today: '2026-06-03',
  });
  assert.match(p, /\/lore\/memory/); // anchors the crawl at the Memory root
  assert.match(p, /"focuses"/); // the FocusBoard shape
  assert.match(p, /"headless"/); // the loose-ends bucket
  assert.match(p, /"staleness"/); // the sign-off banner
  assert.match(p, /2026-06-03/); // today, for sign-off currency
  assert.match(p, /completeness/i); // surface everything…
  assert.match(p, /do not merge/i); // …raw and unmerged — the UI cleans up
});

test('dashboard without a reportTool prints the JSON (the legacy scrape path)', () => {
  const p = promptFor('dashboard', { statusPath: STATUS, memoryPath: '/lore/memory' });
  assert.match(p, /Return EXACTLY this JSON/i);
  assert.match(p, /Output ONLY the JSON object/i);
  assert.doesNotMatch(p, /CALLING the/i);
});

test('dashboard with a reportTool tells the model to CALL the tool, not print (CR10)', () => {
  const p = promptFor('dashboard', {
    statusPath: STATUS,
    memoryPath: '/lore/memory',
    reportTool: 'report_dashboard',
  });
  // Delivery flips to the MCP tool call; the brittle print path is gone.
  assert.match(p, /CALLING the `report_dashboard` tool/);
  assert.match(p, /do NOT print/i);
  assert.match(p, /Call `report_dashboard` exactly once/);
  assert.doesNotMatch(p, /Output ONLY the JSON object/i);
  // The board shape + completeness rules are unchanged — only delivery differs.
  assert.match(p, /"focuses"/);
  assert.match(p, /completeness/i);
});
