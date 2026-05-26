import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createTransitionDetector } from '../src/tracker/detector.js';
import { parseStatus, parseTitle } from '../src/tracker/parser.js';

test('parseStatus reads the convention block (v0.4 body fallback)', () => {
  const text = '# Title\n\n> **Status:** Achieved\n\n> **References**\n';
  assert.equal(parseStatus(text), 'Achieved');
});

test('parseStatus reads frontmatter `status:` for v0.5 focus files', () => {
  const text =
    '---\ntype: focus\ntitle: x\nupdated: 2026-05-26\nreferences: []\n' +
    'status: Review\nfocus_type: build\n---\n\n# x\n\n' +
    '> **Status:** Active\n';
  // Frontmatter wins over the (now-redundant) body quote.
  assert.equal(parseStatus(text), 'Review');
});

test('parseStatus reads frontmatter `status:` for v0.5 at-node files', () => {
  const text =
    '---\ntype: at-node\ntitle: phase\nupdated: 2026-05-26\nreferences: []\n' +
    'node_kind: leaf\ngated: true\nstatus: Achieved\n---\n\n# phase\n';
  assert.equal(parseStatus(text), 'Achieved');
});

test('parseTitle reads frontmatter `title:` for v0.5 files', () => {
  const text =
    '---\ntype: focus\ntitle: From Frontmatter\nupdated: 2026-05-26\nreferences: []\n' +
    'status: Active\nfocus_type: build\n---\n\n# Different H1\n';
  assert.equal(parseTitle(text), 'From Frontmatter');
});

test('parseStatus returns null when no Status block is present', () => {
  const text = '# Title\n\n> **References**\n';
  assert.equal(parseStatus(text), null);
});

test('parseStatus rejects a value outside the tracker vocabulary', () => {
  const text = '# Title\n\n> **Status:** Maybe\n';
  assert.equal(parseStatus(text), null);
});

test('parseStatus is case-sensitive — lowercase is rejected', () => {
  const text = '# Title\n\n> **Status:** active\n';
  assert.equal(parseStatus(text), null);
});

test('parseTitle reads the H1', () => {
  const text = '# Phase B — core/ module\n\n> **Status:** Active\n';
  assert.equal(parseTitle(text), 'Phase B — core/ module');
});

test('detector seeds on first observation and emits no event', () => {
  const det = createTransitionDetector();
  const r = det.observe({ key: '/x.md', status: 'Active' });
  assert.equal(r.kind, 'seeded');
});

test('detector emits transition only when status moves into Review', () => {
  const det = createTransitionDetector();
  det.observe({ key: '/x.md', status: 'Active' });
  const r = det.observe({ key: '/x.md', status: 'Review' });
  assert.equal(r.kind, 'transition');
  if (r.kind === 'transition') {
    assert.equal(r.prev, 'Active');
    assert.equal(r.next, 'Review');
  }
});

test('detector does not re-emit transition for Review → Review', () => {
  const det = createTransitionDetector();
  det.observe({ key: '/x.md', status: 'Active' });
  det.observe({ key: '/x.md', status: 'Review' });
  const r = det.observe({ key: '/x.md', status: 'Review' });
  assert.equal(r.kind, 'no-change');
});

test('detector emits a second transition after leaving and returning to Review', () => {
  const det = createTransitionDetector();
  det.observe({ key: '/x.md', status: 'Active' });
  det.observe({ key: '/x.md', status: 'Review' });
  det.observe({ key: '/x.md', status: 'Active' });
  const r = det.observe({ key: '/x.md', status: 'Review' });
  assert.equal(r.kind, 'transition');
});

test('detector treats null status (no Status block) without firing transitions', () => {
  const det = createTransitionDetector();
  det.observe({ key: '/x.md', status: null });
  const r1 = det.observe({ key: '/x.md', status: null });
  assert.equal(r1.kind, 'no-change');
  // Going from null to Review still emits a transition — null is not Review.
  const r2 = det.observe({ key: '/x.md', status: 'Review' });
  assert.equal(r2.kind, 'transition');
});

test('detector.forget removes the snapshot — next observation re-seeds', () => {
  const det = createTransitionDetector();
  det.observe({ key: '/x.md', status: 'Review' });
  det.forget('/x.md');
  const r = det.observe({ key: '/x.md', status: 'Review' });
  assert.equal(r.kind, 'seeded');
});
