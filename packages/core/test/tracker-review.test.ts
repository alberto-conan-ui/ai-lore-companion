import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readTrackerReview } from '../src/index.js';

function makeLore(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'tracker-review-test-'));
  mkdirSync(join(dir, 'memory/status/focus'), { recursive: true });
  mkdirSync(join(dir, 'memory/status/focus/archive'), { recursive: true });
  mkdirSync(join(dir, 'memory/action-tree'), { recursive: true });
  mkdirSync(join(dir, 'memory/action-tree/archive'), { recursive: true });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function writeFocus(dir: string, name: string, status: string, title = name): void {
  writeFileSync(
    join(dir, 'memory/status/focus', `${name}.focus.md`),
    `---
type: focus
title: ${title}
updated: 2026-05-26
references: []
status: ${status}
focus_type: build
---

# ${title}
`,
  );
}

function writePhase(dir: string, focus: string, name: string, status: string, title = name): void {
  mkdirSync(join(dir, 'memory/action-tree', focus), { recursive: true });
  writeFileSync(
    join(dir, 'memory/action-tree', focus, `${name}.phase.md`),
    `---
type: at-node
title: ${title}
updated: 2026-05-26
references: []
node_kind: leaf
gated: true
status: ${status}
---

# ${title}
`,
  );
}

test('readTrackerReview returns [] for a missing lore folder', () => {
  assert.deepEqual(readTrackerReview('/tmp/this-does-not-exist-tr-987654'), []);
});

test('readTrackerReview returns [] when no nodes are at Review', () => {
  const { dir, cleanup } = makeLore();
  try {
    writeFocus(dir, 'one', 'Active');
    writeFocus(dir, 'two', 'Achieved');
    writePhase(dir, 'one', 'A-foo', 'Pending');
    assert.deepEqual(readTrackerReview(dir), []);
  } finally {
    cleanup();
  }
});

test('readTrackerReview surfaces a focus currently at Review', () => {
  const { dir, cleanup } = makeLore();
  try {
    writeFocus(dir, 'one', 'Review', 'Demo focus');
    writeFocus(dir, 'two', 'Active');
    const entries = readTrackerReview(dir);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.kind, 'focus');
    assert.equal(entries[0]?.title, 'Demo focus');
    assert.equal(entries[0]?.lorePath, 'memory/status/focus/one.focus.md');
  } finally {
    cleanup();
  }
});

test('readTrackerReview surfaces an at-node currently at Review', () => {
  const { dir, cleanup } = makeLore();
  try {
    writeFocus(dir, 'one', 'Active');
    writePhase(dir, 'one', 'A-foo', 'Review', 'Phase A — Foo');
    const entries = readTrackerReview(dir);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.kind, 'at-node');
    assert.equal(entries[0]?.title, 'Phase A — Foo');
    assert.equal(entries[0]?.lorePath, 'memory/action-tree/one/A-foo.phase.md');
  } finally {
    cleanup();
  }
});

test('readTrackerReview sorts focuses first then at-nodes, each alphabetical', () => {
  const { dir, cleanup } = makeLore();
  try {
    writeFocus(dir, 'beta', 'Review');
    writeFocus(dir, 'alpha', 'Review');
    writePhase(dir, 'one', 'B-bar', 'Review');
    writePhase(dir, 'one', 'A-foo', 'Review');
    const order = readTrackerReview(dir).map((e) => `${e.kind}:${e.lorePath}`);
    assert.deepEqual(order, [
      'focus:memory/status/focus/alpha.focus.md',
      'focus:memory/status/focus/beta.focus.md',
      'at-node:memory/action-tree/one/A-foo.phase.md',
      'at-node:memory/action-tree/one/B-bar.phase.md',
    ]);
  } finally {
    cleanup();
  }
});

test('readTrackerReview skips the archive folders', () => {
  const { dir, cleanup } = makeLore();
  try {
    // An archived focus at Review must NOT surface.
    writeFileSync(
      join(dir, 'memory/status/focus/archive', 'old.focus.md'),
      `---
type: focus
title: Old
updated: 2025-01-01
references: []
status: Review
focus_type: build
---
`,
    );
    writeFocus(dir, 'live', 'Review');
    const entries = readTrackerReview(dir);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.lorePath, 'memory/status/focus/live.focus.md');
  } finally {
    cleanup();
  }
});

test('readTrackerReview tolerates files with missing frontmatter', () => {
  const { dir, cleanup } = makeLore();
  try {
    writeFileSync(join(dir, 'memory/status/focus', 'bare.focus.md'), '# Just a body\n\nno yaml\n');
    writeFocus(dir, 'good', 'Review');
    const entries = readTrackerReview(dir);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.lorePath, 'memory/status/focus/good.focus.md');
  } finally {
    cleanup();
  }
});

test('readTrackerReview includes at-node container index files at Review', () => {
  const { dir, cleanup } = makeLore();
  try {
    mkdirSync(join(dir, 'memory/action-tree/one'), { recursive: true });
    writeFileSync(
      join(dir, 'memory/action-tree/one', 'one.index.md'),
      `---
type: at-node
title: One — Phases
updated: 2026-05-26
references: []
node_kind: container
gated: false
status: Review
---
`,
    );
    const entries = readTrackerReview(dir);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.title, 'One — Phases');
  } finally {
    cleanup();
  }
});
