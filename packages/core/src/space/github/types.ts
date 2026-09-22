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

/**
 * The labels that say what kind of work a root is. The kind belongs to the
 * root and its children inherit it, so it is not repeated on every item.
 *
 * Only the `kind` of a focus is read from this list. **Whether an issue is a
 * focus comes from {@link LEVEL_FIELD} and never from here.** The two
 * questions were once decided by this one list, so a root labelled `bug` was
 * read as an item only because `bug` happened not to be in it — and adding it
 * would silently have turned every bug into a focus. The name no longer says
 * `FOCUS_`, so there is nothing here to reach for when the focus test is next
 * looked at.
 */
export const KIND_LABELS: readonly string[] = [
  'feature',
  'document',
  'investigation',
  'bug',
  'maintenance',
];

/**
 * The single-select field on the Project that records whether an issue is a
 * focus or an item.
 *
 * The companion used to derive this: an issue was a focus when it had a Stage,
 * **or** a kind label, **or** sub-issues. No GitHub filter can express a
 * three-way disjunction over a field, a label set and a relation, so the
 * Dashboard could show eight focuses while every GitHub view showed fifty-eight
 * mixed cards. The two could not agree by construction. The Project records the
 * category now, and the companion reads it.
 */
export const LEVEL_FIELD = 'Level';

/**
 * The value of {@link LEVEL_FIELD} that marks a focus. The field's other value
 * is `Item`, and nothing names it: anything that is not exactly `Focus` is read
 * as an item, an issue with no value at all included. Such an issue is also
 * reported in {@link ProjectSnapshot.problems}, so a hole in the Project is
 * visible rather than guessed at.
 */
export const FOCUS_LEVEL = 'Focus';

/** The values of {@link LEVEL_FIELD}, in order: a root with children, and one without. */
export const LEVEL_VALUES: readonly string[] = [FOCUS_LEVEL, 'Item'];

/** The single-select field whose values are the Dashboard's columns. */
export const STAGE_FIELD = 'Stage';

/**
 * The values of the Stage field in the default layout, in order.
 *
 * `Spec` and `Plan` were merged into one value: a unit of work may be broken
 * down while its spec is still being written, so the two were never separable
 * in practice. `Backlog` was added in front, for work that is recorded and not
 * yet on the plan; the default plan view filters it out with `-stage:Backlog`,
 * which needs the value to exist.
 *
 * `ensureSingleSelectField` only adds options it does not find. A Project
 * created before this change keeps its old values and gains these, so it ends
 * with both sets. Renaming the old values on an existing Project is a
 * migration and is not done here: an option carries its id, and recreating one
 * loses every item's value for the field.
 */
export const DEFAULT_STAGES: readonly string[] = [
  'Backlog',
  'Spec and Planning',
  'Build',
  'Review',
  'Done',
];

/** The single-select field that holds the column of a session issue on the Agents board. */
export const AGENTS_FIELD = 'Agents';

/** The four columns of the Agents board, in order. */
export const AGENTS_COLUMNS = ['Read only', 'Writing', 'Blocked', 'Done'] as const;

/** One column of the Agents board. */
export type AgentsColumn = (typeof AGENTS_COLUMNS)[number];

/** The built-in single-select field of a Project that holds an item's status. */
export const STATUS_FIELD = 'Status';

/**
 * The values of {@link STATUS_FIELD}, in order. `Status` is GitHub's own field
 * and a new Project arrives with `Todo`, `In Progress` and `Done`; `Paused` is
 * the one this layout adds, so setup makes sure it exists.
 *
 * `Status` is the **activity** axis and answers one question: is a desk on
 * this now. It used to carry two meanings at once with the lifecycle, and a
 * focus nobody had touched for a day still read as busy.
 *
 * - `Todo` — no session has yet worked it. It never means anything else, so
 *   nothing ever moves a root back to it.
 * - `In Progress` — a desk is on it **now**.
 * - `Paused` — started, unfinished, and no desk on it.
 * - `Done` — finished. Only the Human Lead sets it: it is the Done call.
 */
export const STATUS_VALUES = ['Todo', 'In Progress', 'Paused', 'Done'] as const;

/** One value of the Status field. */
export type StatusValue = (typeof STATUS_VALUES)[number];

