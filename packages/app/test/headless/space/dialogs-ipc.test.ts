import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import {
  type Desk,
  getSession,
  listClaims,
  listGateAnswers,
  startSession,
} from '@ai-lore-companion/core';
import {
  type FakeGitHub,
  type SpaceFixture,
  createFakeGitHub,
  makeSpaceFixture,
} from '@ai-lore-companion/core/testing';
import type { SpaceContext } from '../../../src/main/space/context.js';
import { spaceDesk } from '../../../src/main/space/desk-service.js';
import { spaceGitHub, unreachableGitHub } from '../../../src/main/space/github-service.js';
import {
  GITHUB_PROBE_TIMEOUT_MS,
  registerSpaceDialogs,
} from '../../../src/main/space/ipc/dialogs.js';
import { type DialogBroker, sessionServer } from '../../../src/main/space/session-server/index.js';
import { SPACE_DIALOGS_CONTRACT } from '../../../src/shared/ipc/space/dialogs.contract.js';
import type {
  PendingDialogsPayload,
  SpaceDialogsResult,
  WritingDialogAnswered,
  WritingDialogView,
} from '../../../src/shared/ipc/space/dialogs.types.js';
import {
  type FakeSpaceWindow,
  LORE_TEMPLATE_DIR,
  type SpaceHarness,
  spaceHarnessFor,
} from './space-harness.js';

// The two dialogs' channels on the real Space host, with the real session server's broker
// and a desk in a temporary folder. The test's calls to `broker.forSession(...)` stand in
// for a session's `request_writing` and `request_gate`.

let space: SpaceFixture;
let harness: SpaceHarness;
let spaceWindow: FakeSpaceWindow;
let context: SpaceContext;
let broker: DialogBroker;
let desk: Desk;
let github: FakeGitHub;

before(async () => {
  space = await makeSpaceFixture({
    templateDir: LORE_TEMPLATE_DIR,
    name: 'dialogs-space',
    repositories: ['app'],
  });
});

after(() => space.cleanup());

beforeEach(async () => {
  harness = spaceHarnessFor(registerSpaceDialogs);
  await harness.space.host.openFolder(undefined, space.root);
  const first = harness.space.created[0];
  assert.ok(first);
  spaceWindow = first;
  const found = harness.space.host.contextFor({ sender: { id: spaceWindow.webContents.id } });
  assert.ok(found);
  context = found;
  broker = context.service(sessionServer).broker;
  const opened = context.service(spaceDesk).open();
  assert.ok(opened.ok);
  desk = opened.value;
  github = createFakeGitHub();
  context.service(spaceGitHub).use(github);
});

afterEach(async () => {
  for (const window of harness.space.created) await harness.space.host.windowClosed(window.id);
  harness.cleanup();
});

function begin(sessionId: string): void {
  assert.ok(startSession(desk, { id: sessionId, engine: 'claude-code' }).ok);
}

function ticketOf(result: { ok: boolean; value?: { ticket: string } }): string {
  assert.ok(result.ok && result.value);
  return result.value.ticket;
}

function pushes(window: FakeSpaceWindow): PendingDialogsPayload[] {
  const channel = SPACE_DIALOGS_CONTRACT.onSpaceDialogsPending.channel;
  return window.sent
    .filter((message) => message.channel === channel)
    .map((message) => message.payload as PendingDialogsPayload);
}

async function call<T>(
  key: string,
  arg: unknown,
  from = spaceWindow,
): Promise<SpaceDialogsResult<T>> {
  return (await harness.invoke(key, from, arg)) as SpaceDialogsResult<T>;
}

