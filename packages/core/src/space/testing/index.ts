/**
 * Test doubles and fixture builders that core's tests and the app's tests
 * share. Owned by M2.2 after M2.1 (`makeSpaceFixture`, `makeV08Fixture`).
 *
 * This file is the package entry `@ai-lore-companion/core/testing`. It is not
 * re-exported by `space/index.ts`, so production code never loads it.
 */

export { type TempDir, enableTestMode, makeTempDir } from './temp.js';
export {
  type ScriptedCall,
  type ScriptedReply,
  type ScriptedRule,
  type ScriptedRunner,
  createScriptedRunner,
} from './scripted-runner.js';
export {
  type PlainRepositoryFixture,
  type TempGitRepo,
  type TempGitRepoOptions,
  cloneTempRepo,
  configureTestIdentity,
  makeBareRemote,
  makePlainRepository,
  makeTempGitRepo,
  openTempGitRepo,
} from './git-repo.js';
export {
  type FixtureChange,
  type SpaceFixture,
  type SpaceFixtureOptions,
  type SpaceFixtureRepository,
  makeSpaceFixture,
} from './space-fixture.js';
export {
  type V08Fixture,
  type V08FixtureContents,
  type V08FixtureOptions,
  makeV08Fixture,
} from './v08-fixture.js';
export {
  type FakeGitHub,
  type FakeGitHubCall,
  type FakeGitHubOptions,
  type FakeGitHubState,
  type FakeIssue,
  type FakeProject,
  type FakeRepository,
  createFakeGitHub,
} from '../github/fake.js';
