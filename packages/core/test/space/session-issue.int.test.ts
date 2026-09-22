/**
 * A session's issue on the Agents board, against `FakeGitHub` (phase M4.7).
 * No test reaches GitHub.
 */

import { strict as assert } from 'node:assert';
import { type TestContext, test } from 'node:test';
import {
  AGENTS_COLUMNS,
  AGENTS_FIELD,
  ISSUE_BODY_MAX,
  type ProjectInfo,
  SESSION_LABEL,
  formatIssueMarker,
  parseSessionBlock,
} from '../../src/space/github/index.js';
import {
  type SessionIssuePlace,
  closeSessionIssue,
  describeGitHubFailure,
  developItemBranch,
  findSpaceProject,
  formatHandoverComment,
  formatSessionBackLink,
  formatSessionIssueBody,
  issueRefFor,
  putSessionIssue,
  readHandover,
  sessionIssueMarker,
  sessionIssueTitle,
} from '../../src/space/project/index.js';
import { type FakeGitHub, createFakeGitHub } from '../../src/space/testing/index.js';

const OWNER = 'fake-human';
const SPACE = 'board-space';
const REPOSITORY = `${OWNER}/${SPACE}`;
const APP = { kind: 'repository', name: 'app', branch: 'feature/7-thing' } as const;

async function bench(t: TestContext): Promise<{ fake: FakeGitHub; place: SessionIssuePlace }> {
  const fake = createFakeGitHub();
  t.after(() => fake.dispose());
  assert.ok((await fake.createRepository({ owner: OWNER, name: SPACE, private: true })).ok);
  assert.ok((await fake.createRepository({ owner: OWNER, name: 'app', private: true })).ok);
  const project = await fake.createProject({ owner: OWNER, title: SPACE });
  assert.ok(project.ok);
  // What setup leaves: the Agents field with its four columns, and the label.
  assert.ok(
    (
      await fake.ensureSingleSelectField({
        project: project.value,
        name: AGENTS_FIELD,
        options: [...AGENTS_COLUMNS],
      })
    ).ok,
  );
  assert.ok(
    (
      await fake.ensureLabels({
        repository: REPOSITORY,
        labels: [{ name: SESSION_LABEL, color: 'ededed', description: 'A session' }],
      })
    ).ok,
  );
  return { fake, place: { github: fake, repository: REPOSITORY, project: project.value } };
}

async function sessionsOn(fake: FakeGitHub, project: ProjectInfo) {
  const read = await fake.readProject({ project });
  assert.ok(read.ok);
  return read.value.sessions;
}

const STARTED = '2026-09-18T12:00:00.000Z';

const CONTENT = {
  sessionId: 's-board',
  engine: 'claude-code',
  startedAt: STARTED,
  targets: [],
  attended: true,
  person: OWNER,
  machine: 'desk',
};

test('the body is short and literal, with the item, the targets and their branches', () => {
  const body = formatSessionIssueBody({
    sessionId: 's-1',
    engine: 'claude-code',
    startedAt: STARTED,
    targets: [{ kind: 'lore' }, APP],
    item: { repository: REPOSITORY, number: 7, url: 'https://github.com/x/y/issues/7' },
    attended: true,
    person: 'fake-human',
    machine: 'desk-1',
  });
  assert.match(body, /^Item: https:\/\/github.com\/x\/y\/issues\/7$/m);
  assert.match(body, /^- the Lore$/m);
  assert.match(body, /^- the repository "app" on the branch "feature\/7-thing"$/m);
  assert.ok(body.includes(sessionIssueMarker('s-1')));
  // The session's id is only in the hidden marker; the text names the engine and the start time.
  assert.equal(body.split('s-1').length - 1, 1);
  assert.match(
    body,
    /^The issue of the claude-code session that started at 2026-09-18T12:00:00.000Z/,
  );
  assert.equal(
    sessionIssueTitle({ engine: 'claude-code', startedAt: STARTED }),
    'The claude-code session that started at 2026-09-18T12:00:00.000Z',
  );
  // The marker does not hide the session block from the snapshot.
  assert.deepEqual(parseSessionBlock(body)?.targets, [{ kind: 'lore' }, APP]);
});