test('a confirmed request reaches the broker and the desk: the claim and the mode', async () => {
  begin('s1');
  assert.deepEqual(await call('spaceDialogsPending', {}), { ok: true, value: { requests: [] } });

  const ticket = ticketOf(
    broker.forSession('s1').requestWriting({
      targets: [{ kind: 'lore' }, { kind: 'repository', name: 'app', branch: 'main' }],
      reason: 'Write the report.',
      item: 12,
    }),
  );
  const last = pushes(spaceWindow).at(-1);
  assert.equal(last?.requests.length, 1);
  assert.equal(last?.requests[0]?.ticket, ticket);
  const record = getSession(desk, 's1');
  assert.ok(record.ok && record.value);
  assert.deepEqual(last?.requests[0]?.session, {
    engine: 'claude-code',
    startedAt: record.value.startedAt,
    item: null,
  });

  const view = await call<WritingDialogView>('spaceDialogWritingView', { ticket });
  assert.ok(view.ok);
  assert.deepEqual(view.value.github, { reachable: true });
  assert.deepEqual(
    view.value.targets.map((row) => [row.kind, row.name, row.branch, row.heldBy]),
    [
      ['lore', null, null, null],
      ['repository', 'app', 'main', null],
    ],
  );

  // A branch git does not accept is refused, and the request stays pending.
  const badBranch = await call('spaceDialogAnswerWriting', {
    ticket,
    confirm: true,
    targets: [{ kind: 'repository', name: 'app', branch: 'two..dots' }],
  });
  assert.equal(badBranch.ok ? '' : badBranch.error.kind, 'branch-invalid');
  // A target the session did not ask for is refused, and the request stays pending.
  const notAsked = await call('spaceDialogAnswerWriting', {
    ticket,
    confirm: true,
    targets: [{ kind: 'repository', name: 'other', branch: 'main' }],
  });
  assert.equal(notAsked.ok ? '' : notAsked.error.kind, 'invalid-request');
  const empty = await call('spaceDialogAnswerWriting', { ticket, confirm: true, targets: [] });
  assert.equal(empty.ok ? '' : empty.error.kind, 'invalid-request');
  assert.equal(broker.pending().length, 1);

  // The Human Lead keeps both targets and changes the branch.
  const answered = await call<WritingDialogAnswered>('spaceDialogAnswerWriting', {
    ticket,
    confirm: true,
    targets: [{ kind: 'lore' }, { kind: 'repository', name: 'app', branch: 'feature/report' }],
  });
  assert.ok(answered.ok);
  assert.equal(answered.value.granted, true);

  const session = getSession(desk, 's1');
  assert.ok(session.ok && session.value);
  assert.equal(session.value.mode, 'writing');
  const claims = listClaims(desk);
  assert.ok(claims.ok);
  assert.deepEqual(
    claims.value.filter((claim) => claim.sessionId === 's1').map((claim) => claim.target),
    [{ kind: 'lore' }, { kind: 'repository', name: 'app', branch: 'feature/report' }],
  );

  // The session reads the grant, and the windows are told the request ended.
  const read = await broker.forSession('s1').awaitAnswer(ticket, { waitMs: 0 });
  assert.ok(read.ok);
  assert.equal(read.value.status, 'answered');
  assert.equal('granted' in read.value && read.value.granted, true);
  const settled = pushes(spaceWindow).at(-1);
  assert.deepEqual(settled?.requests, []);
  assert.equal(settled?.settled?.outcome, 'answered');
});

test('a held target is shown with its holder, cannot be confirmed, and the request can be declined', async () => {
  begin('s1');
  begin('s2');
  await call('spaceDialogsPending', {});
  const first = ticketOf(
    broker.forSession('s1').requestWriting({ targets: [{ kind: 'lore' }], reason: 'Edit a card.' }),
  );
  assert.ok(
    (
      await call('spaceDialogAnswerWriting', {
        ticket: first,
        confirm: true,
        targets: [{ kind: 'lore' }],
      })
    ).ok,
  );

  const second = ticketOf(
    broker.forSession('s2').requestWriting({ targets: [{ kind: 'lore' }], reason: 'Edit a verb.' }),
  );
  context.service(spaceGitHub).use(unreachableGitHub('No network.'));
  const view = await call<WritingDialogView>('spaceDialogWritingView', { ticket: second });
  assert.ok(view.ok);
  assert.deepEqual(view.value.github, { reachable: false, message: 'No network.' });
  const held = view.value.targets[0]?.heldBy ?? '';
  assert.match(held, /^the claude-code session that started at /);
  assert.doesNotMatch(held, /s1/);

  const refused = await call('spaceDialogAnswerWriting', {
    ticket: second,
    confirm: true,
    targets: [{ kind: 'lore' }],
  });
  assert.equal(refused.ok ? '' : refused.error.kind, 'target-held');
  assert.equal(broker.pending().length, 1, 'the request stays pending');

  const declined = await call<WritingDialogAnswered>('spaceDialogAnswerWriting', {
    ticket: second,
    confirm: false,
  });
  assert.ok(declined.ok);
  assert.equal(declined.value.granted, false);
  const s2 = getSession(desk, 's2');
  assert.equal(s2.ok && s2.value?.mode, 'read-only');
});

test('a gate answer is recorded on the desk by the companion', async () => {
  begin('s1');
  await call('spaceDialogsPending', {});
  const ticket = ticketOf(
    broker.forSession('s1').requestGate({
      process: 'specify',
      step: 'confirm',
      question: 'Is the draft agreed?',
      bearsOn: 'workbench/spec.md',
    }),
  );
  const request = pushes(spaceWindow).at(-1)?.requests[0];
  assert.equal(request?.kind, 'gate');

  const invalid = await call('spaceDialogAnswerGate', { ticket, answer: 'maybe' });
  assert.equal(invalid.ok ? '' : invalid.error.kind, 'invalid-argument');

  const answered = await call<{ answer: string }>('spaceDialogAnswerGate', {
    ticket,
    answer: 'take-over',
  });
  assert.ok(answered.ok);
  const recorded = listGateAnswers(desk, 's1');
  assert.ok(recorded.ok);
  assert.equal(recorded.value.length, 1);
  assert.equal(recorded.value[0]?.answer, 'take-over');
  assert.equal(recorded.value[0]?.process, 'specify');
  assert.equal(recorded.value[0]?.step, 'confirm');

  const again = await call('spaceDialogAnswerGate', { ticket, answer: 'yes' });
  assert.equal(again.ok ? '' : again.error.kind, 'already-answered');
});

