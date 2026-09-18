/**
 * `GitHubPort`: everything the 1.0 library asks of GitHub.
 *
 * Core defines the port; the app builds the gh adapter (`createGhCliGitHub`)
 * and tests build `FakeGitHub`. No operation throws for a reason the caller
 * must handle: each returns a `Result` whose error is a `GitHubError`.
 *
 * The contract both implementations keep:
 *
 * - A `find…` operation answers `null` for a thing that does not exist; it
 *   fails only when GitHub could not be asked.
 * - An `ensure…` operation can be run again: it creates what is missing and
 *   leaves what exists.
 * - A `create…` operation always creates. A caller that must not create twice
 *   finds first: the repository and the Project by name, an issue by a marker
 *   in its body. What was created is found by the very next call.
 * - `addSubIssue`, `addIssueToProject`, `linkProjectToRepository`,
 *   `setSingleSelect` and `closeIssue` succeed when what they ask for already holds.
 * - Writes are made one after the other, never at the same time (section 6.3).
 * - While GitHub cannot be reached every operation fails with `unreachable`
 *   and changes nothing. Nothing is queued.
 */

import type { IssueRef } from '../desk/types.js';
import type { Result } from '../result.js';
import type { GitHubError } from './errors.js';
import type {
  EnsuredProjectView,
  FieldInfo,
  GitHubAccount,
  LabelSpec,
  MergedPullRequest,
  ProjectInfo,
  ProjectItemId,
  ProjectSnapshot,
  ProjectViewSpec,
  RepositoryInfo,
} from './types.js';

/** The result of a `GitHubPort` operation. */
export type GitHubResult<T> = Result<T, GitHubError>;

/** The operations on GitHub. `repository` is always `owner/name`. */
export type GitHubPort = {
  /** The signed-in account and its token's scopes. Fails with `not-signed-in` when there is none. */
  auth(): Promise<GitHubResult<GitHubAccount>>;

  // ---------- repositories ----------

  /** The repository `owner/name`, or `null` when it does not exist or cannot be seen. */
  findRepository(fullName: string): Promise<GitHubResult<RepositoryInfo | null>>;
  /** Create an empty repository. Fails when the name is taken. */
  createRepository(arg: {
    owner: string;
    name: string;
    private: boolean;
  }): Promise<GitHubResult<RepositoryInfo>>;

  // ---------- the Project ----------

  /** The open Project of `owner` with exactly this title, or `null`. The oldest when several match. */
  findProject(arg: { owner: string; title: string }): Promise<GitHubResult<ProjectInfo | null>>;
  /** Create a Project. GitHub allows two with one title, so a caller finds first. */
  createProject(arg: { owner: string; title: string }): Promise<GitHubResult<ProjectInfo>>;
  /**
   * The single-select field `name` with at least `options`. A missing field is
   * created with the options in the given order; missing options are added
   * after the existing ones; nothing is removed or reordered.
   */
  ensureSingleSelectField(arg: {
    project: ProjectInfo;
    name: string;
    options: string[];
  }): Promise<GitHubResult<FieldInfo>>;
  /**
   * The view `spec.name`, created when missing, with its filter set. What the
   * API cannot set is returned as sentences in `byHand`. On a GitHub host
   * whose API cannot create views at all this succeeds with `view: null` and
   * the whole view as one sentence in `byHand`.
   */
  ensureProjectView(arg: {
    project: ProjectInfo;
    spec: ProjectViewSpec;
  }): Promise<GitHubResult<EnsuredProjectView>>;
  /** Link the Project to a repository, so that it is listed on the repository's Projects tab. */
  linkProjectToRepository(arg: {
    project: ProjectInfo;
    repository: string;
  }): Promise<GitHubResult<void>>;
  /** Create each label, or update its colour and description when it exists. */
  ensureLabels(arg: { repository: string; labels: LabelSpec[] }): Promise<GitHubResult<void>>;

  // ---------- issues ----------

  /**
   * The issue, open or closed, whose body has `marker` as a whole line outside
   * a code block (`bodyHasMarker`), or `null`. `marker` is made by
   * `formatIssueMarker`; any other text fails with `failed`. The oldest issue
   * when several have it; a newer one is not reported. Reads every page of the
   * repository's issues, not GitHub's search index, so an issue created a
   * moment ago is found and there is no limit of 1,000 results.
   */
  findIssueByMarker(arg: {
    repository: string;
    marker: string;
  }): Promise<GitHubResult<IssueRef | null>>;
  /** `findIssueByMarker` for many markers in one reading of the repository's issues. */
  findIssuesByMarkers(arg: {
    repository: string;
    markers: string[];
  }): Promise<GitHubResult<Record<string, IssueRef | null>>>;
  /**
   * Every issue, open or closed, that has each marker, oldest first; an empty
   * list for a marker no issue has. Reads every page of the repository's
   * issues. For a check that a marker is on one issue only.
   */
  findAllIssuesByMarkers(arg: {
    repository: string;
    markers: string[];
  }): Promise<GitHubResult<Record<string, IssueRef[]>>>;
  /**
   * Create an issue. Every label must exist; an unknown label fails with
   * `not-found`. A title or body GitHub would refuse (empty title, more than
   * `ISSUE_TITLE_MAX` or `ISSUE_BODY_MAX` characters) fails with `failed`
   * before GitHub is asked; nothing is cut to fit. The same holds for
   * `updateIssue` and `comment`.
   *
   * When the answer is lost (a timeout, a rate limit after GitHub accepted the
   * issue), the issue may exist although this call failed. A caller that put a
   * marker in the body finds it with `findIssueByMarker` on its next run.
   */
  createIssue(arg: {
    repository: string;
    title: string;
    body: string;
    labels: string[];
  }): Promise<GitHubResult<IssueRef>>;
  /** Replace an issue's title, its body, or both. */
  updateIssue(arg: {
    issue: IssueRef;
    title?: string;
    body?: string;
  }): Promise<GitHubResult<void>>;
  /** Make `child` a sub-issue of `parent`. Fails when `child` has another parent. */
  addSubIssue(arg: { parent: IssueRef; child: IssueRef }): Promise<GitHubResult<void>>;
  /** Put an issue on the Project and give its item. The same item when it is already there. */
  addIssueToProject(arg: {
    project: ProjectInfo;
    issue: IssueRef;
  }): Promise<GitHubResult<ProjectItemId>>;
  /** Set a single-select field of an item. `option` is the option's name; an unknown name fails with `not-found`. */
  setSingleSelect(arg: {
    project: ProjectInfo;
    item: ProjectItemId;
    field: FieldInfo;
    option: string;
  }): Promise<GitHubResult<void>>;
  /** Add a comment to an issue. */
  comment(arg: { issue: IssueRef; body: string }): Promise<GitHubResult<void>>;
  /** Close an issue. */
  closeIssue(arg: { issue: IssueRef }): Promise<GitHubResult<void>>;
  /**
   * Create the branch `name` in `branchRepository`, linked to the issue
   * (`gh issue develop --branch-repo`). The same branch when the issue already has it.
   */
  developBranch(arg: {
    issue: IssueRef;
    branchRepository: string;
    name: string;
  }): Promise<GitHubResult<{ branch: string }>>;

  // ---------- reads ----------

  /** The Project's issues, sorted into focuses, standalone items and session issues. */
  readProject(arg: { project: ProjectInfo }): Promise<GitHubResult<ProjectSnapshot>>;
  /** The merged pull requests of a repository, newest first, at most `limit`. */
  mergedPullRequests(arg: {
    repository: string;
    limit: number;
  }): Promise<GitHubResult<MergedPullRequest[]>>;
};
