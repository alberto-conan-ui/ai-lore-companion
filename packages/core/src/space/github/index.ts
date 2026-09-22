/**
 * GitHub access of the 1.0 library: `GitHubPort`, its errors, the gh adapter,
 * and the snapshot of the Project.
 *
 * `FakeGitHub` (`./fake.ts`) is not exported here. It is a test double, and
 * this barrel is loaded by the app in production; tests reach it through the
 * package entry `@ai-lore-companion/core/testing`.
 */

export {
  AGENTS_COLUMNS,
  AGENTS_FIELD,
  type AgentsColumn,
  DEFAULT_STAGES,
  DEFAULT_VIEWS,
  type EnsuredProjectView,
  FOCUS_LEVEL,
  KIND_LABELS,
  LEVEL_FIELD,
  LEVEL_VALUES,
  type FieldInfo,
  type FieldOption,
  type FocusItem,
  type GitHubAccount,
  type LabelSpec,
  type MergedPullRequest,
  PAUSED_LABEL,
  PROJECT_SCOPE,
  type PlanItem,
  type ProjectInfo,
  type ProjectItemId,
  type ProjectSnapshot,
  type ProjectViewInfo,
  type ProjectViewLayout,
  type ProjectViewSpec,
  type RawProjectIssue,
  type RepositoryInfo,
  SESSION_LABEL,
  STAGE_FIELD,
  STATUS_FIELD,
  type SessionIssue,
  type OpenPullRequest,
  type PullRequestChecks,
  type PullRequestReview,
} from './types.js';
export {
  type GhApiResponse,
  type GitHubError,
  type GitHubErrorKind,
  type GraphQlError,
  classifyGhFailure,
  failed as gitHubFailed,
  graphQlErrors,
  isSchemaAbsence,
  missingScope as gitHubMissingScope,
  notFound as gitHubNotFound,
  notSignedIn as gitHubNotSignedIn,
  parseGhApiResponse,
  rateLimited as gitHubRateLimited,
  retryAfterSeconds,
  unreachable as gitHubUnreachable,
} from './errors.js';
export type { GitHubPort, GitHubResult } from './port.js';
export { bodyHasMarker, formatIssueMarker, isIssueMarker } from './marker.js';
export {
  ISSUE_BODY_MAX,
  ISSUE_TITLE_MAX,
  argumentError as gitHubArgumentError,
  isBranchName,
  isRepositoryName,
  issueTextError,
  labelError,
  markersError,
  splitRepositoryName,
} from './validate.js';
export {
  type SessionBlock,
  bodyGoals,
  buildProjectSnapshot,
  formatSessionBlock,
  formatSpecLink,
  parseSessionBlock,
  parseSpecLink,
} from './snapshot.js';
export { describeViewByHand, viewDrift, viewStepsByHand } from './views.js';
export {
  GRAPHQL_ARGS,
  type GhCliOptions,
  createGhCliGitHub,
  graphqlOperationName,
} from './gh-cli.js';