test('only the Human Lead answers: every other caller and every stale or forged ticket is refused, and the request is unchanged', async () => {
  begin('s1');
  await call('spaceDialogsPending', {});
  const writing = ticketOf(
    broker.forSession('s1').requestWriting({ targets: [{ kind: 'lore' }], reason: 'Edit a card.' }),
  );
  const confirm = { ticket: writing, confirm: true, targets: [{ kind: 'lore' }] };
  const unchanged = (): void => {
    assert.deepEqual(
      broker.pending().map((request) => request.ticket),
      [writing],
    );
    const session = getSession(desk, 's1');
    assert.equal(session.ok && session.value?.mode, 'read-only');
    const claims = listClaims(desk);
    assert.ok(claims.ok);
    assert.equal(claims.value.length, 0);
  };
  const kindOf = (result: SpaceDialogsResult<unknown>): string =>
    result.ok ? 'answered' : result.error.kind;

  // A v0.8 window, and a page inside the Space window, are not the Space window.
  assert.equal(
    kindOf(await call('spaceDialogAnswerWriting', confirm, { webContentsId: 31_337 } as never)),
    'not-a-space-window',
  );
  assert.equal(
    kindOf(
      await call('spaceDialogAnswerWriting', confirm, {
        webContentsId: spaceWindow.webContents.id,
        frame: 'inside-the-page',
      } as never),
    ),
    'not-a-space-window',
  );
  // A Files window of the same Space.
  harness.space.host.openFilesWindow(context);
  const filesWindow = harness.space.created.at(-1);
  assert.ok(filesWindow && filesWindow !== spaceWindow);
  assert.equal(
    kindOf(await call('spaceDialogAnswerWriting', confirm, filesWindow)),
    'not-the-space-window',
  );
  unchanged();

  // The Space window of another Space: the ticket is not one of its Space's.
  const other = await makeSpaceFixture({
    templateDir: LORE_TEMPLATE_DIR,
    name: 'other-dialogs-space',
    repositories: [],
  });
  try {
    await harness.space.host.openFolder(undefined, other.root);
    const otherWindow = harness.space.created.at(-1);
    assert.ok(otherWindow && otherWindow !== filesWindow);
    // Each Space lists only its own requests: the other Space's list is empty, and a request
    // asked in this Space is pushed to this Space's windows only.
    assert.deepEqual(await call('spaceDialogsPending', {}, otherWindow), {
      ok: true,
      value: { requests: [] },
    });
    begin('s-count');
    const counted = ticketOf(
      broker.forSession('s-count').requestGate({ process: 'plan', step: 'a', question: 'Q?' }),
    );
    assert.equal(pushes(spaceWindow).at(-1)?.requests.length, 2);
    assert.equal(pushes(otherWindow).length, 0);
    assert.ok(broker.cancel(counted).ok);
    assert.equal(
      kindOf(await call('spaceDialogAnswerWriting', confirm, otherWindow)),
      'unknown-ticket',
    );
    assert.equal(
      kindOf(await call('spaceDialogWritingView', { ticket: writing }, otherWindow)),
      'unknown-ticket',
    );
    await harness.space.host.windowClosed(otherWindow.id);
  } finally {
    other.cleanup();
  }
  unchanged();

  // A forged ticket, a ticket of the wrong shape, targets not asked for, a gate answer to a
  // writing ticket.
  assert.equal(
    kindOf(await call('spaceDialogAnswerWriting', { ...confirm, ticket: 'f'.repeat(32) })),
    'unknown-ticket',
  );
  assert.equal(
    kindOf(await call('spaceDialogAnswerWriting', { ...confirm, ticket: '../../x' })),
    'invalid-argument',
  );
  assert.equal(
    kindOf(
      await call('spaceDialogAnswerWriting', {
        ...confirm,
        targets: [{ kind: 'lore' }, { kind: 'publish-area', name: 'site' }],
      }),
    ),
    'invalid-request',
  );
  assert.equal(
    kindOf(
      await call('spaceDialogAnswerWriting', { ...confirm, targets: [{ kind: 'lore', x: 1 }] }),
    ),
    'invalid-argument',
  );
  assert.equal(
    kindOf(await call('spaceDialogAnswerGate', { ticket: writing, answer: 'yes' })),
    'wrong-kind',
  );
  unchanged();

  // A cancelled ticket and an expired one are answered by nobody.
  assert.ok(broker.cancel(writing, 'dismissed').ok);
  assert.equal(kindOf(await call('spaceDialogAnswerWriting', confirm)), 'already-answered');
  const expiring = ticketOf(
    broker.forSession('s1').requestWriting({ targets: [{ kind: 'lore' }], reason: 'Again.' }),
  );
  assert.ok(broker.cancel(expiring, 'expired').ok);
  assert.equal(
    kindOf(await call('spaceDialogAnswerWriting', { ...confirm, ticket: expiring })),
    'already-answered',
  );
  const claims = listClaims(desk);
  assert.ok(claims.ok);
  assert.equal(claims.value.length, 0);
  const s1 = getSession(desk, 's1');
  assert.equal(s1.ok && s1.value?.mode, 'read-only');
});

