/**
 * The smoke test of the 1.0 library (stage M2): one pass through its modules
 * in the order the app uses them, on a Space built in the temporary folder.
 * Each module has its own tests; this one shows that they fit together.
 * Everything is imported from the package's main barrel, as the app does,
 * except the fixture builders, which have their own entry.
 */

import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  type ChangeEntry,
  type Root,
  createGitPort,
  defaultBaselineOf,
  deskPaths,
  detectFolder,
  endSession,
  enterWriting,
  execFileRunner,
  leaveWriting,
  listBaselinePoints,
  listClaims,
  markRootReviewed,
  openDesk,
  readChangesIn,
  readLore,
  readSessionCloseCommits,
  readSpaceManifest,
  resolveRoots,
  startSession,
} from '../../src/index.js';
import { makeSpaceFixture, makeV08Fixture } from '../../src/space/testing/index.js';
import { loreTemplateDir, runPython, useTempDir } from '../support/index.js';

const runner = execFileRunner;
const WRITE_GUARD = join(loreTemplateDir(), 'lore', 'contracts', 'core', 'write-guard.py');

function must<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) assert.fail(result.error.message);
  return result.value;
}

async function changesOf(root: Root, baseline: string): Promise<ChangeEntry[]> {
  assert.ok(root.tracking.tracked);
  const { workTree, subPath } = root.tracking;
  return must(await readChangesIn(runner, workTree, baseline, subPath)).entries;
}

test('a Space is detected, read, written under a claim, reviewed and closed through the library', async (t) => {
  const fixture = await makeSpaceFixture({
    templateDir: loreTemplateDir(),
    repositories: ['alpha'],
  });
  t.after(() => fixture.cleanup());
  const alpha = fixture.repositories[0];
  assert.ok(alpha);
  const git = createGitPort(runner);

  // What kind of folder this is, and what it holds.
  const verdict = must(await detectFolder(fixture.root, { git }));
  assert.equal(verdict.kind, 'space');
  const manifest = must(await readSpaceManifest(fixture.root));
  assert.equal(manifest.name, fixture.manifest.name);
  assert.deepEqual(
    manifest.repositories.map((repository) => repository.name),
    ['alpha'],
  );
  const lore = must(await readLore(fixture.root));
  assert.deepEqual(lore.problems, []);

  // The desk, outside the Space, and the roots.
  const data = useTempDir(t, 'ai-lore-library-');
  const paths = deskPaths(join(data, 'user data'), fixture.root);
  const desk = must(openDesk(paths));
  const roots = must(await resolveRoots({ spaceRoot: fixture.root, runner }));
  assert.deepEqual(
    roots.map((root) => root.id),
    ['lore', 'workbench', 'publish:publish', 'repo:alpha'],
  );
  const root = roots.find((candidate) => candidate.id === 'repo:alpha');
  assert.ok(root);

  // A session enters Writing on the repository, and the check script follows the claim.
  const branch = await alpha.checkout.git('rev-parse', '--abbrev-ref', 'HEAD');
  must(startSession(desk, { id: 's1', engine: 'claude-code' }));
  const entered = must(
    enterWriting(desk, manifest, {
      sessionId: 's1',
      targets: [{ kind: 'repository', name: 'alpha', branch }],
    }),
  );
  assert.equal(entered.session.mode, 'writing');
  const guard = (relativePath: string) =>
    runPython(
      WRITE_GUARD,
      [
        '--space',
        fixture.root,
        '--desk',
        paths.desk,
        '--session',
        's1',
        '--path',
        join(fixture.root, relativePath),
      ],
      { cwd: data },
    );
  const inside = await guard('repos/alpha/src/new-file.ts');
  assert.equal(inside.code, 0, inside.stderr);
  const outside = await guard('lore/corpus/new-card.md');
  assert.equal(outside.code, 2, outside.stdout);
  assert.match(outside.stderr, /Writing/);

  // What changed against the default baseline, and marking the root as reviewed.
  const before = must(await defaultBaselineOf({ runner, desk, root }));
  assert.equal(before.source, 'first-seen');
  assert.equal(before.baseline, alpha.headCommit);
  const uncommitted = await changesOf(root, before.baseline);
  assert.equal(uncommitted.length, alpha.uncommitted.length);
  alpha.checkout.write('src/made-by-the-session.ts', 'export const made = true;\n');
  const committed = await alpha.checkout.commitAll('Work of the session');
  assert.ok((await changesOf(root, before.baseline)).length > 0, 'committed work is listed');

  const marked = must(await markRootReviewed({ runner, desk, root }));
  assert.equal(marked.baseline, committed);
  const after = must(await defaultBaselineOf({ runner, desk, root }));
  assert.deepEqual([after.source, after.baseline], ['reviewed-mark', committed]);
  assert.deepEqual(await changesOf(root, after.baseline), [], 'committed work is cleared');

  // The session leaves Writing with the commit it left, and ends.
  const closing = must(await readSessionCloseCommits({ runner, desk, roots, sessionId: 's1' }));
  assert.deepEqual(closing, { closes: [{ rootId: root.id, commit: committed }], skipped: [] });
  const left = must(leaveWriting(desk, 's1', { closes: closing.closes }));
  assert.equal(left.session.mode, 'read-only');
  assert.equal(left.closes.length, 1);
  assert.deepEqual(must(listClaims(desk)), []);
  const refused = await guard('repos/alpha/src/new-file.ts');
  assert.equal(refused.code, 2, refused.stdout);
  const ended = must(endSession(desk, 's1'));
  assert.ok(ended.session.closedAt);

  // The timeline of the root shows the mark, the session's close and its commit.
  const points = must(await listBaselinePoints({ runner, desk, root }));
  assert.equal(points.head, committed);
  const atHead = points.points.filter((point) => point.commit === committed);
  assert.deepEqual(atHead.map((point) => point.kind).sort(), [
    'commit',
    'reviewed-mark',
    'session-close',
  ]);
  const commit = atHead.find((point) => point.kind === 'commit');
  assert.ok(commit && commit.kind === 'commit');
  assert.equal(commit.sessionId, 's1');
});

test('a v0.8 project is detected as legacy, with where its version stands', async (t) => {
  const fixture = await makeV08Fixture();
  t.after(() => fixture.cleanup());
  const verdict = must(await detectFolder(fixture.root, { git: createGitPort(runner) }));
  assert.equal(verdict.kind, 'legacy');
  if (verdict.kind !== 'legacy') return;
  assert.equal(verdict.coreVersion, '0.8');
  assert.equal(verdict.versionStanding, 'v0.8');
  assert.equal(verdict.migratable, true);
});
