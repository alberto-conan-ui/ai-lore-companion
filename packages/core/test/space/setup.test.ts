/**
 * The rules of setup that need no disk: names, a GitHub address, the form of
 * "create a Space", and the sentence of a step that GitHub stopped.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  gitHubMissingScope,
  gitHubNotSignedIn,
  gitHubRateLimited,
  gitHubUnreachable,
} from '../../src/space/github/index.js';
import { GH_ADD_SCOPE_COMMAND, GH_SIGN_IN_COMMAND } from '../../src/space/machine/index.js';
import {
  SETUP_LABELS,
  SETUP_VIEWS,
  cloneAddressProblem,
  corpusEntryFileName,
  folderProblem,
  gitHubStepError,
  ownerProblem,
  parseGitHubAddress,
  redactCredentials,
  repositoryNameProblem,
  repositoryProblems,
  spaceNameProblem,
  validateCreateSpaceInput,
} from '../../src/space/setup/index.js';

/** The bell character, written by its code so that this file holds no control character. */
const BELL = String.fromCharCode(7);

test('spaceNameProblem accepts what GitHub and a file system both accept', () => {
  for (const name of ['ai-lore', 'Space_1', 'a', 'v1.0-notes']) {
    assert.equal(spaceNameProblem(name), null, name);
  }
  for (const name of [
    '',
    '.hidden',
    '-option',
    'two words',
    'a/b',
    '..',
    'ends.',
    'repo.git',
    'NUL',
    'com1.txt',
    'index',
    'café',
    'x'.repeat(101),
  ]) {
    assert.equal(typeof spaceNameProblem(name), 'string', JSON.stringify(name));
  }
});

test('ownerProblem follows the rule of a GitHub login', () => {
  assert.equal(ownerProblem('alberto-conan-ui'), null);
  for (const owner of ['', '-a', 'a-', 'a--b', 'a_b', 'a.b', 'x'.repeat(40)]) {
    assert.equal(typeof ownerProblem(owner), 'string', JSON.stringify(owner));
  }
});

test('repositoryNameProblem also refuses the names lore/mirrors/ already has', () => {
  assert.equal(repositoryNameProblem('companion'), null);
  for (const name of ['publish', 'Index', 'generators', '../x']) {
    assert.equal(typeof repositoryNameProblem(name), 'string', name);
  }
});

test('parseGitHubAddress reads owner/name from the three forms', () => {
  const expected = { owner: 'octo', name: 'space.one', fullName: 'octo/space.one' };
  for (const text of [
    'octo/space.one',
    ' https://github.com/octo/space.one ',
    'https://github.com/octo/space.one.git',
    'https://github.com/octo/space.one/',
    'git@github.com:octo/space.one.git',
    'ssh://git@github.com/octo/space.one.git',
  ]) {
    assert.deepEqual(parseGitHubAddress(text), expected, text);
  }
  for (const text of ['', 'octo', 'octo/a/b', 'https://gitlab.com/octo/x', '/tmp/x.git', '-o/x']) {
    assert.equal(parseGitHubAddress(text), null, text);
  }
});

test('parseGitHubAddress refuses other hosts, credentials, options and other transports', () => {
  for (const text of [
    'https://ghp_secret@github.com/octo/x',
    'https://octo:ghp_secret@github.com/octo/x.git',
    'https://github.com.evil.example/octo/x',
    'https://evil.example/github.com/octo/x',
    'http://github.com:8080/octo/x',
    'ssh://git@evil.example/octo/x.git',
    'root@github.com:octo/x.git',
    'ext::sh -c touch%20/tmp/x',
    'ext::octo/x',
    'file:///tmp/octo/x',
    'file://octo/x',
    'git://github.com/octo/x',
    '--upload-pack=touch /tmp/x',
    '-octo/x',
    'octo/..',
    'octo/.',
    '../x',
    'octo/x y',
    'octo/x\ny',
    'octo/café',
    'octo/café',
    `octo/${'x'.repeat(101)}`,
    'octo/x?ref=main',
    'octo/x#readme',
  ]) {
    assert.equal(parseGitHubAddress(text), null, JSON.stringify(text));
  }
  // GitHub accepts a repository whose name begins with a hyphen. It reaches git only after
  // `owner/`, and it is refused as the name of a folder.
  assert.equal(parseGitHubAddress('octo/-x')?.fullName, 'octo/-x');
  assert.notEqual(repositoryNameProblem('-x'), null);
});

