import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  CLOSED_MESSAGE,
  type GitHubPort,
  createGhCliGitHub,
  formatIssueMarker,
} from '../../src/index.js';
import * as Q from '../../src/space/github/queries.js';
import { createFakeGitHub } from '../../src/space/testing/index.js';
import { createSimulatedGh } from './github-simulated-gh.js';

// companion#37, to the letter: once the owner of a read has closed, no call is made, INSIDE the port too. A multi-page read
// carries the owner's AbortSignal and checks it before each page call; an aborted read is "not read", never complete or empty.

async function world() {
  const fake = createFakeGitHub();
  const repository = 'fake-human/space';
  assert.ok(
    (await fake.createRepository({ owner: 'fake-human', name: 'space', private: true })).ok,
  );
  const created = await fake.createProject({ owner: 'fake-human', title: 'space' });
  assert.ok(created.ok);
  const project = created.value;
  for (let i = 0; i < 8; i++) {
    const issue = await fake.createIssue({
      repository,
      title: `issue ${String(i)} MARK-${String(i)}`,
      body: `body ${String(i)}`,
      labels: [],
    });
    assert.ok(issue.ok);
    assert.ok((await fake.addIssueToProject({ project, issue: issue.value })).ok);
  }
  return { fake, project, repository };
}

/** The gh adapter over the simulated gh, counting each page request and running `after` once the first page was answered. */
function counted(fake: ReturnType<typeof createFakeGitHub>, onFirstAnswer: () => void) {
  const gh = createSimulatedGh(fake);
  const pages: Record<string, number> = {};
  let answered = 0;
  const runner = {
    run: async (bin: string, args: readonly string[], opts?: Parameters<typeof gh.run>[2]) => {
      let name = '';
      try {
        const query = (JSON.parse(opts?.input ?? '{}') as { query?: string }).query ?? '';
        name =
          query === Q.READ_PROJECT_QUERY
            ? 'readProject'
            : query === Q.ISSUE_BODIES_QUERY
              ? 'issues'
              : query === Q.OWNER_PROJECTS_QUERY
                ? 'projects'
                : '';
      } catch {
        // not a graphql request
      }
      if (name !== '') pages[name] = (pages[name] ?? 0) + 1;
      const result = await gh.run(bin, args, opts);
      if (name !== '' && answered++ === 0) onFirstAnswer();
      return result;
    },
  };
  return { port: createGhCliGitHub(runner) as GitHubPort, pages };
}

test('readProject: disposed during page 1 of a multi-page read, no page 2 call is made, and the read is "not read"', async () => {
  const { fake, project } = await world();
  const owner = new AbortController();
  const { port, pages } = counted(fake, () => owner.abort());
  const read = await port.readProject({ project, signal: owner.signal });
  assert.equal(read.ok, false);
  if (!read.ok) assert.equal(read.error.message, CLOSED_MESSAGE);
  assert.equal(pages.readProject, 1, 'a second page was requested after the owner closed');
});

test('readProject: without an abort every page is read and the Project is whole', async () => {
  const { fake, project } = await world();
  const { port, pages } = counted(fake, () => undefined);
  const read = await port.readProject({ project, signal: new AbortController().signal });
  assert.equal(read.ok, true);
  assert.ok((pages.readProject ?? 0) >= 3, 'the items are paged three at a time');
});

test('readProject: aborted before it starts makes no call at all', async () => {
  const { fake, project } = await world();
  const owner = new AbortController();
  owner.abort();
  const { port, pages } = counted(fake, () => undefined);
  const read = await port.readProject({ project, signal: owner.signal });
  assert.equal(read.ok, false);
  assert.equal(pages.readProject ?? 0, 0);
});

test('findIssuesByMarkers and findAllIssuesByMarkers: disposed during page 1, no page 2 call', async () => {
  for (const operation of ['findIssuesByMarkers', 'findAllIssuesByMarkers'] as const) {
    const { fake, repository } = await world();
    const owner = new AbortController();
    const { port, pages } = counted(fake, () => owner.abort());
    const found = await port[operation]({
      repository,
      markers: [formatIssueMarker('space', 'no-such-source')],
      signal: owner.signal,
    });
    assert.equal(found.ok, false, operation);
    if (!found.ok) assert.equal(found.error.message, CLOSED_MESSAGE);
    assert.equal(
      pages.issues,
      1,
      `${operation}: a second page was requested after the owner closed`,
    );
  }
});

test('findProject: aborted before it starts makes no call; the fake keeps the same contract', async () => {
  const { fake } = await world();
  const owner = new AbortController();
  owner.abort();
  const { port, pages } = counted(fake, () => undefined);
  const found = await port.findProject({
    owner: 'fake-human',
    title: 'space',
    signal: owner.signal,
  });
  assert.equal(found.ok, false);
  assert.equal(pages.projects ?? 0, 0);
  const viaFake = await fake.findProject({
    owner: 'fake-human',
    title: 'space',
    signal: owner.signal,
  });
  assert.equal(viaFake.ok, false);
});
