/**
 * Step 11: the issues, created one at a time and paced. The in-progress focus
 * becomes a focus issue at the Stage the Human Lead chose, with its stages as
 * sub-issues linking to their archived files; each paused focus one issue
 * labelled `paused`, linking to its archived subtree; each backlog file one
 * issue. Every issue carries the marker `formatIssueMarker('migrated', key)`
 * as a whole line of its body, the key being the source-relative path it
 * stands for, and `findIssuesByMarkers` is asked before creating.
 *
 * Done when the ledger says so, or when every planned issue is recorded in
 * the ledger or found on GitHub by its marker. Phase M6.4 builds `run`, with
 * the labels it needs, the Project items, the sub-issue links, the pacing
 * (`ctx.deps.pause`) and the ledger's `issue` records.
 */

import { notBuiltYet } from '../checks.js';
import type { MigrationContext, MigrationStep } from '../context.js';
import { ledgerHasStep, ledgerRecords } from '../ledger.js';
import type { MigrationIssueKind } from '../types.js';

const TITLE = 'Create the issues';

/** GitHub's secondary limit on creating content is 500 an hour; above this many issues the plan warns. */
export const MANY_ISSUES = 400;

const KIND_WORDS: Record<MigrationIssueKind, string> = {
  focus: 'focus issue for the in-progress focus, at the chosen Stage',
  stage: 'sub-issue for a stage of the in-progress focus, linking to its archived file',
  'paused-focus': 'issue labelled paused for a paused focus, linking to its archived subtree',
  backlog: 'issue for a backlog file, linking to the archived file',
};

const ISSUE_KINDS: readonly MigrationIssueKind[] = ['focus', 'stage', 'paused-focus', 'backlog'];

/** The planned issues whose keys the ledger does not record yet. */
function unrecorded(ctx: MigrationContext): MigrationContext['issues'] {
  const recorded = new Set(ledgerRecords(ctx, 'issue').map((record) => record.key));
  return ctx.issues.filter((issue) => !recorded.has(issue.key));
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
      return found.ok && wanted.every((issue) => found.value[issue.marker] != null);
    },
    run: async () => notBuiltYet(TITLE),
  };
}
