/** Command running of the 1.0 library: the runner port, its guard, and `GitPort`. */

export {
  type CommandFailureKind,
  type CommandRunner,
  type RunFailureKind,
  type RunOptions,
  type RunResult,
  commandFailure,
  runSucceeded,
} from './runner.js';
export {
  ALLOW_LIVE_GITHUB_ENV,
  TEST_MODE_ENV,
  type GuardContext,
  type GuardFailure,
  type GuardedCommand,
  checkLiveSystemGuard,
  isTestMode,
} from './guard.js';
export {
  type ExecFileRunnerOptions,
  createExecFileRunner,
  execFileRunner,
} from './exec-file-runner.js';
export {
  type GitBranch,
  type GitFailureKind,
  type GitLogEntry,
  type GitPort,
  type GitResult,
  type RunGitOptions,
  createGitPort,
  runGit,
} from './git-port.js';