test('the body names the profile between the item and the write targets, without disturbing the marker or the title (M14.4)', () => {
  const withoutProfile = formatSessionIssueBody({
    sessionId: 's-1',
    engine: 'claude-code',
    startedAt: STARTED,
    targets: [{ kind: 'lore' }],
    item: { repository: REPOSITORY, number: 7, url: 'https://github.com/x/y/issues/7' },
    attended: true,
    person: 'fake-human',
    machine: 'desk-1',
  });
  // Today's body, character for character, with no profile given: no line naming a profile.
  assert.ok(!withoutProfile.includes('Profile:'));

  const withModel = formatSessionIssueBody({
    sessionId: 's-1',
    engine: 'claude-code',
    startedAt: STARTED,
    targets: [{ kind: 'lore' }],
    item: { repository: REPOSITORY, number: 7, url: 'https://github.com/x/y/issues/7' },
    attended: true,
    person: 'fake-human',
    machine: 'desk-1',
    profile: { name: 'Claude Code', id: 'default.claude', engine: 'claude-code', model: 'opus' },
  });
  assert.match(
    withModel,
    /^Profile: Claude Code \(default\.claude\), engine claude-code, model opus$/m,
  );
  // Between the item and the write targets.
  const lines = withModel.split('\n');
  const itemIndex = lines.findIndex((line) => line.startsWith('Item:'));
  const profileIndex = lines.findIndex((line) => line.startsWith('Profile:'));
  const targetsIndex = lines.findIndex((line) => line === 'Write targets:');
  assert.ok(itemIndex >= 0 && profileIndex > itemIndex && targetsIndex > profileIndex);

  const withoutModel = formatSessionIssueBody({
    sessionId: 's-1',
    engine: 'claude-code',
    startedAt: STARTED,
    targets: [{ kind: 'lore' }],
    attended: true,
    person: 'fake-human',
    machine: 'desk-1',
    profile: { name: 'Claude Code', id: 'default.claude', engine: 'claude-code' },
  });
  assert.match(
    withoutModel,
    /^Profile: Claude Code \(default\.claude\), engine claude-code, model the engine's default$/m,
  );

  // The marker and the title are byte-identical to what they are today, with or without a profile.
  assert.equal(sessionIssueMarker('s-1'), formatIssueMarker('session-issue', 's-1'));
  assert.ok(withoutProfile.includes(sessionIssueMarker('s-1')));
  assert.ok(withModel.includes(sessionIssueMarker('s-1')));
  const title = sessionIssueTitle({ engine: 'claude-code', startedAt: STARTED });
  assert.equal(title, 'The claude-code session that started at 2026-09-18T12:00:00.000Z');
  // sessionIssueTitle's own signature takes no `profile`: nothing it reads can be disturbed by one.
});

test("the session marker is not the migration's, and a quoted marker is not a marker", async (t) => {
  assert.notEqual(sessionIssueMarker('x'), formatIssueMarker('migrated', 'x'));
  assert.notEqual(sessionIssueMarker('x'), formatIssueMarker('session', 'x'));
  const { fake, place } = await bench(t);
  // An issue a person wrote that quotes the marker in code and in a sentence is not the session's issue.
  const quoted = await fake.createIssue({
    repository: REPOSITORY,
    title: 'Notes',
    body: `See \`${sessionIssueMarker('s-q')}\`.\n\n\`\`\`\n${sessionIssueMarker('s-q')}\n\`\`\`\n`,
    labels: [],
  });
  assert.ok(quoted.ok);
  const put = await putSessionIssue(place, { ...CONTENT, sessionId: 's-q' }, 'Writing');
  assert.ok(put.ok);
  assert.equal(put.value.created, true);
  assert.notEqual(put.value.issue.number, quoted.value.number);
});

