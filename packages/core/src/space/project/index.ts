/** The Project snapshot, its cache, the Dashboard model, and the sessions' issues on the Agents board. Phase M7.1 owns this file. */

export {
  PROJECT_CACHE_FILE,
  type ProjectCache,
  type ProjectCacheFailure,
  isProjectCacheRecord,
  isProjectSnapshot,
  readProjectCache,
  recordProjectFailure,
  recordProjectSnapshot,
} from './cache.js';
// Phase M7.2: the Dashboard's model.
export {
  type BoardRow,
  DEFAULT_STALE_AFTER_MS,
  DONE_STATUS,
  type DashboardGate,
  type DashboardInput,
  type DashboardModel,
  type FocusCard,
  type ItemCard,
  type NeedsYouEntry,
  REVIEW_STAGE,
  type StageColumn,
  dashboardModel,
} from './dashboard-model.js';

// Stage D1: the Dashboard's repositories.
export {
  type RepositoriesModel,
  type RepositoriesModelInput,
  type RepositoryRead,
  type RepositoryRow,
  type RepositoryRowChanges,
  repositoriesModel,
  mirrorDrift,
  type MirrorDrift,
} from './repositories-model.js';

export {
  type LocalFolder,
  type SessionIssueContent,
  type SessionIssuePlace,
  agentsField,
  closeSessionIssue,
  describeGitHubFailure,
  developItemBranch,
  findSpaceProject,
  formatHandoverComment,
  formatSessionIssueBody,
  issueRefFor,
  moveSessionIssue,
  putSessionIssue,
  readHandover,
  sessionIssueMarker,
  sessionIssueTitle,
} from './session-issue.js';
