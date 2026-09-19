/**
 * The data of migration from v0.8: what the Human Lead fills, the plan the
 * migration screen shows, the ledger's records, and the failures.
 *
 * Plain data and types only: the migration screen (phase M6.5) imports these
 * types, and this file imports nothing that runs. `MigrationContext` and
 * `MigrationDeps`, which hold ports, are in `context.ts`.
 *
 * Paths named "source-relative" are relative to the v0.8 project's root (the
 * folder the Human Lead opened), with `/`, as `readV08Project` gives them, so a
 * path in the Lore begins with `.ai-lore-<name>/`. Paths named
 * "Space-relative" are relative to the new Space's folder, with `/`.
 */

import type { IssueRef } from '../desk/types.js';
import type { V08Repository } from '../legacy/v08-types.js';
import type { Failure } from '../result.js';
import type { SetupTargetState } from '../setup/types.js';
import type { PlannedStep } from '../steps/types.js';

/** The thirteen steps of section 5.9 of the architecture document, in order. */
export const MIGRATION_STEP_IDS = [
  'record-source',
  'create-space',
  'clone-payload',
  'archive',
  'pointer',
  'contracts',
  'mirror',
  'workbench',
  'corpus-entry',
  'commit-and-push',
  'issues',
  'install',
  'verify',
] as const;

/** The id of one migration step. */
export type MigrationStepId = (typeof MIGRATION_STEP_IDS)[number];

/** The values of the Stage field a migrated in-progress focus can be placed at. */
export type MigrationFocusStage = 'Spec' | 'Plan' | 'Build' | 'Review' | 'Done';

/** The stage the in-progress focus is preselected to (section 10.1, question 5). */
export const MIGRATION_DEFAULT_FOCUS_STAGE: MigrationFocusStage = 'Build';

/**
 * What the Human Lead fills on the plan screen. Every field is optional when
 * the plan is asked for: a field left out is proposed (see `MigrationField`),
 * and the plan says which fields still need a value.
 */
export type MigrationForm = {
  /** The folder the new Space's folder is made in. Proposed: the folder that holds the v0.8 project. */
  parentDir?: string;
  /** The new Space's name: its folder, its repository and its Project. Proposed: `<project name>-space`. */
  name?: string;
  /** The GitHub user or organisation of the Space repository and the Project. Proposed: the signed-in account. */
  owner?: string;
  /** What the Space is about. The v0.8 manifest has none; the Human Lead writes it (section 10.1, question 8). */
  description?: string;
  /** The Stage of the migrated in-progress focus. Proposed: Build. */
  focusStage?: MigrationFocusStage;
  /**
   * The payload repository on GitHub, as `owner/name`. Proposed: read from its
   * origin address; the Human Lead fills it when the origin is not a GitHub address.
   */
  payloadGitHub?: string;
  /** Whether the Space repository is private. Default `true`. */
  private?: boolean;
};

/** What a migration is asked for: the v0.8 project and the form. */
export type MigrationInput = {
  /** The v0.8 project's root: the payload repository's folder that holds `.ai-lore-<name>/`. */
  sourceRoot: string;
  form?: MigrationForm;
};

/** The id of a field of the form. */
export type MigrationFieldId = keyof Omit<MigrationForm, 'private'>;

/** One field the Human Lead fills, with the value the plan used. */
export type MigrationField = {
  id: MigrationFieldId;
  /** A label for the screen. */
  label: string;
  /** The value the plan was made with: the Human Lead's, or the proposed one. Empty when there is none. */
  value: string;
  /** True when the value was proposed and not given by the Human Lead. */
  proposed: boolean;
  /** For a choice, the values offered, in order. */
  options: string[];
  /** Texts the screen can offer for the field (the description's candidates from the v0.8 project). */
  suggestions: string[];
  /** Why the value cannot be used, as a sentence for the screen; `null` when it can. */
  problem: string | null;
};

/** The rows of the focus's mapping table, in its order. */
export const MIGRATION_MAPPING_ROWS = [
  'archive',
  'contracts',
  'mirror',
  'in-progress-focus',
  'paused-focuses',
  'backlog',
  'handover',
  'drafts',
  'archive-only',
  'name-and-description',
] as const;

/** The id of one row of the mapping table. */
export type MigrationMappingRowId = (typeof MIGRATION_MAPPING_ROWS)[number];

/** One thing a row carries, and where it goes. */
export type MigrationMappingItem = {
  /** Source-relative, or a sentence when the thing is not a file (the project's name). */
  from: string;
  /** Space-relative, or `owner/name#…` words for an issue. */
  to: string;
};

/** One row of the mapping table, filled with this project's counts and destinations. */
export type MigrationMappingRow = {
  id: MigrationMappingRowId;
  /** The v0.8 column of the focus's table. */
  source: string;
  /** Where it goes, with this Space's names filled in. */
  destination: string;
  count: number;
  /** One per thing carried. Empty for the archive row, whose files are counted and not listed. */
  items: MigrationMappingItem[];
};

/** A kind of content that is copied to the archive and carried nowhere else. */
export type MigrationNotCarried = {
  /** A few words for the screen: "Other notes", "Project processes". */
  what: string;
  count: number;
  /** Source-relative. */
  paths: string[];
};

/** The kinds of warning. None of them stops the migration; the Human Lead may continue. */
export type MigrationWarningKind =
  | 'uncommitted-changes'
  | 'unreadable-files'
  | 'frontmatter-line-by-line'
  | 'many-issues'
  | 'links-not-copied'
  | 'not-copied'
  | 'several-in-progress'
  | 'no-in-progress-focus'
  | 'incomplete-read';

/** Something the Human Lead should know before confirming. */
export type MigrationWarning = {
  kind: MigrationWarningKind;
  message: string;
  /** Source-relative paths the warning is about; may be empty. */
  paths: string[];
};

