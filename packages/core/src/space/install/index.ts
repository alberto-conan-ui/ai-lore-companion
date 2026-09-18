/**
 * Installing a Space's Lore into Claude Code: the projection of a resolved Lore
 * (a plugin with one skill per verb and per process, and a copy of each
 * contract check script), the record of what was written, and the writer that
 * installs, installs again and plans without writing. No hook is written here.
 */

export {
  INSTALL_RECORD_VERSION,
  type ClaudeCodeInstallPaths,
  type ClaudeCodeProjection,
  type InstallAction,
  type InstallActionKind,
  type InstallFailureKind,
  type InstallOptions,
  type InstallOutcome,
  type InstallPlan,
  type InstallRecord,
  type InstallReport,
  type InstallReportKind,
  type InstalledCardRef,
  type InstalledFile,
  type InstalledFileKind,
  type ProjectedFile,
} from './types.js';
export {
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_NAME_MAX_LENGTH,
  type SafeDescription,
  type SkillFailureKind,
  type SkillSource,
  checkSkillName,
  renderSkillFile,
  safeSkillDescription,
} from './skill.js';
export {
  CLAUDE_CODE_INSTALL_FOLDER,
  CLAUDE_CODE_INSTALL_LAYOUT,
  CLAUDE_CODE_PLUGIN_PREFIX,
  claudeCodeCheckPath,
  claudeCodeInstallPaths,
  claudeCodeSkillPath,
  projectClaudeCode,
} from './claude-code.js';
export { installClaudeCode, planClaudeCodeInstall, readInstallRecord } from './writer.js';
