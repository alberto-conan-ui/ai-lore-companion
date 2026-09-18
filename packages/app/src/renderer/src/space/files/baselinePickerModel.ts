/**
 * The words and rows of the baseline picker (phase M5.4). Pure functions, so
 * the component and its tests share one source for every sentence. Types only
 * come from core, through the shared IPC types.
 */

import type {
  BaselinePoint,
  BaselinePoints,
  BaselineRow,
  DefaultBaseline,
} from '../../../../shared/ipc/space/roots.types.js';

/** The label of each kind of point, one to one with the kind's internal name. */
export const POINT_KIND_LABEL: Record<BaselinePoint['kind'], string> = {
  'reviewed-mark': 'reviewed mark',
  'merged-pull-request': 'merged pull request',
  'session-close': 'session close',
  commit: 'commit',
};

/** The label of each source of a default baseline, one to one with the source's internal name. */
export const DEFAULT_SOURCE_LABEL: Record<DefaultBaseline['source'], string> = {
  'reviewed-mark': 'reviewed mark',
  'first-seen': 'first seen',
  head: 'head',
};

/** Why a point cannot be chosen. */
export const COMMIT_MISSING_TEXT = 'its commit is not in the repository';

/** An ISO 8601 time as a local date and time. An unreadable time is shown as it is. */
export function formatAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function shortSha(sha: string): string {
  return sha === 'HEAD' ? 'HEAD' : sha.slice(0, 7);
}

/** One point in words: "reviewed mark of <date>", "merged pull request #N <title>" … */
export function describePoint(point: BaselinePoint): string {
  switch (point.kind) {
    case 'reviewed-mark':
      return `reviewed mark of ${formatAt(point.at)}`;
    case 'merged-pull-request':
      return `merged pull request #${point.number} ${point.title}`;
    case 'session-close':
      return point.engine === undefined
        ? `session close ${formatAt(point.at)}`
        : `session close ${formatAt(point.at)}, engine ${point.engine}`;
    case 'commit':
      return `commit ${shortSha(point.commit)} ${point.subject}`;
  }
}

/** A key that names one point among the points of a root. */
export function pointKey(point: BaselinePoint): string {
  return `${point.kind}:${point.commit}:${point.at}`;
}

/** Whether a point can be compared against. A commit point is always in the repository. */
export function isChoosable(point: BaselinePoint): boolean {
  return point.kind === 'commit' || point.commitMissing !== true;
}

/** Whether a baseline (as held, a full SHA or `HEAD`) names the same commit as `commit`. */
export function sameCommit(baseline: string, commit: string): boolean {
  if (baseline === 'HEAD' || commit === 'HEAD') return baseline === commit;
  const a = baseline.toLowerCase();
  const b = commit.toLowerCase();
  return a.startsWith(b) || b.startsWith(a);
}

/** Whether the root's baseline is its default baseline. */
export function isDefaultBaseline(baseline: string, fallback: DefaultBaseline | null): boolean {
  if (fallback === null) return baseline === 'HEAD';
  return sameCommit(baseline, fallback.baseline);
}

/** The default baseline in words: "reviewed mark of <date>", "first seen <date>", "head". */
export function describeDefault(fallback: DefaultBaseline): string {
  const at = fallback.at === null ? '' : ` ${formatAt(fallback.at)}`;
  switch (fallback.source) {
    case 'reviewed-mark':
      return `reviewed mark of${at}`;
    case 'first-seen':
      return `first seen${at}`;
    case 'head':
      return 'head, the present commit';
  }
}

/**
 * The present baseline in words. The default is described from its source.
 * Another baseline is described by the point that was chosen for it when that
 * is known, otherwise by the newest point at that commit, otherwise as a commit.
 */
export function describeBaseline(arg: {
  baseline: string;
  defaultBaseline: DefaultBaseline | null;
  points: readonly BaselinePoint[] | null;
  chosen: BaselinePoint | null;
}): { text: string; isDefault: boolean } {
  const { baseline, defaultBaseline, points, chosen } = arg;
  if (isDefaultBaseline(baseline, defaultBaseline)) {
    const text =
      defaultBaseline === null ? 'head, the present commit' : describeDefault(defaultBaseline);
    return { text, isDefault: true };
  }
  if (chosen !== null && sameCommit(baseline, chosen.commit)) {
    return { text: describePoint(chosen), isDefault: false };
  }
  const found = points?.find((point) => sameCommit(baseline, point.commit));
  if (found !== undefined) return { text: describePoint(found), isDefault: false };
  if (baseline === 'HEAD') return { text: 'head, the present commit', isDefault: false };
  return { text: `commit ${shortSha(baseline)}`, isDefault: false };
}

