/**
 * Step 11: the issues, created one at a time and paced. The in-progress focus
 * becomes a focus issue at the Stage the Human Lead chose, with its stages as
 * sub-issues linking to their archived files; each paused focus one issue
 * labelled `paused`, linking to its archived subtree; each backlog item one
 * issue with its text. Every issue carries the marker
 * `formatIssueMarker('migrated', key)` as a whole line of its body, the key
 * being the source-relative path it stands for (with `#<n>` for an entry of a
 * backlog file), and `findIssuesByMarkers` is asked before creating.
 *
 * Done when the ledger says so, or when every planned issue is recorded in
 * the ledger or found on GitHub by its marker and placed on the Project.
 * `run` (phase M6.4) makes the `paused` label, writes one call at a time
 * with `ISSUE_PACE_MS` between two writes (`ctx.deps.pause`), waits for a
 * `rate-limited` answer and asks again, and records each finished issue in
 * the ledger. The writing itself is in `../github/issue-writer.ts`.
 */

import type { IssueRef } from '../../desk/types.js';
import {
  DEFAULT_STAGES,
  type FieldInfo,
  type LabelSpec,
  PAUSED_LABEL,
  type ProjectInfo,
  type RepositoryInfo,
  STAGE_FIELD,
} from '../../github/types.js';
import { type Result, fail, ok } from '../../result.js';
import type { StepError } from '../../steps/types.js';
import type { MigrationContext, MigrationStep } from '../context.js';
import {
  ISSUE_PACE_MS,
  type IssueWriter,
  askGitHub,
  issueBody,
  issueProgressListener,
  issueTitle,
  issueWriter,
} from '../github/issue-writer.js';
import { appendMigrationLedger, ledgerHasStep, ledgerRecords } from '../ledger.js';
import type { MigrationIssueKind, MigrationIssuePlan, MigrationIssueProgress } from '../types.js';

const TITLE = 'Create the issues';

/** GitHub's secondary limit on creating content is 500 an hour; above this many issues the plan warns. */
export const MANY_ISSUES = 400;

const KIND_WORDS: Record<MigrationIssueKind, string> = {
  focus: 'focus issue for the in-progress focus, at the chosen Stage',
  stage: 'sub-issue for a stage of the in-progress focus, linking to its archived file',
  'paused-focus': 'issue labelled paused for a paused focus, linking to its archived subtree',
  backlog: 'issue for a backlog item, with its text, linking to the archived file',
};

const ISSUE_KINDS: readonly MigrationIssueKind[] = ['focus', 'stage', 'paused-focus', 'backlog'];

/** The planned issues whose keys the ledger does not record yet. */
function unrecorded(ctx: MigrationContext): MigrationContext['issues'] {
  const recorded = new Set(ledgerRecords(ctx, 'issue').map((record) => record.key));
  return ctx.issues.filter((issue) => !recorded.has(issue.key));
}

/** The label of a paused focus. Setup does not make it, so step 11 does. */
export const PAUSED_LABEL_SPEC: LabelSpec = {
  name: PAUSED_LABEL,
  color: 'cfd3d7',
  description: 'A focus that was paused in AI-Lore v0.8, carried over by the migration',
};

function refText(ref: IssueRef): string {
  return `${ref.repository}#${ref.number}`;
}

/**
 * Whether the issues the ledger does not record, all found on GitHub by their
 * markers in `found`, are placed as step 11 places them: the focus issue at its
 * Stage, each stage a sub-issue of it, each other issue a standalone item of
 * the Project. Step 11 writes these after it creates an issue, so an issue
 * whose placement is missing was stopped in the middle. Reads the Project
 * once. `true` when no Project is found: then the markers alone answer, since
 * step 2 makes the Project before a run reaches step 11.
 */
