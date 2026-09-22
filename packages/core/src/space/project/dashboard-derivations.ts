/** Dashboard decisions computed from explicit inputs, without IO or an implicit clock. */
import type { IssueRef, SessionRecord } from '../desk/types.js';
import type { OpenPullRequest } from '../github/types.js';
import type { DashboardModel, FocusCard, NeedsYouEntry } from './dashboard-model.js';

type ActionData =
  | Extract<NeedsYouEntry, { kind: 'gate' | 'review' | 'stale-session' }>
  | { kind: 'failing-pull-request'; pull: OpenPullRequest }
  | { kind: 'draft'; path: string; title: string };
export type NextAction = ActionData & { headline: string };
export type DashboardDraft = { path: string; title: string; at: string };
export type MovingPartition = {
  inProgress: FocusCard[];
  queued: FocusCard[];
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

/** Done wins over paused; every focus appears exactly once. */
export function partitionMoving(input: {
  model: DashboardModel | null;
  now: string;
  sessions?: readonly SessionRecord[];
}): MovingPartition {
  const result: MovingPartition = { inProgress: [], queued: [], dormant: [], done: [] };
  const liveItems = (input.sessions ?? [])
    .filter((session) => session.closedAt === undefined)
    .flatMap((session) => (session.item === undefined ? [] : [session.item]));
  for (const row of input.model?.board ?? []) {
    if (row.local !== null && !row.local.closed && row.local.item !== null)
      liveItems.push(row.local.item);
  }
  for (const focus of focusesOf(input.model)) {
    if (focus.done) result.done.push(focus);
    else if (focus.stage === null || focus.labels.includes('paused')) result.dormant.push(focus);
    else if (
      focus.stage === 'Build' ||
      liveItems.some(
        (issue) =>
          sameIssue(issue, focus.issue) || focus.items.some((item) => sameIssue(item.issue, issue)),
      )
    )
      result.inProgress.push(focus);
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
    paused: focuses.filter((focus) => focus.labels.includes('paused')).length,
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
