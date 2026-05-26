import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseMemoryFile } from '../src/index.js';

const STATUS_FIXTURE = `---
type: status
title: example — Status
updated: 2026-05-26
references:
  - group: Parent
    path: ../memory.index.md
active_focus: ./focus/example.focus.md
posture: execute
dials:
  altitude: mid
  commitment: neutral
---

# example — Status

Body prose.
`;

const FOCUS_FIXTURE = `---
type: focus
title: Example — focus
updated: 2026-05-26
references:
  - group: Parent
    path: ./focus.index.md
status: Active
focus_type: build
---

# Example — focus
`;

const AT_NODE_FIXTURE = `---
type: at-node
title: Phase A
updated: 2026-05-26
references:
  - group: Parent
    path: ./example.index.md
node_kind: leaf
gated: true
status: Pending
---

# Phase A
`;

const JOURNAL_FIXTURE = `---
type: journal
title: 2026-05-26 — Session 01
updated: 2026-05-26
references:
  - group: Parent
    path: ./live.index.md
date: 2026-05-26
session: "01"
focus: ../../status/focus/example.focus.md
dials:
  altitude: high
  commitment: neutral
posture: chat
---

# Session 01
`;

const SAVE_POINT_FIXTURE = `---
type: save-point
title: example milestone
updated: 2026-05-26
references:
  - group: Parent
    path: ./save-points.index.md
date: 2026-05-26
lore_commit: deadbeef
payload_commit: cafef00d
---

# example milestone
`;

test('parseMemoryFile reads status frontmatter', () => {
  const result = parseMemoryFile(STATUS_FIXTURE);
  assert.ok(result.frontmatter, 'frontmatter should parse');
  assert.equal(result.frontmatter?.type, 'status');
  if (result.frontmatter?.type !== 'status') return;
  assert.equal(result.frontmatter.posture, 'execute');
  assert.equal(result.frontmatter.dials.altitude, 'mid');
  assert.equal(result.frontmatter.dials.commitment, 'neutral');
  assert.equal(result.frontmatter.active_focus, './focus/example.focus.md');
  assert.equal(result.frontmatter.references.length, 1);
  assert.equal(result.frontmatter.references[0]?.group, 'Parent');
  assert.match(result.body, /^# example — Status/m);
});

test('parseMemoryFile reads focus frontmatter (build)', () => {
  const result = parseMemoryFile(FOCUS_FIXTURE);
  assert.ok(result.frontmatter);
  assert.equal(result.frontmatter?.type, 'focus');
  if (result.frontmatter?.type !== 'focus') return;
  assert.equal(result.frontmatter.status, 'Active');
  assert.equal(result.frontmatter.focus_type, 'build');
});

test('parseMemoryFile reads at-node frontmatter', () => {
  const result = parseMemoryFile(AT_NODE_FIXTURE);
  assert.equal(result.frontmatter?.type, 'at-node');
  if (result.frontmatter?.type !== 'at-node') return;
  assert.equal(result.frontmatter.node_kind, 'leaf');
  assert.equal(result.frontmatter.gated, true);
  assert.equal(result.frontmatter.status, 'Pending');
});

test('parseMemoryFile reads journal frontmatter', () => {
  const result = parseMemoryFile(JOURNAL_FIXTURE);
  assert.equal(result.frontmatter?.type, 'journal');
  if (result.frontmatter?.type !== 'journal') return;
  assert.equal(result.frontmatter.date, '2026-05-26');
  assert.equal(result.frontmatter.session, '01');
  assert.equal(result.frontmatter.posture, 'chat');
  assert.equal(result.frontmatter.dials.altitude, 'high');
});

test('parseMemoryFile reads save-point frontmatter', () => {
  const result = parseMemoryFile(SAVE_POINT_FIXTURE);
  assert.equal(result.frontmatter?.type, 'save-point');
  if (result.frontmatter?.type !== 'save-point') return;
  assert.equal(result.frontmatter.lore_commit, 'deadbeef');
  assert.equal(result.frontmatter.payload_commit, 'cafef00d');
});

test('parseMemoryFile recovers from missing frontmatter', () => {
  const result = parseMemoryFile('# Just a body\n\nNo YAML.\n');
  assert.equal(result.frontmatter, null);
  assert.equal(result.body, '# Just a body\n\nNo YAML.\n');
  assert.equal(result.warning, undefined);
});

test('parseMemoryFile reports a warning for malformed YAML', () => {
  const malformed = '---\ntype: status\ntitle: bad\n  : nested-bad\n---\n\nbody\n';
  const result = parseMemoryFile(malformed);
  assert.equal(result.frontmatter, null);
  assert.ok(result.warning, 'warning should be populated');
});

test('parseMemoryFile reports a warning when required fields are missing', () => {
  const incomplete = '---\ntype: focus\ntitle: missing fields\n---\n\nbody\n';
  const result = parseMemoryFile(incomplete);
  assert.equal(result.frontmatter, null);
  assert.ok(result.warning);
  assert.match(result.warning ?? '', /updated|status|focus_type/);
});

test('parseMemoryFile rejects an unknown `type` value', () => {
  const unknown =
    '---\ntype: not-a-real-type\ntitle: x\nupdated: 2026-05-26\nreferences: []\n---\n\nbody\n';
  const result = parseMemoryFile(unknown);
  assert.equal(result.frontmatter, null);
  assert.match(result.warning ?? '', /unknown type/);
});

test('parseMemoryFile accepts YAML date type for `updated`', () => {
  // YAML 1.1: a bare 2026-05-26 parses as a Date, not a string.
  const fixture =
    '---\ntype: index\ntitle: idx\nupdated: 2026-05-26\nreferences: []\n---\n\nbody\n';
  const result = parseMemoryFile(fixture);
  assert.ok(result.frontmatter);
  assert.equal(result.frontmatter?.updated, '2026-05-26');
});

test('parseMemoryFile rejects invalid `dials.altitude`', () => {
  const fixture =
    '---\ntype: status\ntitle: bad dials\nupdated: 2026-05-26\nreferences: []\nactive_focus: ./x.md\nposture: execute\ndials:\n  altitude: extreme\n  commitment: neutral\n---\n\nbody\n';
  const result = parseMemoryFile(fixture);
  assert.equal(result.frontmatter, null);
  assert.match(result.warning ?? '', /altitude/);
});

test('parseMemoryFile rejects invalid `posture`', () => {
  const fixture =
    '---\ntype: status\ntitle: bad posture\nupdated: 2026-05-26\nreferences: []\nactive_focus: ./x.md\nposture: dancing\ndials:\n  altitude: mid\n  commitment: neutral\n---\n\nbody\n';
  const result = parseMemoryFile(fixture);
  assert.equal(result.frontmatter, null);
  assert.match(result.warning ?? '', /posture/);
});
