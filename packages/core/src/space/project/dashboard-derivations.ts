/** Dashboard decisions computed from explicit inputs, without IO or an implicit clock. */
import type { IssueRef, SessionRecord } from '../desk/types.js';
import type { OpenPullRequest } from '../github/types.js';
import type { DashboardModel, FocusCard, NeedsYouEntry } from './dashboard-model.js';

type ActionData =
  | Extract<
      NeedsYouEntry,
      { kind: 'gate' | 'review' | 'stale-session' | 'ready-for-done' | 'project-problem' }
    >
  | { kind: 'failing-pull-request'; pull: OpenPullRequest }
  | { kind: 'draft'; path: string; title: string };
export type NextAction = ActionData & { headline: string };
export type DashboardDraft = { path: string; title: string; at: string };
export type MovingPartition = {
  inProgress: FocusCard[];
  queued: FocusCard[];
  /**
   * Roots with no Stage at all. Nobody has said where these are in their life,
   * which is not the same as a decision to park them — that is `dormant`. They
   * were counted together until issue #108, so eight live tickets, one of them
   * blocking nearly everything, read as dormant.
   */
  untriaged: FocusCard[];
  dormant: FocusCard[];
  done: FocusCard[];
};
export type DormantAggregate = {
  count: number;
  paused: number;
  oldestAgeMs: number | null;
  medianAgeMs: number | null;
};
export type SpaceStats = {
  focusesOpen: number;
  itemsOpen: number;
  openPullRequests: number;
  liveSessions: number;
};
export type PullRequestSummary = {
  total: number;
  passing: number;
  failing: number;
  pending: number;
  none: number;
  approved: number;
  changesRequested: number;
  reviewRequired: number;
  aggregate: string;
  broken: boolean;
};

/** The PR panel's copy and problem state, computed with the Project snapshot. */
export function pullRequestSummary(pulls: readonly OpenPullRequest[]): PullRequestSummary {
  const passing = pulls.filter((pull) => pull.checks === 'passing').length;
  const failing = pulls.filter((pull) => pull.checks === 'failing').length;
  const pending = pulls.filter((pull) => pull.checks === 'pending').length;
  const none = pulls.filter((pull) => pull.checks === 'none').length;
  const approved = pulls.filter((pull) => pull.review === 'approved').length;
  const changesRequested = pulls.filter((pull) => pull.review === 'changes-requested').length;
  const reviewRequired = pulls.filter((pull) => pull.review === 'review-required').length;
  const reviewParts = [
    approved === 0 ? '' : `${approved} REVIEWED`,
    changesRequested === 0 ? '' : `${changesRequested} CHANGES REQUESTED`,
    reviewRequired === 0 ? '' : `${reviewRequired} REVIEW REQUIRED`,
  ].filter((part) => part !== '');
  const review = reviewParts.length === 0 ? 'NONE REVIEWED' : reviewParts.join(' · ');
  const ciParts = [
    failing === 0 ? '' : `${failing} CI FAILED`,
    pending === 0 ? '' : `${pending} RUNNING`,
    none === 0 ? '' : `${none} NO CI`,
  ].filter((part) => part !== '');
  const ci = ciParts.length === 0 ? `${passing} CI PASSED` : ciParts.join(' · ');
  return {
    total: pulls.length,
    passing,
    failing,
    pending,
    none,
    approved,
    changesRequested,
    reviewRequired,
    aggregate:
      pulls.length === 0
        ? 'NO OPEN PULL REQUESTS'
        : failing > 0
          ? `${ci} · ${review}`
          : `${pulls.length} OPEN · ${ci} · ${review}`,
    broken: failing > 0,
  };
}

