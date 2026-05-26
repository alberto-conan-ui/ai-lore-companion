import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { updateFrontmatterField } from '../src/index.js';

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

test('updateFrontmatterField updates a top-level scalar', () => {
  const result = updateFrontmatterField(STATUS_FIXTURE, 'posture', 'chat');
  assert.ok(result);
  assert.match(result ?? '', /^posture: chat$/m);
  // Preserves the rest of the frontmatter and the body.
  assert.match(result ?? '', /^active_focus: \.\/focus\/example\.focus\.md$/m);
  assert.match(result ?? '', /^# example — Status/m);
});

test('updateFrontmatterField updates a nested dials field', () => {
  const result = updateFrontmatterField(STATUS_FIXTURE, 'dials.altitude', 'high');
  assert.ok(result);
  assert.match(result ?? '', /^ {2}altitude: high$/m);
  // Sibling commitment is preserved unchanged.
  assert.match(result ?? '', /^ {2}commitment: neutral$/m);
});

test('updateFrontmatterField updates the second nested dials field', () => {
  const result = updateFrontmatterField(STATUS_FIXTURE, 'dials.commitment', 'go');
  assert.ok(result);
  assert.match(result ?? '', /^ {2}commitment: go$/m);
  assert.match(result ?? '', /^ {2}altitude: mid$/m);
});

test('updateFrontmatterField preserves key order and comments', () => {
  const withComment = STATUS_FIXTURE.replace(
    'posture: execute',
    '# the active posture\nposture: execute',
  );
  const result = updateFrontmatterField(withComment, 'posture', 'plan');
  assert.ok(result);
  assert.match(result ?? '', /^# the active posture$/m);
  assert.match(result ?? '', /^posture: plan$/m);
  // Order is preserved — active_focus before posture, posture before dials.
  const idxActiveFocus = (result as string).indexOf('active_focus:');
  const idxPosture = (result as string).indexOf('posture:');
  const idxDials = (result as string).indexOf('dials:');
  assert.ok(idxActiveFocus < idxPosture && idxPosture < idxDials);
});

test('updateFrontmatterField returns null when the field is missing', () => {
  const result = updateFrontmatterField(STATUS_FIXTURE, 'not_a_field', 'x');
  assert.equal(result, null);
});

test('updateFrontmatterField returns null when the nested parent is missing', () => {
  const result = updateFrontmatterField(STATUS_FIXTURE, 'dials.missing', 'x');
  assert.equal(result, null);
});

test('updateFrontmatterField returns null when the content has no frontmatter', () => {
  const result = updateFrontmatterField('# Just a body\n', 'posture', 'chat');
  assert.equal(result, null);
});

test('updateFrontmatterField does not bleed across nested blocks', () => {
  // Two nested mappings with similarly-named keys; updating one must not
  // touch the other.
  const fixture = `---
type: status
title: t
updated: 2026-05-26
references: []
active_focus: ./x.md
posture: execute
dials:
  altitude: mid
  commitment: neutral
other:
  altitude: ignored
---

body
`;
  const result = updateFrontmatterField(fixture, 'dials.altitude', 'high');
  assert.ok(result);
  assert.match(result ?? '', /^dials:\n {2}altitude: high\n {2}commitment: neutral/m);
  // The `other.altitude: ignored` line stays untouched.
  assert.match(result ?? '', /^other:\n {2}altitude: ignored$/m);
});

test('updateFrontmatterField is idempotent for the same value', () => {
  const once = updateFrontmatterField(STATUS_FIXTURE, 'posture', 'execute');
  assert.equal(once, STATUS_FIXTURE);
});
