/**
 * The baseline picker model — pure, dependency-free, importable by **both** the
 * main process and the renderer (it touches no `node:` or Electron API, so it
 * sidesteps the renderer-cannot-value-import-from-core boundary by living in
 * `shared/`). It is the single source of the "mask over acks" math:
 *
 * - **Save-points are a mask.** The picker lists save-points by default; each
 *   resolves to the **latest ack in its run** — the newest non-save-point commit
 *   after that save-point and before the next one — or to the save-point commit
 *   itself when its run holds no acks. So selecting the latest save-point shows
 *   "what changed since the last acknowledged state."
 * - **Acks are the truth under the mask.** With the tickbox on, the picker also
 *   lists individual acks (commits that are not save-points). Because an ack
 *   commits both repos within the same operation, the two repos are paired by
 *   commit-timestamp proximity: a selected ack's baseline for each repo is that
 *   repo's newest commit at-or-before the ack's timestamp.
 *
 * Every milestone carries a per-repo resolved baseline (`payloadBaseline` /
 * `loreBaseline`) so the caller applies one logical selection to both panes.
 */

import type { CommitListEntry, SavePointInfo } from './ipc.js';

/** A picker entry — one logical milestone spanning both repos. */
export type Milestone = {
  /** Stable id — `sp:<name>` for a save-point, `ack:<sha>` for an ack. */
  id: string;
  kind: 'save-point' | 'ack';
  /** Display label — the save-point title, or the ack's commit subject. */
  label: string;
  /** Committer epoch **seconds** — drives ordering and the date/time shown. */
  timestamp: number;
  /** The milestone's own (payload-side) commit SHA — shown in the row. */
  commitSha: string;
  /** Resolved baseline SHA the Payload pane diffs against. */
  payloadBaseline: string;
  /** Resolved baseline SHA the Status/Memory (lore) panes diff against. */
  loreBaseline: string;
  /**
   * Save-points only: the ACK this save-point rolls up to (the latest ack
   * leading up to it), shown beside it and selected in its place while rollup
   * is on. `null` when the run has no acks (the save-point stands alone).
   */
  boundAck?: { label: string; timestamp: number; sha: string } | null;
};

/** The whole picker model — the mask (`savePoints`) and what it hides (`acks`). */
export type BaselineModel = {
  savePoints: Milestone[];
  acks: Milestone[];
};

/**
 * Commits made within this many seconds of one another collapse into a single
 * logical ack. An `ack` commits the Payload and Lore repos in one operation, a
 * few seconds apart; without collapsing they'd show as two near-identical rows.
 */
const ACK_PAIR_WINDOW_SECONDS = 90;

/**
 * The ack a save-point rolls up — the nearest ack to it (in either repo) within
 * its **era**: the span between the adjacent save-points. An AI-Lore save-point
 * operation spans a payload work-commit and one or two lore commits a minute
 * apart, so in the merged timeline the matching ack can sit just before *or*
 * just after the save-point; "nearest within the era" finds it without crossing
 * into a neighbouring save-point's commits. The save-point's own commits are
 * excluded. Returns `null` when the era holds no ack — i.e. the save-point is
 * boxed in by other save-points (the one case where a save-point doesn't roll
 * up). `acksNewestFirst` so ties resolve to the newer ack.
 */
export function nearestAckInEra(
  acksNewestFirst: readonly CommitListEntry[],
  anchor: number,
  olderBound: number,
  newerBound: number,
  exclude: ReadonlySet<string>,
): CommitListEntry | null {
  let best: CommitListEntry | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const c of acksNewestFirst) {
    if (c.timestamp <= olderBound || c.timestamp >= newerBound) continue;
    if (exclude.has(c.sha)) continue;
    const gap = Math.abs(c.timestamp - anchor);
    if (gap < bestGap) {
      bestGap = gap;
      best = c;
    }
  }
  return best;
}

/** The newest commit at-or-before `ts` (epoch seconds), or `null` if none. */
export function nearestAtOrBefore(
  commitsNewestFirst: readonly CommitListEntry[],
  ts: number,
): string | null {
  for (const c of commitsNewestFirst) {
    if (c.timestamp <= ts) return c.sha;
  }
  return null;
}

/**
 * Resolve a possibly-abbreviated SHA to the full SHA present in `commits`. The
 * save-point ledger records short (7-char) SHAs, but `git log %H` yields full
 * 40-char ones — so a raw `===` lookup misses and the save-point loses both its
 * timestamp and its run resolution. Exact match first, then a prefix match;
 * returns the input unchanged when nothing matches (commit outside the window).
 */
export function resolveFullSha(commits: readonly CommitListEntry[], sha: string): string {
  for (const c of commits) if (c.sha === sha) return c.sha;
  for (const c of commits) if (c.sha.startsWith(sha)) return c.sha;
  return sha;
}

/** Parse a `YYYY-MM-DD` ledger date to epoch **seconds** (UTC midnight), or 0. */
export function dateToEpochSeconds(date: string): number {
  const ms = Date.parse(date);
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
}

/**
 * Build the picker model from the save-point ledger and both repos' commit
 * lists (each newest-first). Save-points roll up to the nearest ack in their
 * era via {@link nearestAckInEra} (off → the save-point's own commit). Ack
 * milestones are the merged non-save-point commits across both repos, collapsed
 * by {@link ACK_PAIR_WINDOW_SECONDS} and paired across repos via
 * {@link nearestAtOrBefore}.
 */
