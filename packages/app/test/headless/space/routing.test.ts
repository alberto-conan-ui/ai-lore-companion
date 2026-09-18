import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createGitPort, execFileRunner, spaceKey } from '@ai-lore-companion/core';
import {
  type PlainRepositoryFixture,
  type SpaceFixture,
  type TempDir,
  type V08Fixture,
  makePlainRepository,
  makeSpaceFixture,
  makeTempDir,
  makeV08Fixture,
} from '@ai-lore-companion/core/testing';
import {
  SPACE_ROUTING_ENV,
  isSpaceRoutingOn,
  routeFolder,
  windowTitleFor,
} from '../../../src/main/space/routing.js';
import { LORE_TEMPLATE_DIR } from './space-harness.js';

// Routing by detection (architecture document, section 2.4): with the switch on, each of the
// three fixtures goes to its 1.0 window; with it off, every folder is routed as today and
// detection is not run.

const git = createGitPort(execFileRunner);
let space: SpaceFixture;
let legacy: V08Fixture;
let older: V08Fixture;
let plain: PlainRepositoryFixture;
let empty: TempDir;

before(async () => {
  space = await makeSpaceFixture({ templateDir: LORE_TEMPLATE_DIR, name: 'routing-space' });
  legacy = await makeV08Fixture({ name: 'routing-project' });
  older = await makeV08Fixture({ name: 'older-project', coreVersion: '0.7' });
  plain = await makePlainRepository();
  empty = makeTempDir();
});

after(() => {
  space.cleanup();
  legacy.cleanup();
  older.cleanup();
  plain.cleanup();
  empty.cleanup();
});

test('the switch is on only when AI_LORE_SPACE_ROUTING is exactly 1', () => {
  assert.equal(isSpaceRoutingOn({ [SPACE_ROUTING_ENV]: '1' }), true);
  assert.equal(isSpaceRoutingOn({ [SPACE_ROUTING_ENV]: 'true' }), false);
  assert.equal(isSpaceRoutingOn({ [SPACE_ROUTING_ENV]: '0' }), false);
  assert.equal(isSpaceRoutingOn({}), false);
});

test('switch on: a Space goes to the Space window', async () => {
  const route = await routeFolder(space.root, { spaceRouting: true, git });
  assert.equal(route.route, 'space-window');
  assert.ok(route.route === 'space-window');
  assert.equal(route.init.mode, 'space');
  assert.ok(route.init.mode === 'space');
  assert.equal(route.init.space.root, space.root);
  assert.equal(route.init.space.name, 'routing-space');
  assert.equal(route.init.space.key, spaceKey(space.root));
  assert.deepEqual(route.init.space.manifest, space.manifest);
  assert.equal(windowTitleFor(route.init), 'routing-space');
});

test('switch on: an AI-Lore project of v0.8 goes to the migration screen, migratable', async () => {
  const route = await routeFolder(legacy.root, { spaceRouting: true, git });
  assert.ok(route.route === 'space-window');
  assert.ok(route.init.mode === 'migration');
  assert.equal(route.init.folder, route.detected.root);
  assert.equal(route.init.legacy.projectName, 'routing-project');
  assert.equal(route.init.legacy.coreVersion, '0.8');
  assert.equal(route.init.legacy.migratable, true);
  assert.equal(route.init.legacy.versionStanding, 'v0.8');
  assert.equal(route.init.legacy.manifestLocation, 'memory-folder');
  assert.match(route.init.legacy.reason, /can be migrated/);
});

test('switch on: a project older than v0.8 goes to the migration screen in its upgrade-first state', async () => {
  const route = await routeFolder(older.root, { spaceRouting: true, git });
  assert.ok(route.route === 'space-window');
  assert.ok(route.init.mode === 'migration');
  assert.equal(route.init.legacy.migratable, false);
  assert.equal(route.init.legacy.versionStanding, 'older');
  assert.equal(route.init.legacy.manifestLocation, 'lore-folder');
  assert.match(route.init.legacy.reason, /upgraded to v0\.8 first/);
});

test('switch on: a plain repository goes to the not-a-Space screen with the offer', async () => {
  const route = await routeFolder(plain.dir, { spaceRouting: true, git });
  assert.ok(route.route === 'space-window');
  assert.ok(route.init.mode === 'not-a-space');
  assert.equal(route.init.plainRepository, true);
  assert.match(route.init.reason, /git repository with no Lore/);
});

test('switch on: any other folder goes to the not-a-Space screen without the offer', async () => {
  const route = await routeFolder(empty.dir, { spaceRouting: true, git });
  assert.ok(route.route === 'space-window');
  assert.ok(route.init.mode === 'not-a-space');
  assert.equal(route.init.plainRepository, false);
});

test('switch on: a path that is not a folder gives a failure, not a window', async () => {
  const route = await routeFolder(`${empty.dir}/missing`, { spaceRouting: true, git });
  assert.ok(route.route === 'failed');
  assert.equal(route.error.kind, 'not-a-folder');
});

test("switch off: every folder gets today's routing and detection is not run", async () => {
  let detectCalls = 0;
  const detect: typeof import('@ai-lore-companion/core').detectFolder = async () => {
    detectCalls += 1;
    throw new Error('detection must not run with the switch off');
  };
  for (const folder of [space.root, legacy.root, older.root, plain.dir, empty.dir]) {
    const route = await routeFolder(folder, { spaceRouting: false, git, detect });
    assert.deepEqual(route, { route: 'v08-routing', root: folder });
  }
  assert.equal(detectCalls, 0);
});