test('the handover comment: no folder of this machine, and within the length GitHub accepts', () => {
  const comment = formatHandoverComment(
    'Edited /Users/me/spaces/s/lore/a.md; the desk is /Users/me/Library/ai/spaces/k; see /Users/me/x.',
    [
      { path: '/Users/me', as: '~' },
      { path: '/Users/me/spaces/s', as: '<Space>' },
      { path: '/Users/me/Library/ai/spaces/k', as: '<desk>' },
    ],
  );
  assert.equal(comment, '## Handover\n\nEdited <Space>/lore/a.md; the desk is <desk>; see ~/x.\n');
  const long = formatHandoverComment('x'.repeat(ISSUE_BODY_MAX * 2));
  assert.ok(long.length <= ISSUE_BODY_MAX);
  assert.match(long, /The rest is in the journal entry on the desk\.\)\n$/);
});

test('a lost answer: the issue GitHub made is found by its marker, and no second is created', async (t) => {
  const { fake, place } = await bench(t);
  fake.loseNextAnswer({ kind: 'unreachable', message: 'timed out' });
  const first = await putSessionIssue(place, { ...CONTENT, sessionId: 's-lost' }, 'Writing');
  assert.equal(first.ok, false);
  const again = await putSessionIssue(place, { ...CONTENT, sessionId: 's-lost' }, 'Writing');
  assert.ok(again.ok);
  assert.equal(again.value.created, false);
  assert.equal(fake.state().issues.filter((i) => i.labels.includes(SESSION_LABEL)).length, 1);
});

test('first Writing creates the issue; a second updates it; close leaves it in Done', async (t) => {
  const { fake, place } = await bench(t);
  const content = {
    sessionId: 's-board',
    engine: 'claude-code',
    startedAt: STARTED,
    targets: [{ kind: 'lore' } as const],
    attended: true,
    person: OWNER,
    machine: 'desk',
  };
  const first = await putSessionIssue(place, content, 'Writing');
  assert.ok(first.ok);
  assert.equal(first.value.created, true);

  // A second Writing in the same session, without the desk's record of the issue: found by its marker.
  const second = await putSessionIssue(place, { ...content, targets: [APP] }, 'Writing');
  assert.ok(second.ok);
  assert.equal(second.value.created, false);
  assert.equal(second.value.issue.number, first.value.issue.number);
  assert.equal(fake.state().issues.filter((i) => i.labels.includes(SESSION_LABEL)).length, 1);

  let rows = await sessionsOn(fake, place.project);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.column, 'Writing');
  assert.deepEqual(rows[0]?.targets, [APP]);

  // The whole entry goes to the session's issue, not its `## Handover`
  // section: what the session learned and what it corrected are the parts a
  // later session most needs, and they used never to leave the desk. The
  // handover itself goes to the ticket of the work it concerns, which is the
  // verb's job and not this one's, so it is not written here as well.
  const entry =
    '# What happened\n\nThe mirror.\n\n## Handover\n\nDone: the mirror.\nNext: the tests.';
  const closed = await closeSessionIssue(place, first.value.issue, entry);
  assert.ok(closed.ok);
  rows = await sessionsOn(fake, place.project);
  assert.equal(rows[0]?.column, 'Done');
  const issue = fake.state().issues.find((i) => i.ref.number === first.value.issue.number);
  const comment = issue?.comments.at(-1) ?? '';
  assert.match(comment, /^## The session's journal entry\n/);
  assert.ok(comment.includes('# What happened'), 'the whole entry, not only the handover');
  assert.ok(comment.includes('Next: the tests.'));
  assert.equal(
    issue?.comments.filter((text) => text.startsWith('## Handover')).length,
    0,
    'the handover is not also written here',
  );
});

