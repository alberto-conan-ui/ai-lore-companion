/**
 * Project views: what the API can set, and the sentences for what it cannot.
 *
 * Checked on 2026-09-18 against GitHub's GraphQL reference (Projects) and the
 * live schema: the mutation `createProjectV2View` takes a name, a layout and
 * the visible fields; `updateProjectV2View` also takes a filter. No input sets
 * the field a view groups by or the field that gives a board its columns
 * (`groupByFields` and `verticalGroupByFields` can only be read). `gh project`
 * (gh 2.92) has no command for views, so the adapter calls the mutations
 * through `gh api graphql`.
 *
 * The fallback of the architecture document, section 5.3, is therefore kept
 * for the part the API cannot do: setup lists it in its summary as a step the
 * Human Lead does on GitHub. `describeViewByHand` gives the whole view as such
 * a step, for the case where creating it fails.
 */

import type { ProjectViewInfo, ProjectViewSpec } from './types.js';

/** The sentences for what is left to do by hand after the API created or found `view`. */
export function viewStepsByHand(spec: ProjectViewSpec, view: ProjectViewInfo): string[] {
  const steps: string[] = [];
  if (spec.layout === 'board' && spec.columnField !== undefined) {
    steps.push(
      `On GitHub, open the view "${view.name}" of the Project, open the view's menu, and set "Column by" to the field "${spec.columnField}". The GitHub API cannot set it.`,
    );
  }
  return steps;
}

/** One sentence that tells the Human Lead how to make the whole view on GitHub. */
export function describeViewByHand(spec: ProjectViewSpec): string {
  const parts = [`On GitHub, add a view named "${spec.name}" with the ${spec.layout} layout`];
  if (spec.filter !== undefined && spec.filter !== '') parts.push(`the filter ${spec.filter}`);
  if (spec.layout === 'board' && spec.columnField !== undefined) {
    parts.push(`"Column by" set to the field "${spec.columnField}"`);
  }
  return `${parts.join(', ')}.`;
}