export function buildMilestones(
  args: {
    savePoints: readonly SavePointInfo[];
    payloadCommits: readonly CommitListEntry[];
    loreCommits: readonly CommitListEntry[];
  },
  /**
   * When `true` (the default), a save-point's baseline is its rolled-up ack —
   * "diff since the bound ack". When `false`, the baseline is the save-point's
   * own commit, and the acks stand as their own entries.
   */
  rollupAcks = true,
): BaselineModel {
  const { savePoints, payloadCommits, loreCommits } = args;

  const tsBySha = new Map<string, number>();
  for (const c of payloadCommits) tsBySha.set(c.sha, c.timestamp);
  for (const c of loreCommits) tsBySha.set(c.sha, c.timestamp);

  // Ledger SHAs are abbreviated; resolve each to the full SHA in its repo's log
  // so the save-point sets and timestamp lookups all match.
  const sps = savePoints.map((sp) => ({
    sp,
    payloadFull: resolveFullSha(payloadCommits, sp.payloadCommit),
    loreFull: resolveFullSha(loreCommits, sp.loreCommit),
  }));
  const spShas = new Set([...sps.map((s) => s.payloadFull), ...sps.map((s) => s.loreFull)]);

  // A save-point's anchor in time — its payload commit, then lore, then the
  // ledger date as the always-present fallback.
  const anchorOf = (s: (typeof sps)[number]): number =>
    tsBySha.get(s.payloadFull) ?? tsBySha.get(s.loreFull) ?? dateToEpochSeconds(s.sp.date);
  const anchors = sps.map(anchorOf);

  // The merged ack timeline (both repos, no save-point commits), newest first —
  // what save-points roll up against and what the un-rolled view lists.
  const mergedAcks = [
    ...payloadCommits.filter((c) => !spShas.has(c.sha)),
    ...loreCommits.filter((c) => !spShas.has(c.sha)),
  ].sort((a, b) => b.timestamp - a.timestamp);

  const spMilestones: Milestone[] = sps.map((s) => {
    const anchor = anchorOf(s);
    // Era bounds: the nearest save-point anchors on each side.
    let olderBound = Number.NEGATIVE_INFINITY;
    let newerBound = Number.POSITIVE_INFINITY;
    for (const a of anchors) {
      if (a < anchor && a > olderBound) olderBound = a;
      if (a > anchor && a < newerBound) newerBound = a;
    }
    const own = new Set([s.payloadFull, s.loreFull]);
    const ack = nearestAckInEra(mergedAcks, anchor, olderBound, newerBound, own);
    // Roll each repo to its commit at-or-before the bound ack's time; with no
    // bound ack (boxed in by save-points), the baseline is the save-point itself.
    const rollPayload = ack
      ? (nearestAtOrBefore(payloadCommits, ack.timestamp) ?? s.payloadFull)
      : s.payloadFull;
    const rollLore = ack
      ? (nearestAtOrBefore(loreCommits, ack.timestamp) ?? s.loreFull)
      : s.loreFull;
    return {
      id: `sp:${s.sp.name}`,
      kind: 'save-point' as const,
      label: s.sp.title,
      timestamp: anchor,
      commitSha: s.payloadFull,
      // Rollup on → diff since the bound ack; off → exactly the save-point commit.
      payloadBaseline: rollupAcks ? rollPayload : s.payloadFull,
      loreBaseline: rollupAcks ? rollLore : s.loreFull,
      boundAck: ack ? { label: ack.subject, timestamp: ack.timestamp, sha: ack.sha } : null,
    };
  });

  const ackMilestones: Milestone[] = [];
  for (const seed of mergedAcks) {
    const last = ackMilestones[ackMilestones.length - 1];
    // Seeds are newest-first, so the anchor of a group is its newest commit —
    // which guarantees both repos' op-commits sit at-or-before its timestamp.
    if (last && last.timestamp - seed.timestamp <= ACK_PAIR_WINDOW_SECONDS) continue;
    ackMilestones.push({
      id: `ack:${seed.sha}`,
      kind: 'ack',
      label: seed.subject,
      timestamp: seed.timestamp,
      commitSha: seed.sha,
      payloadBaseline: nearestAtOrBefore(payloadCommits, seed.timestamp) ?? seed.sha,
      loreBaseline: nearestAtOrBefore(loreCommits, seed.timestamp) ?? seed.sha,
    });
  }

  return { savePoints: spMilestones, acks: ackMilestones };
}

/** Find the milestone whose resolved baselines match the active per-scope pair. */
export function activeMilestoneId(
  model: BaselineModel,
  baseline: { payload: string; lore: string },
): string | null {
  const match = [...model.savePoints, ...model.acks].find(
    (m) => m.payloadBaseline === baseline.payload && m.loreBaseline === baseline.lore,
  );
  return match?.id ?? null;
}

/** Look up a milestone by id across both lists. */
export function findMilestone(model: BaselineModel, id: string): Milestone | null {
  return [...model.savePoints, ...model.acks].find((m) => m.id === id) ?? null;
}

/**
 * The model's default selection — the latest save-point, else the latest ack,
 * else null. What the picker shows on first paint and what "follow latest"
 * tracks. (Save-points and acks each arrive newest-first.)
 */
export function defaultMilestone(model: BaselineModel): Milestone | null {
  return model.savePoints[0] ?? model.acks[0] ?? null;
}
