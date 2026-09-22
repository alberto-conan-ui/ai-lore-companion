/**
 * What `Status` should say about a root (the Space's #109).
 *
 * The defect these guard: `Status` was maintained by hand, and a
 * hand-maintained activity field goes stale exactly the way the first one did.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  type ActivityInput,
  type StatusWrite,
  decideStatus,
  rootKey,
} from '../../src/space/project/index.js';

const MARK = (set: StatusWrite['set'], overridden = false): StatusWrite => ({
  key: 'owner/repo#62',
  set,
  setAt: '2026-09-22T10:00:00.000Z',
  ...(overridden ? { overriddenAt: '2026-09-22T11:00:00.000Z' } : {}),
});

const input = (over: Partial<ActivityInput>): ActivityInput => ({
  current: null,
  mark: null,
  working: false,
  doneCallDue: false,
  ...over,
});

test('a root a session is working on goes to In Progress', () => {
  assert.deepEqual(decideStatus(input({ current: 'Todo', working: true })), {
    write: 'In Progress',
    clearOverride: false,
  });
});

test('a root the last session released goes to Paused, but only once it has been worked', () => {
  // Worked before: the companion wrote it, so there is a mark.
  assert.deepEqual(decideStatus(input({ current: 'In Progress', mark: MARK('In Progress') })), {
    write: 'Paused',
    clearOverride: false,
  });
  // Never worked, nobody on it: there is nothing to say, so nothing is written.
  assert.deepEqual(decideStatus(input({ current: 'Todo' })), {
    leave: 'no session has worked this yet',
    override: false,
  });
});

test('nothing ever moves a root back to Todo', () => {
  const decisions = [
    decideStatus(input({ current: 'In Progress', mark: MARK('In Progress') })),
    decideStatus(input({ current: 'Paused', mark: MARK('Paused') })),
    decideStatus(input({ current: 'In Progress', mark: MARK('In Progress'), working: true })),
  ];
  for (const decision of decisions) {
    assert.notEqual('write' in decision ? decision.write : null, 'Todo');
  }
});

test('a root ready for the Done call is not moved to Paused underneath the question', () => {
  assert.deepEqual(
    decideStatus(input({ current: 'In Progress', mark: MARK('In Progress'), doneCallDue: true })),
    { leave: 'it is ready for the Done call', override: false },
  );
});

test('Done is the Human Lead’s call and the companion never writes over it', () => {
  assert.deepEqual(decideStatus(input({ current: 'Done' })), {
    leave: 'the Human Lead has made the Done call',
    override: false,
  });
});

test('a value the companion did not write is an override, and it sticks', () => {
  // The companion last wrote In Progress; the Project says Paused.
  const seen = decideStatus(input({ current: 'Paused', mark: MARK('In Progress'), working: true }));
  assert.deepEqual(seen, {
    leave: 'the Status was set to Paused by hand',
    override: true,
  });

  // Recorded as overridden: the next session does not undo it, which is the
  // criterion this exists for.
  assert.deepEqual(
    decideStatus(input({ current: 'Paused', mark: MARK('Paused', true), working: true })),
    { leave: 'the Human Lead set this Status', override: false },
  );
});

test('an override ends on its own when the two agree again', () => {
  // Overridden to Paused, and now nobody is working it: the computed value is
  // Paused too, so there is nothing left to disagree about.
  assert.deepEqual(
    decideStatus(input({ current: 'Paused', mark: MARK('Paused', true), working: false })),
    { write: 'Paused', clearOverride: true },
  );
});

test('a Status that already says the right thing is not written again', () => {
  assert.deepEqual(
    decideStatus(input({ current: 'In Progress', mark: MARK('In Progress'), working: true })),
    { leave: 'it already says In Progress', override: false },
  );
});

test('a root worked before the companion maintained the field is still known to have started', () => {
  // No mark, because the companion never wrote it, but the value is not Todo.
  assert.deepEqual(decideStatus(input({ current: 'In Progress' })), {
    write: 'Paused',
    clearOverride: false,
  });
});

test('a root is keyed by its repository and number', () => {
  assert.equal(rootKey('owner/repo', 62), 'owner/repo#62');
});