function sameIssue(a: IssueRef, b: IssueRef): boolean {
  return a.repository === b.repository && a.number === b.number;
}
function focusesOf(model: DashboardModel | null): FocusCard[] {
  return model === null
    ? []
    : [...model.columns.flatMap((column) => column.focuses), ...model.unstaged];
}
function time(value: string | null | undefined): number {
  const parsed = value == null ? Number.NaN : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

/** An issue edit is not a Stage move. Unknown Stage ages remain unknown. */
export function focusAgeMs(focus: FocusCard, now: string): number | null {
  const changed = time(focus.stageChangedAt);
  const current = time(now);
  return Number.isFinite(changed) && Number.isFinite(current)
    ? Math.max(0, current - changed)
    : null;
}

export function nextActionHeadline(action: ActionData): string {
  switch (action.kind) {
    case 'gate':
      return action.question;
    case 'failing-pull-request':
      return `PR #${action.pull.number} CI has failed`;
    case 'review':
      return `Review #${action.focus.number}: ${action.title}`;
    case 'ready-for-done': {
      // The uncomputable case says what is missing rather than claiming the
      // work is finished. Nobody can check a focus against something its
      // ticket does not carry.
      //
      // Goals decide this, not acceptance criteria. Criteria belong to an item
      // and name their evidence; Goals belong to the focus and say what it is
      // for, and they are what the Human Lead checks at the gate. A focus with
      // Goals is computable whether or not it also names criteria.
      const count = action.goals.length;
      if (count > 0) {
        return `#${action.focus.number} is finished — your Done call against ${count === 1 ? 'its Goal' : `its ${count} Goals`}: ${action.title}`;
      }
      if (action.criteriaOnTicket) {
        return `#${action.focus.number} is finished — your Done call: ${action.title}`;
      }
      return `#${action.focus.number} has no Goals on its ticket, so done cannot be told: ${action.title}`;
    }
    case 'project-problem': {
      // Each message says what is wrong and what to do about it, written where
      // it is computed, beside the thing that noticed. The headline is the
      // first of them, with a count when there are more, so one line says both
      // what to do and how much there is.
      const [first = 'The Project has a problem'] = action.messages;
      const rest = action.messages.length - 1;
      return rest > 0 ? `${first} (and ${rest} more about the Project)` : first;
    }
    case 'stale-session':
      return `Check the idle session #${action.issue.number}`;
    case 'draft':
      return `Review ${action.title}`;
  }
}

/** Priority first, oldest within a priority; the input order breaks unknown-age ties. */
export function rankNextActions(input: {
  needsYou: readonly NeedsYouEntry[];
  pulls: readonly OpenPullRequest[];
  drafts: readonly DashboardDraft[];
  now: string;
  focuses?: readonly FocusCard[];
}): NextAction[] {
  const entries: { action: ActionData; priority: number; at: number }[] = [];
  for (const action of input.needsYou) {
    if (action.kind === 'gate') entries.push({ action, priority: 0, at: time(action.askedAt) });
    else if (action.kind === 'review')
      entries.push({
        action,
        priority: 2,
        at: time(
          input.focuses?.find((focus) => sameIssue(focus.issue, action.focus))?.stageChangedAt,
        ),
      });
    // Beside a review: both say the work is done and the Human Lead has to
    // look. Neither outranks a failing pull request, which is a thing going
    // wrong rather than a thing waiting.
    else if (action.kind === 'ready-for-done')
      entries.push({
        action,
        priority: 2,
        at: time(
          input.focuses?.find((focus) => sameIssue(focus.issue, action.focus))?.stageChangedAt,
        ),
      });
    // Beside an idle session, and after it: nothing is blocked on the Project
    // being wrong about itself, and `now` is the newest `at` there is, so a
    // session that has actually been sitting idle is asked about first. It
    // stays visible until the Human Lead fixes it, because nothing else will
    // ever raise it.
    else if (action.kind === 'project-problem')
      entries.push({ action, priority: 3, at: time(input.now) });
    else entries.push({ action, priority: 3, at: time(input.now) - action.idleMs });
  }
  for (const pull of input.pulls)
    if (pull.checks === 'failing') {
      entries.push({
        action: { kind: 'failing-pull-request', pull },
        priority: 1,
        at: time(pull.createdAt),
      });
    }
  for (const draft of input.drafts)
    entries.push({
      action: { kind: 'draft', path: draft.path, title: draft.title },
      priority: 4,
      at: time(draft.at),
    });
  return entries
    .sort((a, b) => a.priority - b.priority || a.at - b.at)
    .map(({ action }) => ({ ...action, headline: nextActionHeadline(action) }));
}

/**
 * Sort the roots by what is happening to them. Done wins, then parked, then
 * untriaged; every focus appears exactly once.
 *
 * Activity comes from `Status` and from the sessions that are live, and not
 * from the Stage (issue #108). `Stage` says how far the work has got; `Status`
 * says whether a desk is on it. Reading `Build` as "in progress" made #38 and
 * #42 look busy while nothing had touched them for a day, because a root sits
 * at Build for as long as its breakdown takes, whoever is or is not working.
 */
export function partitionMoving(input: {
  model: DashboardModel | null;
  now: string;
  sessions?: readonly SessionRecord[];
}): MovingPartition {
  const result: MovingPartition = {
    inProgress: [],
    queued: [],
    untriaged: [],
    dormant: [],
    done: [],
  };
  const liveItems = (input.sessions ?? [])
    .filter((session) => session.closedAt === undefined)
    .flatMap((session) => (session.item === undefined ? [] : [session.item]));
  for (const row of input.model?.board ?? []) {
    if (row.local !== null && !row.local.closed && row.local.item !== null)
      liveItems.push(row.local.item);
  }
  const worked = (focus: FocusCard): boolean =>
    liveItems.some(
      (issue) =>
        sameIssue(issue, focus.issue) || focus.items.some((item) => sameIssue(item.issue, issue)),
    );
  for (const focus of focusesOf(input.model)) {
    if (focus.done) result.done.push(focus);
    // Parked wins over untriaged: someone saying "not now" is a decision, and
    // it stays one whether or not the work also has a Stage.
    // `Paused` is the Status that says so. The `paused` label predates it and
    // is still read, so a root labelled but not yet re-typed is not lost.
    else if (focus.status === 'Paused' || focus.labels.includes('paused'))
      result.dormant.push(focus);
    // No Stage is nobody having triaged it, which is not a decision to park it.
    else if (focus.stage === null) result.untriaged.push(focus);
    // A desk is on it: either the Project says so, or a live session holds it.
    else if (focus.status === 'In Progress' || worked(focus)) result.inProgress.push(focus);
    else result.queued.push(focus);
  }
  for (const list of Object.values(result))
    list.sort((a, b) => time(a.stageChangedAt) - time(b.stageChangedAt));
  return result;
}

export function dormantAggregate(focuses: readonly FocusCard[], now: string): DormantAggregate {
  const ages = focuses
    .map((focus) => focusAgeMs(focus, now))
    .filter((age): age is number => age !== null)
    .sort((a, b) => a - b);
  const middle = Math.floor(ages.length / 2);
  const median =
    ages.length === 0
      ? null
      : ages.length % 2 === 1
        ? (ages[middle] as number)
        : ((ages[middle - 1] as number) + (ages[middle] as number)) / 2;
  return {
    count: focuses.length,
    paused: focuses.filter((focus) => focus.status === 'Paused' || focus.labels.includes('paused'))
      .length,
    oldestAgeMs: ages.at(-1) ?? null,
    medianAgeMs: median,
  };
}

export function spaceStats(input: {
  model: DashboardModel | null;
  pulls: readonly OpenPullRequest[];
  sessions: readonly SessionRecord[];
}): SpaceStats {
  const focuses = focusesOf(input.model);
  const items = new Map<string, { done: boolean }>();
  for (const item of [
    ...focuses.flatMap((focus) => focus.items),
    ...(input.model?.standalone ?? []),
  ]) {
    items.set(`${item.issue.repository}#${item.issue.number}`, item);
  }
  return {
    focusesOpen: focuses.filter((focus) => !focus.done).length,
    itemsOpen: [...items.values()].filter((item) => !item.done).length,
    openPullRequests: input.pulls.length,
    liveSessions: input.sessions.filter((session) => session.closedAt === undefined).length,
  };
}