async function placedOnProject(
  ctx: MigrationContext,
  wanted: MigrationIssuePlan[],
  found: Record<string, IssueRef | null>,
): Promise<boolean> {
  const project =
    ctx.setup.found.project ??
    (await ctx.deps.github
      .findProject({ owner: ctx.settings.owner, title: ctx.settings.name })
      .then((answer) => (answer.ok ? answer.value : undefined)));
  if (project === undefined) return false;
  if (project === null) return true;
  const snapshot = await ctx.deps.github.readProject({ project });
  if (!snapshot.ok) return false;
  const refs = new Map(ledgerRecords(ctx, 'issue').map((record) => [record.key, record.issue]));
  for (const issue of wanted) {
    const ref = found[issue.marker];
    if (ref != null) refs.set(issue.key, ref);
  }
  const focuses = new Map(snapshot.value.focuses.map((focus) => [refText(focus.issue), focus]));
  const standalone = new Set(snapshot.value.standalone.map((item) => refText(item.issue)));
  return wanted.every((issue) => {
    const ref = refs.get(issue.key);
    if (ref === undefined) return false;
    switch (issue.kind) {
      case 'focus':
        return focuses.get(refText(ref))?.stage === issue.stage;
      case 'stage': {
        const parent = issue.parentKey === null ? undefined : refs.get(issue.parentKey);
        if (parent === undefined) return false;
        const focus = focuses.get(refText(parent));
        return focus?.items.some((item) => refText(item.issue) === refText(ref)) === true;
      }
      default:
        return standalone.has(refText(ref));
    }
  });
}

/** The Space repository, from what setup found or from GitHub. */
async function spaceRepository(
  ctx: MigrationContext,
  writer: IssueWriter,
): Promise<Result<RepositoryInfo, StepError>> {
  if (ctx.setup.found.repository !== null) return ok(ctx.setup.found.repository);
  const found = await askGitHub(writer, () => ctx.deps.github.findRepository(ctx.repositoryName), {
    write: false,
  });
  if (!found.ok) return found;
  if (found.value === null) {
    return fail(
      'repository-missing',
      `The Space repository ${ctx.repositoryName} was not found on GitHub, so no issue was created. Step 2 creates it; run the migration again.`,
    );
  }
  ctx.setup.found.repository = found.value;
  return ok(found.value);
}

/** The Space's Project, from what setup found or from GitHub. */
async function spaceProject(
  ctx: MigrationContext,
  writer: IssueWriter,
): Promise<Result<ProjectInfo, StepError>> {
  if (ctx.setup.found.project !== null) return ok(ctx.setup.found.project);
  const { owner, name } = ctx.settings;
  const found = await askGitHub(writer, () => ctx.deps.github.findProject({ owner, title: name }), {
    write: false,
  });
  if (!found.ok) return found;
  if (found.value === null) {
    return fail(
      'project-missing',
      `The Project "${name}" of ${owner} was not found on GitHub, so no issue was created. Step 2 creates it; run the migration again.`,
    );
  }
  ctx.setup.found.project = found.value;
  return ok(found.value);
}

/**
 * Step 11's work: for each planned issue the ledger does not record, find it
 * by its marker or create it, then put it on the Project and give it its Stage
 * (the focus issue) or its parent (a stage), and record it in the ledger. An
 * issue is recorded only once all of that holds, so a run stopped in the middle
 * of an issue completes it next time without creating it again.
 */
