/**
 * The contract of `GitHubPort`, as tests that run against any implementation.
 *
 * `github.int.test.ts` runs them against `FakeGitHub`. They use nothing but
 * the port and the small `control` below, so the gh adapter can run them too,
 * over a scripted runner that answers from a simulated GitHub, or, by hand,
 * against a throwaway account. Every test starts from a new, empty GitHub.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  AGENTS_COLUMNS,
  AGENTS_FIELD,
  DEFAULT_STAGES,
  type GitHubError,
  type GitHubPort,
  type GitHubResult,
  PROJECT_SCOPE,
  SESSION_LABEL,
  STAGE_FIELD,
  describeViewByHand,
  formatIssueMarker,
  formatSessionBlock,
} from '../../src/index.js';

/** One implementation under test, on an empty GitHub. */
export type ContractSubject = {
  port: GitHubPort;
  /** An account the port may create repositories and Projects for. */
  owner: string;
  /** How the suite makes GitHub fail on demand. */
  control: {
    setUnreachable(on: boolean): void;
    rateLimitNext(count: number, retryAfterSeconds: number | null): void;
    /** The next write is made, and its answer is replaced by `error`. */
    loseNextAnswer(error: GitHubError): void;
    /** Whether the host's API can create Project views. */
    setViewsSupported(on: boolean): void;
  };
  cleanup(): void;
};

const M_BEFORE = formatIssueMarker('test', 'before');
const M_OFFLINE = formatIssueMarker('test', 'offline');
const M_PACED = formatIssueMarker('test', 'paced');
const M_ABSENT = formatIssueMarker('test', 'absent');

function unwrap<T>(result: GitHubResult<T>): T {
  if (!result.ok)
    assert.fail(`expected success, got ${result.error.kind}: ${result.error.message}`);
  return result.value;
}

function errorOf(result: GitHubResult<unknown>): GitHubError {
  if (result.ok) assert.fail('expected a failure');
  assert.notEqual(result.error.message, '', 'every error has a message');
  return result.error;
}