/** The view of everything that belongs to a root, grouped by the root it belongs to. */
const UNDER_PARENT_VIEW = 'Under a parent';

/** The Project's built-in field naming an issue's parent, which the table groups by. */
const PARENT_FIELD = 'Parent issue';

/** The Stage value for work that is recorded and not yet on the plan. */
const BACKLOG_STAGE = 'Backlog';

/**
 * The views of the default Project layout that exist from setup.
 *
 * The set a Space starts with used to be "Focuses by Stage", "Items by focus"
 * and "Agents board", the first two filtered on the session label alone. That
 * filter removes session issues and nothing else, so both views showed every
 * issue of the Project mixed together — roots, their children and the backlog
 * — and the one named after Stage did not display Stage. What a reader saw on
 * GitHub and what the Dashboard computed could not agree.
 *
 * They select on `Level` and `Stage` now, which the Project records, so a
 * filter can name exactly what the Dashboard names.
 *
 * A per-focus view is not here: one is created with each focus and removed
 * with it, so it belongs to the verb that opens a unit of work and not to
 * setup.
 */
export const DEFAULT_VIEWS: readonly ProjectViewSpec[] = [
  {
    // Every root, whatever its Level: a focus with a breakdown and a piece of
    // standalone work are both entry points to the plan.
    name: 'The plan',
    layout: 'board',
    filter: `is:open no:parent-issue -stage:Backlog -label:${SESSION_LABEL}`,
    columnField: STATUS_FIELD,
    groupField: LEVEL_FIELD,
  },
  {
    name: UNDER_PARENT_VIEW,
    layout: 'table',
    filter: '-no:parent-issue',
    groupField: PARENT_FIELD,
  },
  { name: 'Backlog', layout: 'table', filter: `is:open stage:${BACKLOG_STAGE}` },
  {
    name: 'Agents board',
    layout: 'board',
    filter: `label:${SESSION_LABEL}`,
    columnField: AGENTS_FIELD,
  },
];

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
  /**
   * The field the view groups by: the swimlanes of a board, or the grouping of
   * a table. The API cannot set this either, and it is reported the same way.
   */
  groupField?: string;
};

/**
 * A view of a Project.
 *
 * `columnField` and `groupField` are what the API can **read** of a view's
 * grouping, and they are the whole reason a by-hand step can be re-offered
 * rather than announced once: `groupByFields` and `verticalGroupByFields` are
 * read-only on `ProjectV2View`, but they are not write-only-absent. Before
 * this, `ProjectViewInfo` carried neither, so setup emitted its grouping
 * sentences every time and nothing could tell whether they had been done.
 *
 * Either is `null` when the view has no such grouping.
 */
export type ProjectViewInfo = {
  id: string;
  number: number;
  name: string;
  layout: ProjectViewLayout;
  filter: string;
  /** The field giving a board its columns: GraphQL's `verticalGroupByFields`. */
  columnField: string | null;
  /** The field the view groups by: GraphQL's `groupByFields`. */
  groupField: string | null;
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
  updatedAt: string | null;
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
  /**
   * Whether the issue's body names acceptance criteria. A heuristic: it says
   * that the work could be checked against its own ticket, not that it has
   * been. Readiness cannot be computed without it.
   */
  criteriaOnTicket: boolean;
  /**
   * The Goals the focus carries: what it must deliver, in plain English, as
   * the Human Lead checks them at the gate. Empty when the ticket names none,
   * and a focus with none is reported as uncomputable rather than skipped.
   */
  goals: string[];
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
  /**
   * One sentence per issue on the Project that could not be read with
   * confidence — today, an issue with no value for {@link LEVEL_FIELD}. Empty
   * when the Project is complete. The Dashboard shows these rather than letting
   * a missing field pass as a deliberate answer.
   */
  problems: string[];
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

export type PullRequestChecks = 'passing' | 'failing' | 'pending' | 'none';
export type PullRequestReview = 'approved' | 'changes-requested' | 'review-required' | 'none';
export type OpenPullRequest = {
  repository: string;
  number: number;
  title: string;
  url: string;
  headBranch: string;
  baseBranch: string;
  draft: boolean;
  createdAt: string;
  updatedAt: string;
  checks: PullRequestChecks;
  review: PullRequestReview;
  mergeable: 'mergeable' | 'conflicting' | 'unknown';
};