async function createIssues(ctx: MigrationContext): Promise<Result<void, StepError>> {
  const report = issueProgressListener(ctx.deps);
  const total = ctx.issues.length;
  let current: { issue: MigrationIssuePlan; index: number; ref: IssueRef | null } | null = null;
  const emit = (state: MigrationIssueProgress['state'], message: string): void => {
    if (current === null) return;
    const { issue, index, ref } = current;
    report({
      key: issue.key,
      kind: issue.kind,
      title: issue.title,
      index,
      total,
      state,
      issue: ref,
      message,
    });
  };
  const writer = issueWriter(ctx, (message) => emit('waiting', message));

  const refs = new Map(ledgerRecords(ctx, 'issue').map((record) => [record.key, record.issue]));
  const wanted = ctx.issues.filter((issue) => !refs.has(issue.key));
  const created: string[] = [];

  if (wanted.length > 0) {
    const repository = await spaceRepository(ctx, writer);
    if (!repository.ok) return repository;
    const project = await spaceProject(ctx, writer);
    if (!project.ok) return project;
    const github = ctx.deps.github;
    const repo = repository.value.fullName;

    let stageField: FieldInfo | null = null;
    if (wanted.some((issue) => issue.kind === 'focus')) {
      const field = await askGitHub(
        writer,
        () =>
          github.ensureSingleSelectField({
            project: project.value,
            name: STAGE_FIELD,
            options: [...DEFAULT_STAGES],
          }),
        { write: true },
      );
      if (!field.ok) return field;
      stageField = field.value;
    }
    if (wanted.some((issue) => issue.labels.includes(PAUSED_LABEL))) {
      const labelled = await askGitHub(
        writer,
        () => github.ensureLabels({ repository: repo, labels: [{ ...PAUSED_LABEL_SPEC }] }),
        { write: true },
      );
      if (!labelled.ok) return labelled;
    }
    const found = await askGitHub(
      writer,
      () => github.findIssuesByMarkers({ repository: repo, markers: wanted.map((i) => i.marker) }),
      { write: false },
    );
    if (!found.ok) return found;

    for (const [index, issue] of ctx.issues.entries()) {
      const recorded = refs.get(issue.key);
      current = { issue, index, ref: recorded ?? null };
      if (recorded !== undefined) {
        emit('found', `${refText(recorded)} is recorded in the migration's ledger.`);
        continue;
      }
      const title = issueTitle(issue);
      writer.place = { index, total, title };

      let ref = found.value[issue.marker] ?? null;
      if (ref !== null) {
        current.ref = ref;
        emit(
          'found',
          `${refText(ref)} was found on GitHub by its marker; it is not created again.`,
        );
      } else {
        const marker = issue.marker;
        const made = await askGitHub(
          writer,
          () =>
            github.createIssue({
              repository: repo,
              title,
              body: issueBody(issue, repository.value.url),
              labels: [...issue.labels],
            }),
          {
            write: true,
            // A create whose answer was lost may have been made: look for it by its marker first.
            recover: () =>
              askGitHub(writer, () => github.findIssueByMarker({ repository: repo, marker }), {
                write: false,
              }),
          },
        );
        if (!made.ok) return made;
        ref = made.value;
        current.ref = ref;
        created.push(refText(ref));
        emit(
          'created',
          `Created ${refText(ref)}. The migration waits ${ISSUE_PACE_MS / 1000} second between two writes to GitHub.`,
        );
      }
      const issueRef = ref;

      const item = await askGitHub(
        writer,
        () => github.addIssueToProject({ project: project.value, issue: issueRef }),
        { write: true },
      );
      if (!item.ok) return item;
      if (issue.kind === 'focus' && issue.stage !== null && stageField !== null) {
        const field = stageField;
        const option = issue.stage;
        const staged = await askGitHub(
          writer,
          () => github.setSingleSelect({ project: project.value, item: item.value, field, option }),
          { write: true },
        );
        if (!staged.ok) return staged;
      }
      if (issue.parentKey !== null) {
        const parent = refs.get(issue.parentKey);
        if (parent === undefined) {
          return fail(
            'parent-missing',
            `The focus issue of "${title}" is not known, so it could not be made its sub-issue. Run the migration again.`,
          );
        }
        const linked = await askGitHub(
          writer,
          () => github.addSubIssue({ parent, child: issueRef }),
          { write: true },
        );
        if (!linked.ok) return linked;
      }

      const kept = appendMigrationLedger(ctx, { kind: 'issue', key: issue.key, issue: issueRef });
      if (!kept.ok) return kept;
      refs.set(issue.key, issueRef);
      emit('completed', `${refText(issueRef)} is on the Project and recorded in the ledger.`);
    }
  }

  const done = appendMigrationLedger(ctx, { kind: 'step-done', stepId: 'issues', created });
  if (!done.ok) return done;
  return ok(undefined);
}

/** Step 11. */
export function issuesStep(): MigrationStep {
  return {
    id: 'issues',
    number: 11,
    title: TITLE,
    describe: async (ctx) => {
      const lines = [];
      for (const kind of ISSUE_KINDS) {
        const issues = ctx.issues.filter((issue) => issue.kind === kind);
        if (issues.length === 0) continue;
        lines.push({
          what: `Create one ${KIND_WORDS[kind]}.`,
          from: issues.map((issue) => issue.key).join(', '),
          to: ctx.repositoryName,
          count: issues.length,
        });
      }
      lines.push({
        what: 'Create them one at a time and paced, each with a hidden marker line, so that running again finds them instead of creating them twice.',
        to: ctx.repositoryName,
        count: ctx.issues.length,
      });
      return lines;
    },
    isDone: async (ctx) => {
      if (ledgerHasStep(ctx, 'issues')) return true;
      const wanted = unrecorded(ctx);
      if (wanted.length === 0) return true;
      const repository =
        ctx.setup.found.repository ??
        (await ctx.deps.github
          .findRepository(ctx.repositoryName)
          .then((found) => (found.ok ? found.value : null)));
      if (repository === null) return false;
      const found = await ctx.deps.github.findIssuesByMarkers({
        repository: repository.fullName,
        markers: wanted.map((issue) => issue.marker),
      });
      if (!found.ok || !wanted.every((issue) => found.value[issue.marker] != null)) return false;
      return placedOnProject(ctx, wanted, found.value);
    },
    run: createIssues,
  };
}
