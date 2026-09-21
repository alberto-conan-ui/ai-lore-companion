/**
 * The data the GitHub port carries: repositories, the Project, its fields and
 * views, issues, and the snapshot the Dashboard reads.
 *
 * Every type is plain data, so that it can cross IPC and be kept in the
 * Project cache as JSON.
 */

import type { IssueRef, WriteTarget } from '../desk/types.js';

/** The label that marks a session issue (architecture document, section 3.6; a proposal). */
export const SESSION_LABEL = 'session';

/** The label of a paused focus carried over by migration. */
export const PAUSED_LABEL = 'paused';

/** The labels that say what kind a focus is (product document: a feature, a document, an investigation). */
export const FOCUS_KIND_LABELS: readonly string[] = ['feature', 'document', 'investigation'];

/** The single-select field whose values are the Dashboard's columns. */
export const STAGE_FIELD = 'Stage';

/** The values of the Stage field in the default layout, in order. */
export const DEFAULT_STAGES: readonly string[] = ['Spec', 'Plan', 'Build', 'Review', 'Done'];

/** The single-select field that holds the column of a session issue on the Agents board. */
export const AGENTS_FIELD = 'Agents';

/** The four columns of the Agents board, in order. */
export const AGENTS_COLUMNS = ['Read only', 'Writing', 'Blocked', 'Done'] as const;

/** One column of the Agents board. */
export type AgentsColumn = (typeof AGENTS_COLUMNS)[number];

/** The built-in single-select field of a Project that holds an item's status. */
export const STATUS_FIELD = 'Status';

/** The scope `gh` needs for every Project operation. */
export const PROJECT_SCOPE = 'project';

/** The account `gh` is signed in with, and the scopes of its token. */
export type GitHubAccount = { account: string; scopes: string[] };

/** A repository on GitHub. `fullName` is `owner/name`. */
export type RepositoryInfo = {
  /** GitHub's node id. */
  id: string;
  fullName: string;
  /** The repository's page. */
  url: string;
  /** The address `git clone` and `git push` take. For `FakeGitHub`, a bare repository's path. */
  cloneUrl: string;
  private: boolean;
};

/** A Project (Projects v2) of a user or an organisation. */
export type ProjectInfo = {
  /** GitHub's node id. */
  id: string;
  /** The login of the user or organisation that owns the Project. */
  owner: string;
  number: number;
  title: string;
  url: string;
};

/** One value of a single-select field. */
export type FieldOption = { id: string; name: string };

/** A single-select field of a Project, with its options in GitHub's order. */
export type FieldInfo = { id: string; name: string; options: FieldOption[] };

/** A label to create or update. `color` is six hexadecimal digits without `#`. */
export type LabelSpec = { name: string; color: string; description: string };

/** The id of an issue's item on a Project. */
export type ProjectItemId = string;

/** The layouts a Project view can have. */
export type ProjectViewLayout = 'table' | 'board' | 'roadmap';

/** A view to create on a Project. */
export type ProjectViewSpec = {
  name: string;
  layout: ProjectViewLayout;
  /** The view's filter, in the syntax of the Project's filter bar. */
  filter?: string;
  /**
   * The single-select field whose values are the columns of a board. The API
   * cannot set it, so `ensureProjectView` reports it as a step done by hand.
   */
  columnField?: string;
};

/** A view of a Project. */
export type ProjectViewInfo = {
  id: string;
  number: number;
  name: string;
  layout: ProjectViewLayout;
  filter: string;
};

/** What `ensureProjectView` gives: the view, and what is left for the Human Lead to do on GitHub. */
export type EnsuredProjectView = {
  /**
   * The view, or `null` when the GitHub host's API has no way to create one (a
   * GitHub Enterprise Server older than the view mutations). `byHand` then
   * tells how to make the whole view.
   */
  view: ProjectViewInfo | null;
  /** Whether this call created the view. */
  created: boolean;
  /** One sentence per setting the API cannot make. Empty when nothing is left. */
  byHand: string[];
};

/** A merged pull request of a repository, newest first in a list. */
export type MergedPullRequest = {
  number: number;
  title: string;
  url: string;
  /** ISO 8601. */
  mergedAt: string;
  /** The SHA of the merge commit, or `null` when GitHub does not give one. */
  mergeCommit: string | null;
  headBranch: string;
  baseBranch: string;
};

/** An issue of the plan: an item of a focus, or a standalone item. */
export type PlanItem = {
  issue: IssueRef;
  title: string;
  state: 'open' | 'closed';
  /** The value of the built-in Status field, or `null`. */
  status: string | null;
  labels: string[];
  updatedAt: string;
};

/** A focus: a parent issue with its items (its sub-issues). */
export type FocusItem = PlanItem & {
  /** The value of the Stage field, or `null`. */
  stage: string | null;
  stageChangedAt: string | null;
  /** The first of the issue's labels that names a kind, or `null`. */
  kind: string | null;
  items: PlanItem[];
  /** The address of the published spec, read from the issue's body, or `null`. */
  specUrl: string | null;
};

/** A session issue: one row of the Agents board. */
export type SessionIssue = {
  issue: IssueRef;
  /** The issue's title: "The <engine> session that started at <time>". */
  title: string;
  column: AgentsColumn;
  targets: WriteTarget[];
  attended: boolean;
  person: string;
  machine: string;
  /** ISO 8601, when the issue last changed on GitHub. */
  updatedAt: string;
};

/** The Project as the Dashboard reads it (architecture document, section 3.6). */
export type ProjectSnapshot = {
  /** ISO 8601. */
  fetchedAt: string;
  project: { owner: string; number: number; title: string; url: string };
  /** The Stage field, options in GitHub's order. Empty when the Project has no such field. */
  stageField: { id: string; options: FieldOption[] };
  focuses: FocusItem[];
  standalone: PlanItem[];
  sessions: SessionIssue[];
};

/**
 * One issue on a Project before it is sorted into focuses, standalone items
 * and sessions. The adapter builds it from GitHub's answer and `FakeGitHub`
 * from its memory; `buildProjectSnapshot` does the sorting for both.
 */
export type RawProjectIssue = {
  issue: IssueRef;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  updatedAt: string;
  /** The parent issue's number in the same repository, or `null`. */
  parentNumber: number | null;
  /** The values of the item's single-select fields, by field name. */
  fieldValues: Record<string, string>;
  fieldValuesAt: Record<string, string>;
  /**
   * The sub-issues, in GitHub's order. Their labels and Status are not here:
   * a sub-issue that is on the Project is also one of the issues read, and the
   * snapshot takes both from there, which keeps the reading query cheap.
   */
  subIssues: { issue: IssueRef; title: string; state: 'open' | 'closed' }[];
};