test('the session reads "granted" only after the claim and the mode are on the desk', async () => {
  begin('s1');
  await call('spaceDialogsPending', {});
  const port = broker.forSession('s1');
  const ticket = ticketOf(
    port.requestWriting({ targets: [{ kind: 'lore' }], reason: 'Edit a card.' }),
  );
  // The session waits in `await_answer` while the Human Lead decides.
  const seen: string[] = [];
  const waiting = port.awaitAnswer(ticket, { waitMs: 10_000 }).then((read) => {
    // What the desk holds at the moment the session is given the answer.
    const session = getSession(desk, 's1');
    const claims = listClaims(desk);
    seen.push(
      `${session.ok ? session.value?.mode : 'none'} ${claims.ok ? claims.value.length : -1}`,
    );
    return read;
  });
  const answered = await call<WritingDialogAnswered>('spaceDialogAnswerWriting', {
    ticket,
    confirm: true,
    targets: [{ kind: 'lore' }],
  });
  assert.ok(answered.ok && answered.value.granted);
  const read = await waiting;
  assert.ok(read.ok);
  assert.equal('granted' in read.value && read.value.granted, true);
  assert.deepEqual(seen, ['writing 1']);
});

test('GitHub that does not answer delays only the notice: the view comes after the limit, the answer at once', async (t) => {
  begin('s1');
  await call('spaceDialogsPending', {});
  const ticket = ticketOf(
    broker.forSession('s1').requestWriting({ targets: [{ kind: 'lore' }], reason: 'Edit a card.' }),
  );
  // A GitHub whose `auth` never answers.
  context.service(spaceGitHub).use({ ...github, auth: () => new Promise(() => {}) });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const view = call<WritingDialogView>('spaceDialogWritingView', { ticket });
  // The request is listed and can be answered while GitHub is being asked.
  assert.equal(pushes(spaceWindow).at(-1)?.requests.length, 1);
  for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(GITHUB_PROBE_TIMEOUT_MS);
  const shown = await view;
  t.mock.timers.reset();
  assert.ok(shown.ok);
  assert.deepEqual(shown.value.github, {
    reachable: false,
    message: `GitHub did not answer in ${GITHUB_PROBE_TIMEOUT_MS / 1000} seconds.`,
  });
  const answered = await call<WritingDialogAnswered>('spaceDialogAnswerWriting', {
    ticket,
    confirm: true,
    targets: [{ kind: 'lore' }],
  });
  assert.ok(answered.ok && answered.value.granted);
});

test('only the Space window of the Space answers; a cancelled request leaves the list', async () => {
  begin('s1');
  await call('spaceDialogsPending', {});
  const ticket = ticketOf(
    broker
      .forSession('s1')
      .requestGate({ process: 'plan', step: 'break-down', question: 'Is it right?' }),
  );

  const stranger = await call('spaceDialogAnswerGate', { ticket, answer: 'yes' }, {
    webContentsId: 987_654,
  } as unknown as FakeSpaceWindow);
  assert.equal(stranger.ok ? '' : stranger.error.kind, 'not-a-space-window');

  harness.space.host.openFilesWindow(context);
  const filesWindow = harness.space.created[1];
  assert.ok(filesWindow);
  const fromFiles = await call('spaceDialogAnswerGate', { ticket, answer: 'yes' }, filesWindow);
  assert.equal(fromFiles.ok ? '' : fromFiles.error.kind, 'not-the-space-window');
  assert.equal(broker.pending().length, 1);

  broker.sessionEnded('s1');
  const last = pushes(spaceWindow).at(-1);
  assert.deepEqual(last?.requests, []);
  assert.equal(last?.settled?.outcome, 'cancelled');
  const recorded = listGateAnswers(desk, 's1');
  assert.ok(recorded.ok);
  assert.equal(recorded.value.length, 0);
});
