/**
 * Making the Project's `Status` say what the claims say.
 *
 * `activity.ts` holds the decision and nothing else; this is the half that
 * reads the Project, writes the field and records what it wrote. The split is
 * deliberate: the rules are what is worth being sure of, and they are testable
 * without a GitHub.
 */

import {
  type Desk,
  type DeskFailure,
  rememberStatusOverridden,
  rememberStatusWrite,
  statusWriteOf,
} from '../desk/index.js';
import type { IssueRef } from '../desk/types.js';
import { STATUS_FIELD, STATUS_VALUES, type StatusValue } from '../github/types.js';
import type { ProjectSnapshot } from '../github/types.js';
import { type Result, ok } from '../result.js';
import { type ActivityDecision, decideStatus, rootKey } from './activity.js';
import type { SessionIssuePlace } from './session-issue.js';

/** What a sync did to one root. */
export type StatusSync = { root: IssueRef; decision: ActivityDecision; written: boolean };

/**
 * Set the `Status` of each root in `roots` from whether a session is on it.
 *
 * A root that is not on the Project is skipped: the companion says nothing
 * about work the plan does not carry. A write that GitHub refuses is reported
 * and does not stop the rest — one root's Status is not worth abandoning the
 * others for.
 */
export async function syncRootStatus(
  place: SessionIssuePlace,
  desk: Desk,
  arg: {
    snapshot: ProjectSnapshot;
    /** The roots to decide about, and whether a session is on each now. */
    roots: ReadonlyMap<number, boolean>;
  },
): Promise<Result<StatusSync[], DeskFailure>> {
  const field = await place.github.ensureSingleSelectField({
    project: place.project,
    name: STATUS_FIELD,
    options: [...STATUS_VALUES],
  });
  const syncs: StatusSync[] = [];
  for (const [number, working] of arg.roots) {
    const found = rootOn(arg.snapshot, number);
    if (found === null) continue;
    const key = rootKey(found.issue.repository, found.issue.number);
    const mark = statusWriteOf(desk, key);
    if (!mark.ok) return mark;
    const decision = decideStatus({
      current: asStatus(found.status),
      mark: mark.value,
      working,
      doneCallDue: found.doneCallDue,
    });
    if ('leave' in decision) {
      if (decision.override) rememberStatusOverridden(desk, key, found.status ?? '');
      syncs.push({ root: found.issue, decision, written: false });
      continue;
    }
    if (!field.ok) {
      syncs.push({ root: found.issue, decision, written: false });
      continue;
    }
    const item = await place.github.addIssueToProject({
      project: place.project,
      issue: found.issue,
    });
    let written = false;
    if (item.ok) {
      const set = await place.github.setSingleSelect({
        project: place.project,
        item: item.value,
        field: field.value,
        option: decision.write,
      });
      written = set.ok;
    }
    // The mark is what the companion wrote, so it is recorded only when the
    // write landed. Recording an intention would read as an override the next
    // time round, and the Human Lead would be blamed for the companion's own
    // failed write.
    if (written) rememberStatusWrite(desk, key, decision.write);
    syncs.push({ root: found.issue, decision, written });
  }
  return ok(syncs);
}

/**
 * The roots that `numbers` belong to: an issue that is a root is its own, and
 * an issue under a focus is that focus's.
 *
 * A session says which tickets it worked; `Status` belongs to the root, so a
 * session that worked three items of one focus makes that focus busy once.
 */
export function rootsOf(snapshot: ProjectSnapshot, numbers: Iterable<number>): Set<number> {
  const parentOf = new Map<number, number>();
  for (const focus of snapshot.focuses) {
    for (const item of focus.items) parentOf.set(item.issue.number, focus.issue.number);
  }
  const roots = new Set<number>();
  for (const number of numbers) roots.add(parentOf.get(number) ?? number);
  return roots;
}

/** The root `number` on the snapshot, with whether its Done call is due. */
function rootOn(
  snapshot: ProjectSnapshot,
  number: number,
): { issue: IssueRef; status: string | null; doneCallDue: boolean } | null {
  for (const focus of snapshot.focuses) {
    if (focus.issue.number !== number) continue;
    const items = focus.items;
    const closed = items.filter((item) => item.state === 'closed').length;
    return {
      issue: focus.issue,
      status: focus.status,
      // The same reckoning the Done-call prompt makes: every item closed, and
      // there is at least one, so "all of none" is not read as finished.
      doneCallDue: focus.state === 'open' && items.length > 0 && closed === items.length,
    };
  }
  for (const item of snapshot.standalone) {
    if (item.issue.number === number) {
      return { issue: item.issue, status: item.status, doneCallDue: false };
    }
  }
  return null;
}

/** A Status the layout knows, or null for a value it does not. */
function asStatus(value: string | null): StatusValue | null {
  return STATUS_VALUES.includes(value as StatusValue) ? (value as StatusValue) : null;
}