/** What each failure reason of the merged pull requests is, in words. */
const OMITTED_REASON: Record<string, string> = {
  unreachable: 'GitHub could not be reached',
  'not-signed-in': 'the companion is not signed in to GitHub',
  'rate-limited': 'GitHub refused more requests for now (rate limit)',
  'source-threw': 'reading them from GitHub failed',
};

/**
 * Said when merged pull requests are not read at all: main passes no GitHub
 * repository for the root, or the root is not a repository root.
 */
export const NOT_APPLICABLE_SENTENCE =
  'Merged pull requests are not listed because this root is not a repository root with a GitHub repository.';

/**
 * The sentences about merged pull requests that are not in the list, or none.
 * For a reason with no sentence of its own, GitHub's message is given.
 */
export function mergedPullRequestSentences(status: BaselinePoints['mergedPullRequests']): string[] {
  if (status.status === 'not-applicable') return [NOT_APPLICABLE_SENTENCE];
  if (status.status === 'omitted') {
    const reason = OMITTED_REASON[status.reason] ?? `${status.reason}: ${status.message}`;
    return [`Merged pull requests are not listed because ${reason}.`];
  }
  if (status.withoutCommit === 0) return [];
  const count = status.withoutCommit;
  return [
    count === 1
      ? '1 merged pull request is not listed because GitHub gave no merge commit for it.'
      : `${count} merged pull requests are not listed because GitHub gave no merge commit for them.`,
  ];
}

/** The sentences that state where the list was cut. */
export function limitSentences(points: BaselinePoints): string[] {
  const { limits } = points;
  const sentences: string[] = [];
  if (limits.commitsTruncated) {
    sentences.push(`Only the newest ${limits.commits} commits are listed.`);
  }
  if (limits.reviewedMarksTruncated) {
    sentences.push(`Only the newest ${limits.records} reviewed marks are listed.`);
  }
  if (limits.sessionClosesTruncated) {
    sentences.push(`Only the newest ${limits.records} session closes are listed.`);
  }
  // The source gave at most `limits.pullRequests`; those without a merge commit
  // are counted too, since they were among what it gave.
  const status = points.mergedPullRequests;
  const pullRequests =
    points.points.filter((p) => p.kind === 'merged-pull-request').length +
    (status.status === 'read' ? status.withoutCommit : 0);
  if (status.status === 'read' && limits.pullRequests > 0 && pullRequests >= limits.pullRequests) {
    sentences.push(`Only the newest ${limits.pullRequests} merged pull requests are listed.`);
  }
  return sentences;
}

/** One line of the list as it is shown: a point, or the header of a session's group. */
export type PickerItem =
  | { kind: 'point'; id: string; point: BaselinePoint; level: 1 | 2; sessionId?: string }
  | {
      kind: 'session';
      id: string;
      sessionId: string;
      at: string;
      count: number;
      expanded: boolean;
    };

/** The members of a session's group, newest first: its closes and its commits. */
export function sessionMembers(row: Extract<BaselineRow, { kind: 'session' }>): BaselinePoint[] {
  return [...row.closes, ...row.commits].sort((a, b) => b.at.localeCompare(a.at));
}

/** The lines shown for `rows`, with the groups in `collapsed` shown by their header only. */
export function pickerItems(
  rows: readonly BaselineRow[],
  collapsed: ReadonlySet<string>,
): PickerItem[] {
  const items: PickerItem[] = [];
  for (const row of rows) {
    if (row.kind === 'point') {
      items.push({ kind: 'point', id: pointKey(row.point), point: row.point, level: 1 });
      continue;
    }
    const members = sessionMembers(row);
    const expanded = !collapsed.has(row.sessionId);
    items.push({
      kind: 'session',
      id: `session:${row.sessionId}`,
      sessionId: row.sessionId,
      at: row.at,
      count: members.length,
      expanded,
    });
    if (!expanded) continue;
    for (const point of members) {
      items.push({
        kind: 'point',
        id: pointKey(point),
        point,
        level: 2,
        sessionId: row.sessionId,
      });
    }
  }
  return items;
}
