/**
 * Project views: what the API can set, what it cannot, and how the difference
 * is re-offered rather than announced once.
 *
 * Checked on 2026-09-18 against GitHub's GraphQL reference (Projects) and the
 * live schema, re-checked 2026-09-22: the mutation `createProjectV2View` takes
 * a name, a layout and the visible fields; `updateProjectV2View` also takes a
 * filter, and has since gained a `configuration` argument whose input carries
 * only `visibleFieldIds`. No input sets the field a view groups by or the
 * field that gives a board its columns. `gh project` (gh 2.92) has no command
 * for views, so the adapter calls the mutations through `gh api graphql`.
 *
 * `groupByFields` and `verticalGroupByFields` are read-only, which is not the
 * same as unreadable — and that distinction is the whole of this module's
 * present shape. Setup used to emit its grouping sentences unconditionally,
 * show them once in its summary, and never look again; the Project of this
 * Space was created with three ungrouped views and stayed that way, unnoticed,
 * from setup until 2026-09-22. Reading the grouping back turns "here is what
 * to do" into "here is what is still not done", which can be asked repeatedly
 * without becoming noise.
 */

import type { ProjectViewInfo, ProjectViewSpec } from './types.js';

/**
 * What `view` does not match in `spec`, as sentences for the Human Lead.
 *
 * Empty means the view is as the default layout says it should be. A sentence
 * is produced only for a difference that is really there: a spec that names no
 * grouping constrains none, and a grouping already set by hand is not asked
 * for again.
 */
export function viewStepsByHand(spec: ProjectViewSpec, view: ProjectViewInfo): string[] {
  const steps: string[] = [];
  if (spec.columnField !== undefined && view.columnField !== spec.columnField) {
    steps.push(
      `On GitHub, open the view "${view.name}" of the Project, open the view's menu, and set "Column by" to the field "${spec.columnField}"${had(view.columnField)}. The GitHub API cannot set it.`,
    );
  }
  if (spec.groupField !== undefined && view.groupField !== spec.groupField) {
    steps.push(
      `On GitHub, open the view "${view.name}" of the Project, open the view's menu, and set "Group by" to the field "${spec.groupField}"${had(view.groupField)}. The GitHub API cannot set it.`,
    );
  }
  return steps;
}

/** The parenthesis that says what is there now, when it is something rather than nothing. */
function had(current: string | null): string {
  return current === null ? '' : ` (it is "${current}")`;
}

/** One sentence that tells the Human Lead how to make the whole view on GitHub. */
export function describeViewByHand(spec: ProjectViewSpec): string {
  const parts = [`On GitHub, add a view named "${spec.name}" with the ${spec.layout} layout`];
  if (spec.filter !== undefined && spec.filter !== '') parts.push(`the filter ${spec.filter}`);
  if (spec.columnField !== undefined) {
    parts.push(`"Column by" set to the field "${spec.columnField}"`);
  }
  if (spec.groupField !== undefined) {
    parts.push(`"Group by" set to the field "${spec.groupField}"`);
  }
  return `${parts.join(', ')}.`;
}

/**
 * Everything about a Project's views that does not match the default layout.
 *
 * This is the check that nothing performed before: a view whose filter was
 * edited, or whose grouping was never set, or that was deleted outright, now
 * says so every time the Project is read instead of only at setup. A view the
 * layout does not name is left alone — a Space may add views of its own, and
 * a per-focus view is created as focuses are, not at setup.
 */
export function viewDrift(
  specs: readonly ProjectViewSpec[],
  views: readonly ProjectViewInfo[],
): string[] {
  const problems: string[] = [];
  for (const spec of specs) {
    const view = views.find((candidate) => candidate.name === spec.name);
    if (view === undefined) {
      problems.push(`The Project has no view named "${spec.name}". ${describeViewByHand(spec)}`);
      continue;
    }
    if (view.layout !== spec.layout) {
      problems.push(
        `The view "${spec.name}" of the Project has the ${view.layout} layout, and the default layout gives it the ${spec.layout} layout.`,
      );
    }
    if (spec.filter !== undefined && view.filter !== spec.filter) {
      problems.push(
        `The view "${spec.name}" of the Project has the filter ${view.filter === '' ? '(none)' : view.filter}, and the default layout gives it ${spec.filter}.`,
      );
    }
    problems.push(...viewStepsByHand(spec, view));
  }
  return problems;
}