/** Register the contract tests for one implementation. */
export function gitHubPortContract(
  name: string,
  makeSubject: () => Promise<ContractSubject> | ContractSubject,
): void {
  const run = (title: string, body: (subject: ContractSubject) => Promise<void>): void => {
    test(`${name}: ${title}`, async (t) => {
      const subject = await makeSubject();
      t.after(() => subject.cleanup());
      await body(subject);
    });
  };

  /** A repository with the labels the tests use. */
  async function space(subject: ContractSubject): Promise<string> {
    const { port, owner } = subject;
    const repository = unwrap(
      await port.createRepository({ owner, name: 'my-space', private: true }),
    );
    const labels = ['feature', SESSION_LABEL].map((label) => ({
      name: label,
      color: 'ededed',
      description: '',
    }));
    unwrap(await port.ensureLabels({ repository: repository.fullName, labels }));
    return repository.fullName;
  }

  run('auth gives the account and a token with the project scope', async ({ port, owner }) => {
    const account = unwrap(await port.auth());
    assert.equal(account.account, owner);
    assert.ok(account.scopes.includes(PROJECT_SCOPE));
  });

  run(
    'a repository is not found, created, found, and not created twice',
    async ({ port, owner }) => {
      const fullName = `${owner}/my-space`;
      assert.equal(unwrap(await port.findRepository(fullName)), null);
      const created = unwrap(
        await port.createRepository({ owner, name: 'my-space', private: true }),
      );
      assert.equal(created.fullName, fullName);
      assert.equal(created.private, true);
      assert.notEqual(created.cloneUrl, '');
      assert.deepEqual(unwrap(await port.findRepository(fullName)), created);
      const again = errorOf(
        await port.createRepository({ owner, name: 'my-space', private: true }),
      );
      assert.equal(again.kind, 'failed');
    },
  );

  run(
    'a Project is found by owner and exact title right after it is created',
    async ({ port, owner }) => {
      assert.equal(unwrap(await port.findProject({ owner, title: 'My Space' })), null);
      const created = unwrap(await port.createProject({ owner, title: 'My Space' }));
      assert.deepEqual([created.owner, created.title], [owner, 'My Space']);
      assert.deepEqual(unwrap(await port.findProject({ owner, title: 'My Space' })), created);
      assert.equal(unwrap(await port.findProject({ owner, title: 'My' })), null);
    },
  );

  run(
    'ensureSingleSelectField can run again, and adds options after the ones that exist',
    async ({ port, owner }) => {
      const project = unwrap(await port.createProject({ owner, title: 'My Space' }));
      const three = DEFAULT_STAGES.slice(0, 3);
      const first = unwrap(
        await port.ensureSingleSelectField({ project, name: STAGE_FIELD, options: [...three] }),
      );
      assert.deepEqual(
        first.options.map((option) => option.name),
        three,
      );
      const second = unwrap(
        await port.ensureSingleSelectField({ project, name: STAGE_FIELD, options: [...three] }),
      );
      assert.deepEqual(second, first);
      const grown = unwrap(
        await port.ensureSingleSelectField({
          project,
          name: STAGE_FIELD,
          options: ['Done', 'Spec', 'Review'],
        }),
      );
      assert.deepEqual(
        grown.options.map((option) => option.name),
        [...three, 'Done', 'Review'],
      );
      assert.deepEqual(grown.options.slice(0, 3), first.options, 'existing options keep their ids');
      const snapshot = unwrap(await port.readProject({ project }));
      assert.deepEqual(snapshot.stageField, { id: grown.id, options: grown.options });
    },
  );

  run(
    'ensureProjectView creates once and reports the board column as a step by hand',
    async ({ port, owner }) => {
      const project = unwrap(await port.createProject({ owner, title: 'My Space' }));
      const spec = {
        name: 'Agents',
        layout: 'board',
        filter: `label:${SESSION_LABEL}`,
        columnField: AGENTS_FIELD,
      } as const;
      const first = unwrap(await port.ensureProjectView({ project, spec }));
      assert.equal(first.created, true);
      assert.deepEqual(
        [first.view?.name, first.view?.layout, first.view?.filter],
        ['Agents', 'board', 'label:session'],
      );
      assert.equal(first.byHand.length, 1);
      const second = unwrap(await port.ensureProjectView({ project, spec }));
      assert.equal(second.created, false);
      assert.deepEqual(second.view, first.view);
    },
  );

  run('linking a Project and ensuring labels can run again', async (subject) => {
    const { port, owner } = subject;
    const repository = await space(subject);
    const project = unwrap(await port.createProject({ owner, title: 'My Space' }));
    unwrap(await port.linkProjectToRepository({ project, repository }));
    unwrap(await port.linkProjectToRepository({ project, repository }));
    const labels = [{ name: 'feature', color: '0e8a16', description: 'A feature' }];
    unwrap(await port.ensureLabels({ repository, labels }));
    const missing = errorOf(
      await port.linkProjectToRepository({ project, repository: `${owner}/nope` }),
    );
    assert.equal(missing.kind, 'not-found');
  });

  run(
    'create-then-find: an issue is found by its marker at once, and a second run creates nothing',
    async (subject) => {
      const { port } = subject;
      const repository = await space(subject);
      const sources = ['status/a.md', 'status/b.md', 'status/c.md'];
      const marker = (source: string): string => `<!-- ai-lore-migrated: ${source} -->`;
      let created = 0;
      const migrate = async (): Promise<number[]> => {
        const numbers: number[] = [];
        for (const source of sources) {
          const found = unwrap(
            await port.findIssueByMarker({ repository, marker: marker(source) }),
          );
          if (found !== null) {
            numbers.push(found.number);
            continue;
          }
          const issue = unwrap(
            await port.createIssue({
              repository,
              title: source,
              body: `From v0.8.\n\n${marker(source)}`,
              labels: [],
            }),
          );
          created += 1;
          numbers.push(issue.number);
        }
        return numbers;
      };
      assert.equal(
        unwrap(await port.findIssueByMarker({ repository, marker: marker('status/a.md') })),
        null,
      );
      const first = await migrate();
      assert.equal(created, 3);
      assert.equal(new Set(first).size, 3);
      assert.deepEqual(await migrate(), first);
      assert.equal(created, 3, 'the second run created nothing');

      const all = unwrap(
        await port.findIssuesByMarkers({ repository, markers: [...sources.map(marker), M_ABSENT] }),
      );
      assert.deepEqual(
        sources.map((source) => all[marker(source)]?.number),
        first,
      );
      assert.equal(all[M_ABSENT], null);
    },
  );

  run(
    'createIssue always creates, and the oldest issue with a marker is the one found',
    async (subject) => {
      const { port } = subject;
      const repository = await space(subject);
      const same = formatIssueMarker('test', 'same');
      const body = `x\n${same}\ny`;
      const older = unwrap(await port.createIssue({ repository, title: 'one', body, labels: [] }));
      const newer = unwrap(await port.createIssue({ repository, title: 'two', body, labels: [] }));
      assert.notEqual(older.number, newer.number);
      assert.deepEqual(unwrap(await port.findIssueByMarker({ repository, marker: same })), older);
      assert.equal(older.repository, repository);
      assert.match(older.url, new RegExp(`/issues/${older.number}$`));
      // A closed issue still counts: closing the older one does not make the newer one the match.
      unwrap(await port.closeIssue({ issue: older }));
      assert.deepEqual(unwrap(await port.findIssueByMarker({ repository, marker: same })), older);
      // Every issue with a marker, oldest first; none for a marker no issue has.
      const absent = formatIssueMarker('test', 'absent');
      const all = unwrap(
        await port.findAllIssuesByMarkers({ repository, markers: [same, absent] }),
      );
      assert.deepEqual(all[same], [older, newer]);
      assert.deepEqual(all[absent], []);
    },
  );

  run(
    'an issue that only mentions a marker does not have it, and text that is not a marker is refused',
    async (subject) => {
      const { port } = subject;
      const repository = await space(subject);
      const marker = formatIssueMarker('migrated', 'status/a.md');
      const longer = formatIssueMarker('migrated', 'status/a.md.bak');
      const mentions = [
        longer,
        `The migration wrote \`${marker}\` into the body.`,
        `> ${marker}`,
        `Example:\n\n\`\`\`html\n${marker}\n\`\`\`\n`,
      ];
      for (const body of mentions) {
        unwrap(await port.createIssue({ repository, title: 'mention', body, labels: [] }));
      }
      assert.equal(unwrap(await port.findIssueByMarker({ repository, marker })), null);
      const real = unwrap(
        await port.createIssue({
          repository,
          title: 'real',
          body: `Text.\n\n${marker}\n`,
          labels: [],
        }),
      );
      assert.deepEqual(unwrap(await port.findIssueByMarker({ repository, marker })), real);
      for (const text of ['', 'status/a.md', '<!-- m: a -->']) {
        assert.equal(
          errorOf(await port.findIssueByMarker({ repository, marker: text })).kind,
          'failed',
        );
      }
    },
  );

  run(
    'an answer lost after GitHub created the issue: the call fails, and the next run finds the issue and creates none',
    async (subject) => {
      const { port, control } = subject;
      const repository = await space(subject);
      const marker = formatIssueMarker('migrated', 'status/lost.md');
      const ensure = async (): Promise<GitHubResult<{ number: number }>> => {
        const found = await port.findIssueByMarker({ repository, marker });
        if (!found.ok || found.value !== null) return found as GitHubResult<{ number: number }>;
        return port.createIssue({ repository, title: 'Lost', body: marker, labels: [] });
      };
      control.loseNextAnswer({ kind: 'rate-limited', retryAfterSeconds: 60, message: 'lost' });
      assert.equal(errorOf(await ensure()).kind, 'rate-limited');
      const second = unwrap(await ensure());
      const third = unwrap(await ensure());
      assert.equal(second.number, third.number);
      // A rate limit on the find itself stops the run before anything is created.
      control.rateLimitNext(1, 5);
      assert.equal(errorOf(await ensure()).kind, 'rate-limited');
      assert.equal(unwrap(await ensure()).number, second.number);
    },
  );

  run(
    'a title or body GitHub would refuse fails whole, and odd text is kept as it is',
    async (subject) => {
      const { port } = subject;
      const repository = await space(subject);
      const tooLong = 'x'.repeat(70 * 1024);
      const marker = formatIssueMarker('test', 'long');
      const refused = [
        await port.createIssue({
          repository,
          title: 't',
          body: `${marker}\n${tooLong}`,
          labels: [],
        }),
        await port.createIssue({ repository, title: '', body: marker, labels: [] }),
        await port.createIssue({
          repository,
          title: 't',
          body: `${marker}\n${String.fromCharCode(0)}`,
          labels: [],
        }),
      ];
      for (const result of refused) assert.equal(errorOf(result).kind, 'failed');
      assert.equal(unwrap(await port.findIssueByMarker({ repository, marker })), null);
      const odd = '--web `id` $(id) "quoted" \'single\' \\ 💥';
      const issue = unwrap(
        await port.createIssue({ repository, title: odd, body: `${odd}\n${marker}`, labels: [] }),
      );
      assert.equal(errorOf(await port.updateIssue({ issue, body: tooLong })).kind, 'failed');
      assert.equal(errorOf(await port.comment({ issue, body: tooLong })).kind, 'failed');
      assert.deepEqual(unwrap(await port.findIssueByMarker({ repository, marker })), issue);
    },
  );

  run(
    'names that are not names are refused: repositories with .. and branches git refuses',
    async (subject) => {
      const { port, owner } = subject;
      const repository = await space(subject);
      const issue = unwrap(
        await port.createIssue({ repository, title: 't', body: '', labels: [] }),
      );
      const results = [
        await port.findRepository(`${owner}/..`),
        await port.createRepository({ owner, name: '..', private: true }),
        await port.createRepository({ owner: '..', name: 'x', private: true }),
        await port.createIssue({ repository: `${owner}/a/b`, title: 't', body: '', labels: [] }),
        await port.developBranch({ issue, branchRepository: repository, name: '--checkout' }),
        await port.developBranch({ issue, branchRepository: repository, name: 'a..b' }),
        await port.developBranch({ issue, branchRepository: `${owner}/..`, name: 'ok' }),
        await port.ensureLabels({
          repository,
          labels: [{ name: 'x', color: 'red', description: '' }],
        }),
      ];
      assert.deepEqual(
        results.map((result) => errorOf(result).kind),
        results.map(() => 'failed'),
      );
    },
  );

  run(
    'on a host whose API cannot create views, ensureProjectView succeeds with the view by hand',
    async (subject) => {
      const { port, owner, control } = subject;
      const project = unwrap(await port.createProject({ owner, title: 'My Space' }));
      const spec = { name: 'Agents', layout: 'board', filter: 'label:session' } as const;
      control.setViewsSupported(false);
      assert.deepEqual(unwrap(await port.ensureProjectView({ project, spec })), {
        view: null,
        created: false,
        byHand: [describeViewByHand(spec)],
      });
      control.setViewsSupported(true);
      const made = unwrap(await port.ensureProjectView({ project, spec }));
      assert.equal(made.created, true);
      assert.equal(made.view?.filter, 'label:session');
    },
  );

  run('an unknown label, repository, issue or option is not-found', async (subject) => {
    const { port, owner } = subject;
    const repository = await space(subject);
    const project = unwrap(await port.createProject({ owner, title: 'My Space' }));
    const stage = unwrap(
      await port.ensureSingleSelectField({ project, name: STAGE_FIELD, options: ['Spec'] }),
    );
    const issue = unwrap(await port.createIssue({ repository, title: 't', body: '', labels: [] }));
    const item = unwrap(await port.addIssueToProject({ project, issue }));
    const ghost = { ...issue, number: 999 };
    const results = [
      await port.createIssue({ repository, title: 't', body: '', labels: ['no-such-label'] }),
      await port.createIssue({ repository: `${owner}/nope`, title: 't', body: '', labels: [] }),
      await port.comment({ issue: ghost, body: 'x' }),
      await port.closeIssue({ issue: ghost }),
      await port.updateIssue({ issue: ghost, body: 'x' }),
      await port.addIssueToProject({ project, issue: ghost }),
      await port.addSubIssue({ parent: issue, child: ghost }),
      await port.setSingleSelect({ project, item, field: stage, option: 'Shipping' }),
    ];
    assert.deepEqual(
      results.map((result) => errorOf(result).kind),
      results.map(() => 'not-found'),
    );
  });

  run(
    'a focus with items reads back from the Project, and the writes can run again',
    async (subject) => {
      const { port, owner } = subject;
      const repository = await space(subject);
      const project = unwrap(await port.createProject({ owner, title: 'My Space' }));
      const stage = unwrap(
        await port.ensureSingleSelectField({
          project,
          name: STAGE_FIELD,
          options: [...DEFAULT_STAGES],
        }),
      );
      const focus = unwrap(
        await port.createIssue({ repository, title: 'A focus', body: '', labels: ['feature'] }),
      );
      const one = unwrap(
        await port.createIssue({ repository, title: 'Item one', body: '', labels: [] }),
      );
      const two = unwrap(
        await port.createIssue({ repository, title: 'Item two', body: '', labels: [] }),
      );
      const alone = unwrap(
        await port.createIssue({ repository, title: 'Standalone', body: '', labels: [] }),
      );
      for (let round = 0; round < 2; round += 1) {
        unwrap(await port.addSubIssue({ parent: focus, child: one }));
        unwrap(await port.addSubIssue({ parent: focus, child: two }));
      }
      assert.equal(errorOf(await port.addSubIssue({ parent: alone, child: one })).kind, 'failed');
      const item = unwrap(await port.addIssueToProject({ project, issue: focus }));
      assert.equal(unwrap(await port.addIssueToProject({ project, issue: focus })), item);
      unwrap(await port.addIssueToProject({ project, issue: one }));
      unwrap(await port.addIssueToProject({ project, issue: alone }));
      unwrap(await port.setSingleSelect({ project, item, field: stage, option: 'Build' }));
      unwrap(await port.setSingleSelect({ project, item, field: stage, option: 'Build' }));
      unwrap(await port.closeIssue({ issue: one }));
      unwrap(await port.closeIssue({ issue: one }));
      unwrap(await port.comment({ issue: focus, body: 'A report' }));

      const snapshot = unwrap(await port.readProject({ project }));
      assert.deepEqual(snapshot.project, {
        owner,
        number: project.number,
        title: 'My Space',
        url: project.url,
      });
      assert.deepEqual(
        snapshot.focuses.map((entry) => [
          entry.issue.number,
          entry.title,
          entry.stage,
          entry.kind,
          entry.state,
        ]),
        [[focus.number, 'A focus', 'Build', 'feature', 'open']],
      );
      assert.deepEqual(
        snapshot.focuses[0]?.items.map((entry) => [entry.issue.number, entry.state]),
        [
          [one.number, 'closed'],
          [two.number, 'open'],
        ],
      );
      assert.deepEqual(
        snapshot.standalone.map((entry) => entry.issue.number),
        [alone.number],
      );
      assert.deepEqual(snapshot.sessions, []);
    },
  );

  run(
    'a session issue moves across the Agents board and its body can be replaced',
    async (subject) => {
      const { port, owner } = subject;
      const repository = await space(subject);
      const project = unwrap(await port.createProject({ owner, title: 'My Space' }));
      const agents = unwrap(
        await port.ensureSingleSelectField({
          project,
          name: AGENTS_FIELD,
          options: [...AGENTS_COLUMNS],
        }),
      );
      const block = {
        targets: [{ kind: 'repository' as const, name: 'app', branch: '7-fix' }],
        attended: true,
        person: owner,
        machine: 'desk-1',
      };
      const issue = unwrap(
        await port.createIssue({
          repository,
          title: 'Session',
          body: formatSessionBlock(block),
          labels: [SESSION_LABEL],
        }),
      );
      const item = unwrap(await port.addIssueToProject({ project, issue }));
      unwrap(await port.setSingleSelect({ project, item, field: agents, option: 'Writing' }));
      const writing = unwrap(await port.readProject({ project })).sessions;
      assert.deepEqual(
        writing.map((session) => [
          session.issue.number,
          session.column,
          session.targets,
          session.person,
          session.machine,
        ]),
        [[issue.number, 'Writing', block.targets, owner, 'desk-1']],
      );

      unwrap(
        await port.updateIssue({
          issue,
          body: formatSessionBlock({ ...block, targets: [{ kind: 'lore' }] }),
        }),
      );
      unwrap(await port.setSingleSelect({ project, item, field: agents, option: 'Done' }));
      unwrap(await port.closeIssue({ issue }));
      const done = unwrap(await port.readProject({ project }));
      assert.deepEqual(
        done.sessions.map((session) => [session.column, session.targets]),
        [['Done', [{ kind: 'lore' }]]],
      );
      assert.deepEqual([done.focuses, done.standalone], [[], []]);
    },
  );

  run('developBranch gives the named branch, the same one when asked again', async (subject) => {
    const { port, owner } = subject;
    const repository = await space(subject);
    const app = unwrap(await port.createRepository({ owner, name: 'app', private: true }));
    const issue = unwrap(
      await port.createIssue({ repository, title: 'Work', body: '', labels: [] }),
    );
    const arg = { issue, branchRepository: app.fullName, name: `${issue.number}-work` };
    assert.deepEqual(unwrap(await port.developBranch(arg)), { branch: arg.name });
    assert.deepEqual(unwrap(await port.developBranch(arg)), { branch: arg.name });
    assert.deepEqual(
      unwrap(await port.mergedPullRequests({ repository: app.fullName, limit: 10 })),
      [],
    );
  });

  run(
    'while GitHub cannot be reached every operation fails with unreachable and changes nothing',
    async (subject) => {
      const { port, owner, control } = subject;
      const repository = await space(subject);
      const project = unwrap(await port.createProject({ owner, title: 'My Space' }));
      const issue = unwrap(
        await port.createIssue({ repository, title: 'Before', body: M_BEFORE, labels: [] }),
      );
      control.setUnreachable(true);
      const results = [
        await port.auth(),
        await port.findRepository(repository),
        await port.createRepository({ owner, name: 'offline', private: true }),
        await port.findProject({ owner, title: 'My Space' }),
        await port.createProject({ owner, title: 'Offline' }),
        await port.createIssue({ repository, title: 'Offline', body: M_OFFLINE, labels: [] }),
        await port.findIssueByMarker({ repository, marker: M_BEFORE }),
        await port.comment({ issue, body: 'x' }),
        await port.closeIssue({ issue }),
        await port.addIssueToProject({ project, issue }),
        await port.readProject({ project }),
        await port.mergedPullRequests({ repository, limit: 5 }),
      ];
      assert.deepEqual(
        results.map((result) => errorOf(result).kind),
        results.map(() => 'unreachable'),
      );

      control.setUnreachable(false);
      assert.equal(unwrap(await port.findRepository(`${owner}/offline`)), null);
      assert.equal(unwrap(await port.findProject({ owner, title: 'Offline' })), null);
      assert.equal(unwrap(await port.findIssueByMarker({ repository, marker: M_OFFLINE })), null);
      const snapshot = unwrap(await port.readProject({ project }));
      assert.deepEqual([snapshot.focuses, snapshot.standalone], [[], []]);
    },
  );

  run(
    'a rate-limited answer says how long to wait, creates nothing, and the next try succeeds',
    async (subject) => {
      const { port, control } = subject;
      const repository = await space(subject);
      control.rateLimitNext(2, 30);
      const create = (): Promise<GitHubResult<{ number: number }>> =>
        port.createIssue({ repository, title: 'Paced', body: M_PACED, labels: [] });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const error = errorOf(await create());
        assert.equal(error.kind, 'rate-limited');
        assert.equal(error.kind === 'rate-limited' && error.retryAfterSeconds, 30);
      }
      const issue = unwrap(await create());
      assert.equal(
        unwrap(await port.findIssueByMarker({ repository, marker: M_PACED }))?.number,
        issue.number,
      );
      control.rateLimitNext(1, null);
      const unknown = errorOf(await create());
      assert.equal(unknown.kind === 'rate-limited' && unknown.retryAfterSeconds, null);
    },
  );
}
