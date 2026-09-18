/** Support for core's own tests. Owned by phase M2.1; other phases report what they need added. */

export { type CleanupHost, useTempDir } from './temp.js';
export { useBareRemote, useClone, usePlainRepository, useTempGitRepo } from './git.js';
export { loreTemplateDir, repositoryRoot } from './paths.js';
export { runPython } from './python.js';