test('cloneAddressProblem accepts https, ssh and a path, and never repeats the address', () => {
  for (const address of [
    'https://github.com/octo/x.git',
    'ssh://git@github.com/octo/x.git',
    'git@github.com:octo/x.git',
    '/private/tmp/fake/octo/x.git',
  ]) {
    assert.equal(cloneAddressProblem(address), null, address);
  }
  for (const address of [
    '',
    '-u',
    '--upload-pack=touch /tmp/x',
    'ext::sh -c id',
    'ext::id',
    'fd::3',
    'file:///tmp/x.git',
    'git://github.com/octo/x',
    'http://github.com/octo/x',
    'https://ghp_secret@github.com/octo/x',
    'https://octo:ghp_secret@github.com/octo/x',
    'ssh://git:ghp_secret@github.com/octo/x',
    'relative/path',
    'https://github.com/octo/x y',
  ]) {
    const problem = cloneAddressProblem(address);
    assert.ok(problem !== null, address);
    assert.ok(!problem.includes('ghp_secret'), problem);
  }
  assert.equal(
    redactCredentials('origin https://octo:ghp_secret@github.com/octo/x.git and ssh://u:p@h/x'),
    'origin https://***@github.com/octo/x.git and ssh://***@h/x',
  );
  assert.equal(redactCredentials('https://a:p@ss@github.com/o/x'), 'https://***@github.com/o/x');
  assert.equal(redactCredentials('octo/x'), 'octo/x');
});

test('names: what GitHub, macOS, Linux and Windows all accept', () => {
  for (const name of [
    '.hidden',
    '-dash',
    '_under',
    'trailing ',
    ' leading',
    'trailing.',
    'a/b',
    'a\\b',
    'a:b',
    'café',
    'café',
    'x'.repeat(101),
    'CON',
    'nul.txt',
    'Lpt1',
    'repo.git',
    'Index',
    '',
  ]) {
    assert.notEqual(spaceNameProblem(name), null, JSON.stringify(name));
  }
  for (const name of ['a', 'x'.repeat(100), 'My.Space_1-b', '123', 'null', 'console']) {
    assert.equal(spaceNameProblem(name), null, name);
  }
  // Names that differ only by case are one folder on some filesystems.
  assert.deepEqual(
    repositoryProblems([
      { name: 'App', github: 'octo/app' },
      { name: 'app', github: 'octo/other' },
    ]).map((problem) => problem.field),
    ['repositories[1].name'],
  );
  for (const name of ['Publish', 'INDEX', 'generators']) {
    assert.notEqual(repositoryNameProblem(name), null, name);
  }
});

test('repositoryProblems names the field of each problem', () => {
  const problems = repositoryProblems([
    { name: 'app', github: 'octo/app' },
    { name: 'APP', github: 'octo/app2' },
    { name: 'site', github: 'not an address' },
    { name: 'tool', github: 'octo/tool', cloneAddress: '--upload-pack=x' },
  ]);
  assert.deepEqual(
    problems.map((problem) => problem.field),
    ['repositories[1].name', 'repositories[2].github', 'repositories[3].cloneAddress'],
  );
});

test('validateCreateSpaceInput lists every problem of the form', () => {
  assert.deepEqual(
    validateCreateSpaceInput({
      name: 'demo',
      description: 'A demonstration.\nTwo lines.',
      owner: 'octo',
      parentDir: '/tmp',
    }),
    [],
  );
  const problems = validateCreateSpaceInput({
    name: 'bad name',
    description: `bell${BELL}`,
    owner: '',
    parentDir: 'relative/path',
  });
  assert.deepEqual(problems.map((problem) => problem.field).sort(), [
    'description',
    'name',
    'owner',
    'parentDir',
  ]);
  assert.equal(typeof folderProblem('The folder', ''), 'string');
});

test("corpusEntryFileName is the Space's name in lower case", () => {
  assert.equal(corpusEntryFileName('AI-Lore'), 'ai-lore.md');
});

test('gitHubStepError adds the guidance sentence for each kind', () => {
  const unreachable = gitHubStepError(gitHubUnreachable('no route to host'));
  assert.equal(unreachable.kind, 'github-unreachable');
  assert.match(
    unreachable.message,
    /GitHub could not be reached: no route to host\. Check the network/,
  );
  assert.match(unreachable.message, /stays in place/);

  const scope = gitHubStepError(gitHubMissingScope('project'));
  assert.equal(scope.kind, 'github-missing-scope');
  assert.ok(scope.message.includes(GH_ADD_SCOPE_COMMAND));

  const signedOut = gitHubStepError(gitHubNotSignedIn());
  assert.ok(signedOut.message.includes(GH_SIGN_IN_COMMAND));

  assert.match(gitHubStepError(gitHubRateLimited(30)).message, /after 30 seconds/);
  assert.match(gitHubStepError(gitHubRateLimited(null)).message, /in a few minutes/);
});

test('the default layout has the labels of the kinds and of a session, and three views', () => {
  assert.deepEqual(
    SETUP_LABELS.map((label) => label.name),
    ['feature', 'document', 'investigation', 'session'],
  );
  assert.ok(SETUP_LABELS.every((label) => /^[0-9a-f]{6}$/.test(label.color)));
  assert.deepEqual(
    SETUP_VIEWS.map((view) => `${view.name}:${view.layout}:${view.columnField ?? ''}`),
    ['Focuses by Stage:board:Stage', 'Items by focus:table:', 'Agents board:board:Agents'],
  );
});
