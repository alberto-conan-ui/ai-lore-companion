/**
 * The order of the baseline points, and the grouping of commits under the
 * session that made them. Pure functions: no git, no desk, no clock.
 *
 * Order. The timeline is newest first by `at`: when a root was marked, when a
 * pull request was merged, when a session left Writing, and the committer date
 * of a commit. Points with the same `at` stand in the order reviewed mark,
 * merged pull request, session close, commit, so a reference point stands above
 * the commit it names; commits with the same date keep the order git gave. A
 * point whose `at` is not a date stands last.
 *
 * Grouping. A commit is grouped under a session when its committer date lies
 * between the session's start and the session's last close on this root. When
 * no such session holds the commit, it is grouped under a session that has no
 * close on this root and whose start and end times hold it; a session that has
 * not ended is not used for this. When several sessions hold a commit, the one
 * that started last takes it. A commit's date has whole seconds and a session's
 * start has milliseconds, so a commit made in the second a session started is
 * held by that session.
 */

import type {
  BaselinePoint,
  BaselinePointKind,
  BaselineRow,
  CommitPoint,
  SessionClosePoint,
} from './types.js';

const KIND_RANK: Record<BaselinePointKind, number> = {
  'reviewed-mark': 0,
  'merged-pull-request': 1,
  'session-close': 2,
  commit: 3,
};

function timeOf(iso: string): number {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

/** `points` in the order of the timeline. The input is not changed; equal points keep their order. */
export function orderBaselinePoints(points: readonly BaselinePoint[]): BaselinePoint[] {
  return points
    .map((point, index) => ({ point, index, time: timeOf(point.at) }))
    .sort((a, b) => {
      if (a.time !== b.time) return a.time > b.time ? -1 : 1;
      const rank = KIND_RANK[a.point.kind] - KIND_RANK[b.point.kind];
      return rank !== 0 ? rank : a.index - b.index;
    })
    .map((entry) => entry.point);
}

/** The times of a session that the grouping reads. `SessionRecord` fits. */
export type SessionTimes = { id: string; startedAt: string; closedAt?: string };

type Window = { sessionId: string; start: number; end: number };

function holder(windows: readonly Window[], time: number): string | undefined {
  let best: Window | undefined;
  for (const window of windows) {
    if (time < window.start || time > window.end) continue;
    if (best === undefined || window.start > best.start) best = window;
  }
  return best?.sessionId;
}

/**
 * Give each commit the `sessionId` of the session it is grouped under, by the
 * rule in this file's header. `closes` are the session closes of the commits'
 * root. A commit that no session holds is returned without a `sessionId`.
 */
export function assignSessions(
  commits: readonly CommitPoint[],
  closes: readonly { sessionId: string; at: string }[],
  sessions: readonly SessionTimes[],
): CommitPoint[] {
  const lastClose = new Map<string, number>();
  for (const close of closes) {
    const at = Date.parse(close.at);
    if (!Number.isFinite(at)) continue;
    lastClose.set(close.sessionId, Math.max(at, lastClose.get(close.sessionId) ?? at));
  }
  const byClose: Window[] = [];
  const byTimes: Window[] = [];
  for (const session of sessions) {
    // Git keeps a commit's date in whole seconds, so the start is taken at its whole second too.
    const start = Math.floor(Date.parse(session.startedAt) / 1000) * 1000;
    if (!Number.isFinite(start)) continue;
    const closedOnRoot = lastClose.get(session.id);
    if (closedOnRoot !== undefined) {
      byClose.push({ sessionId: session.id, start, end: closedOnRoot });
      continue;
    }
    const end = session.closedAt === undefined ? Number.NaN : Date.parse(session.closedAt);
    if (Number.isFinite(end)) byTimes.push({ sessionId: session.id, start, end });
  }
  return commits.map((commit) => {
    const { sessionId: _earlier, ...plain } = commit;
    const time = Date.parse(commit.at);
    if (!Number.isFinite(time)) return plain;
    const sessionId = holder(byClose, time) ?? holder(byTimes, time);
    return sessionId === undefined ? plain : { ...plain, sessionId };
  });
}

/**
 * The rows of the baseline picker with commits grouped under their session.
 * `points` is in timeline order. A session's closes and its commits become one
 * `session` row at the place of its newest member; every other point is a row
 * of its own. A session close whose session has no commit among the points is
 * still a `session` row, with no commits.
 */
export function groupBaselinePoints(points: readonly BaselinePoint[]): BaselineRow[] {
  const rows: BaselineRow[] = [];
  const groups = new Map<string, { closes: SessionClosePoint[]; commits: CommitPoint[] }>();
  for (const point of points) {
    const sessionId =
      point.kind === 'session-close' || point.kind === 'commit' ? point.sessionId : undefined;
    if (sessionId === undefined) {
      rows.push({ kind: 'point', point });
      continue;
    }
    let group = groups.get(sessionId);
    if (group === undefined) {
      group = { closes: [], commits: [] };
      groups.set(sessionId, group);
      rows.push({ kind: 'session', sessionId, at: point.at, ...group });
    }
    if (point.kind === 'session-close') group.closes.push(point);
    else if (point.kind === 'commit') group.commits.push(point);
  }
  return rows;
}
