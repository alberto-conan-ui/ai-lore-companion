/**
 * The machine check (phase M3.2): whether `git`, `gh`, an engine of the
 * registry and `python3` are on the machine and usable, and the guidance for
 * each that is not. The companion checks and guides; it installs nothing.
 */

export type {
  EngineCheck,
  EngineInstallState,
  EngineSignInProbe,
  EngineSignInState,
  MachineCheck,
  MachineCheckOptions,
  MachineCheckState,
  MachineCheckStateKind,
  MachinePlatform,
  MachineRequirementCheck,
  MachineRequirementId,
  ProbeRun,
} from './types.js';
export {
  MIN_GH_VERSION,
  MIN_GIT_VERSION,
  MIN_PYTHON_VERSION,
  type ToolVersion,
  compareToolVersions,
  formatToolVersion,
  parseToolVersion,
} from './versions.js';
export { type GhAuthReading, parseGhAuthStatus } from './gh-auth.js';
export {
  GH_ADD_SCOPE_COMMAND,
  GH_SIGN_IN_COMMAND,
  GITHUB_HOST,
  type Guidance,
  type GuidanceSubject,
  INSTALL_LINKS,
  REQUIRED_GH_SCOPE,
  guidanceFor,
  platformInstallCommand,
} from './guidance.js';
export {
  CLAUDE_AUTH_STATUS_ARGS,
  CLAUDE_BINARY_NAME,
  CLAUDE_SIGN_IN_COMMAND,
  isClaudeEngine,
  parseClaudeAuthStatus,
  parseOpencodeAuthList,
  probeEngineSignIn,
} from './engine-sign-in.js';
export {
  DEFAULT_MACHINE_CHECK_TIMEOUT_MS,
  type GitHubCheck,
  checkEngine,
  checkGh,
  checkGit,
  checkGitHub,
  checkMachine,
  checkPython3,
  engineRequirement,
} from './machine-check.js';
export { type SetUpItemId, type SetUpReadiness, setUpReadiness } from './set-up.js';
export {
  GH_WEB_SIGN_IN_COMMAND,
  type SetupCommandId,
  parseDeviceCode,
  setupCommandLine,
  setupCommands,
} from './commands.js';