/** The kinds of refusal. A refusal stops the migration before anything is created. */
export type MigrationRefusalKind =
  | 'older-than-v0.8'
  | 'not-a-v0.8-project'
  | 'target-not-empty'
  | 'repository-taken'
  | 'project-taken';

/** Why the migration cannot be run as it is asked. */
export type MigrationRefusal = { kind: MigrationRefusalKind; message: string };

/** The kinds of issue the migration creates. */
export type MigrationIssueKind = 'focus' | 'stage' | 'paused-focus' | 'backlog';

/** One issue step 11 creates, found again by its marker. */
export type MigrationIssuePlan = {
  kind: MigrationIssueKind;
  title: string;
  labels: string[];
  /** The source-relative path the issue stands for; the key of its marker. */
  key: string;
  /** The marker line of its body: `formatIssueMarker('migrated', key)`. */
  marker: string;
  /** The archived file or folder the issue links to, Space-relative. */
  archived: string;
  /** For a stage, the key of its focus issue; otherwise `null`. */
  parentKey: string | null;
  /** For the focus issue, its Stage; otherwise `null`. */
  stage: MigrationFocusStage | null;
  /** For a backlog item, its text in the v0.8 file, carried into the issue's body. */
  text?: string;
};

/**
 * Where one issue of step 11 is.
 * `found`: it was already on GitHub (by its marker) or in the ledger.
 * `created`: this run created it. `waiting`: GitHub asked for a pause; `message` says how long.
 * `completed`: it is on the Project with its Stage or its parent, and recorded in the ledger.
 */
export type MigrationIssueProgressState = 'found' | 'created' | 'waiting' | 'completed';

/** One progress event of step 11, per issue, given to `MigrationDeps.onIssueProgress`. */
export type MigrationIssueProgress = {
  /** The source-relative path the issue stands for, as `MigrationIssuePlan.key`. */
  key: string;
  kind: MigrationIssueKind;
  title: string;
  /** The issue's place in the plan, from 0. */
  index: number;
  total: number;
  state: MigrationIssueProgressState;
  /** The issue on GitHub, once it is known. */
  issue: IssueRef | null;
  /** A sentence for the screen. */
  message: string;
};

/** One of the thirteen steps in the plan: the runner's planned step, with its place in section 5.9. */
export type MigrationPlannedStep = PlannedStep & {
  stepId: MigrationStepId;
  /** 1 to 13. */
  number: number;
};

/** What the plan says about one source repository. */
export type MigrationSourceRepository = Pick<
  V08Repository,
  'path' | 'present' | 'originUrl' | 'branch' | 'head' | 'hasUncommittedChanges' | 'changedCount'
>;

/**
 * The plan: what the migration will do, shown before anything is created. It
 * was made without writing anything, on disk or on GitHub.
 */
export type MigrationPlan = {
  source: {
    root: string;
    projectName: string;
    coreVersion: string | null;
    loreFolder: string;
    payloadRepository: MigrationSourceRepository;
    loreRepository: MigrationSourceRepository;
    /** False when the reader stopped at its file or time limit. */
    complete: boolean;
  };
  /** The new Space's folder, or `null` when the fields do not give one yet. */
  spaceRoot: string | null;
  /** The Space repository as `owner/name`, or `null` when the fields do not give one yet. */
  repository: string | null;
  /** What the target folder holds, or `null` when it was not looked at. */
  target: SetupTargetState | null;
  fields: MigrationField[];
  /** The thirteen steps, in order, each with whether it is done and what it will do. */
  steps: MigrationPlannedStep[];
  mapping: MigrationMappingRow[];
  notCarried: MigrationNotCarried[];
  issues: MigrationIssuePlan[];
  warnings: MigrationWarning[];
  refusals: MigrationRefusal[];
  /** True when no field has a problem and nothing is refused: the Human Lead may confirm. */
  ready: boolean;
};

/**
 * The kinds of `MigrationFailure`.
 * `refused`: `refusal` says why. `invalid-input`: `problems` lists the fields.
 * `read-failed`: the v0.8 project could not be read. Any other kind is a step's.
 */
export type MigrationFailureKind = 'refused' | 'invalid-input' | 'read-failed' | (string & {});

/** A plan or a run that stopped. Nothing that was done is removed; running again continues. */
export type MigrationFailure = Failure<MigrationFailureKind> & {
  refusal: MigrationRefusal | null;
  problems: { field: MigrationFieldId; message: string }[];
  /** The step it stopped at, or `null` before the first step. */
  stepId: string | null;
  completed: string[];
  skipped: string[];
};

/** What a migration that reached the end did. */
export type MigrationReport = {
  spaceRoot: string;
  repository: string;
  completed: string[];
  skipped: string[];
};

/** The head and `git status --porcelain` of one source repository, as step 1 records them. */
export type MigrationRepositoryState = {
  /** Source-relative: `.` or `.ai-lore-<name>/memory`. */
  path: string;
  head: string | null;
  statusText: string;
};

/**
 * One record of the ledger `desk/migration.json`. Every record names the
 * source it belongs to, so a ledger is only read for the migration of that source.
 *
 * `source-state`: step 1's record of both source repositories.
 * `step-done`: a step finished; `created` says what it made, a sentence or a path each.
 * `issue`: step 11 created or found the issue of `key`.
 */
export type MigrationLedgerRecord =
  | {
      kind: 'source-state';
      source: string;
      at: string;
      payload: MigrationRepositoryState;
      lore: MigrationRepositoryState;
    }
  | { kind: 'step-done'; source: string; at: string; stepId: MigrationStepId; created: string[] }
  | { kind: 'issue'; source: string; at: string; key: string; issue: IssueRef };