test('a ticket gets one back-link naming the session that worked on it', () => {
  const link = formatSessionBackLink({
    issue: issueRefFor('owner/repo', 124),
    engine: 'claude-code',
    startedAt: '2026-09-22T16:18:00Z',
  });
  assert.equal(
    link,
    'Worked on by the claude-code session that started at 2026-09-22T16:18:00Z — https://github.com/owner/repo/issues/124\n',
  );
});

test('the session issue lists every ticket it touched, and says so when there are none', () => {
  const base = {
    sessionId: 's-1',
    engine: 'claude-code',
    startedAt: '2026-09-22T16:18:00Z',
    targets: [],
    attended: true,
    person: 'someone',
    machine: 'a-desk',
  } as const;
  assert.match(formatSessionIssueBody(base), /Tickets this session touched:\n- none yet/);
  const withTickets = formatSessionIssueBody({
    ...base,
    tickets: [issueRefFor('owner/repo', 63), issueRefFor('owner/repo', 119)],
  });
  assert.match(
    withTickets,
    /Tickets this session touched:\n- https:\/\/github\.com\/owner\/repo\/issues\/63\n- https:\/\/github\.com\/owner\/repo\/issues\/119/,
  );
});

test('the Project is found by the Space name and number', async (t) => {
  const { fake, place } = await bench(t);
  const found = await findSpaceProject(fake, {
    repository: REPOSITORY,
    name: SPACE,
    project: place.project.number,
  });
  assert.ok(found.ok);
  assert.equal(found.value.id, place.project.id);
  const wrong = await findSpaceProject(fake, { repository: REPOSITORY, name: SPACE, project: 999 });
  assert.equal(!wrong.ok && wrong.error.kind, 'not-found');
});

test('unreachable: the first failure is returned and nothing is written', async (t) => {
  const { fake, place } = await bench(t);
  fake.setUnreachable(true);
  const put = await putSessionIssue(
    place,
    { ...CONTENT, sessionId: 's-off', person: '', machine: '' },
    'Writing',
  );
  assert.equal(put.ok, false);
  assert.ok(!put.ok && describeGitHubFailure(put.error).startsWith('GitHub could not be reached'));
  fake.setUnreachable(false);
  assert.equal(fake.state().issues.length, 0);
});

test('the item branch: made once, and a branch that exists already is taken', async (t) => {
  const { fake, place } = await bench(t);
  const item = await fake.createIssue({
    repository: REPOSITORY,
    title: 'An item',
    body: 'x',
    labels: [],
  });
  assert.ok(item.ok);
  const arg = { item: item.value, branchRepository: `${OWNER}/app`, name: 'feature/7-thing' };
  const made = await developItemBranch(place.github, arg);
  assert.deepEqual(made.ok && made.value, { branch: 'feature/7-thing', existed: false });
  assert.ok((await developItemBranch(place.github, arg)).ok);
  fake.failNext({ kind: 'failed', message: 'Name already exists on this repository' });
  const existed = await developItemBranch(place.github, arg);
  assert.deepEqual(existed.ok && existed.value, { branch: 'feature/7-thing', existed: true });
  fake.failNext({ kind: 'unreachable', message: 'offline' });
  assert.equal((await developItemBranch(place.github, arg)).ok, false);
  // An invalid name is refused before GitHub is asked, so it is never taken as a branch that exists.
  const invalid = await developItemBranch(place.github, { ...arg, name: 'bad..name' });
  assert.equal(invalid.ok, false);
  assert.match(
    !invalid.ok && invalid.error.kind === 'failed' ? invalid.error.message : '',
    /is not a branch name/,
  );
  const branches = fake.state().issues.find((i) => i.ref.number === item.value.number)?.branches;
  assert.equal(branches?.length, 1);
});

test('the handover is the section under its heading', () => {
  const entry =
    '# Entry\n\nDid things.\n\n## Handover\n\nDone: A.\n\n### Next\n\n1. B.\n\n## After\n\nno';
  assert.equal(readHandover(entry), 'Done: A.\n\n### Next\n\n1. B.');
  assert.equal(readHandover('# Entry\n\nNo handover.'), null);
});
