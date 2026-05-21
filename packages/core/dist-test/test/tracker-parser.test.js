import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createTransitionDetector } from '../src/tracker/detector.js';
import { parseStatus, parseTitle } from '../src/tracker/parser.js';
test('parseStatus reads the convention block', () => {
    const text = '# Title\n\n> **Status:** Achieved\n\n> **References**\n';
    assert.equal(parseStatus(text), 'Achieved');
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
//# sourceMappingURL=tracker-parser.test.js.map