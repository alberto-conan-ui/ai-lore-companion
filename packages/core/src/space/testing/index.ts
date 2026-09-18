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
