import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activeMilestoneId,
  buildMilestones,
  dateToEpochSeconds,
  defaultMilestone,
  nearestAckInEra,
  nearestAtOrBefore,
  resolveFullSha,
} from '../../src/shared/baseline.js';
import type { CommitListEntry, SavePointInfo } from '../../src/shared/ipc.js';

const c = (sha: string, timestamp: number, subject = sha): CommitListEntry => ({
  sha,
  subject,
  timestamp,
});

// Two save-points. In the PAYLOAD log their commits are adjacent (pSPb sits
// right on pSPa) — a save-point boxed by save-points. But the LORE log carries
// an ack (lX) one beat after the newer save-point's lore commit, exactly the
// real-world shape (an AI-Lore save-point = a payload commit + lore commit(s) a
// minute apart, plus a "Save-point:" lore ack). Newest-first per repo:
const payloadCommits: CommitListEntry[] = [c('pB', 600), c('pSPb', 400), c('pSPa', 200)];
const loreCommits: CommitListEntry[] = [
  c('lX', 410, 'lore bound ack'),
  c('lSPb', 405),
  c('lSPa', 205),
];
const savePoints: SavePointInfo[] = [
  { name: 'B', title: 'SP B', date: '2026-05-30', payloadCommit: 'pSPb', loreCommit: 'lSPb' },
  { name: 'A', title: 'SP A', date: '2026-05-29', payloadCommit: 'pSPa', loreCommit: 'lSPa' },
];

test('nearestAckInEra picks the nearest ack within the era, either side', () => {
  const acks = [c('n3', 500), c('n2', 410), c('n1', 300), c('n0', 100)];
  // Anchor 400, open era → n2@410 is closest (gap 10).
  assert.equal(nearestAckInEra(acks, 400, 200, Number.POSITIVE_INFINITY, new Set())?.sha, 'n2');
  // Newer bound 405 excludes n2/n3 → n1@300 wins.
  assert.equal(nearestAckInEra(acks, 400, 200, 405, new Set())?.sha, 'n1');
  // Excluding the nearest falls through to the next (tie resolves newest).
  assert.equal(
    nearestAckInEra(acks, 400, 200, Number.POSITIVE_INFINITY, new Set(['n2']))?.sha,
    'n3',
  );
  // Boxed in — no ack inside the era → null.
  assert.equal(nearestAckInEra(acks, 400, 390, 410, new Set()), null);
});

test('nearestAtOrBefore finds the newest commit at or before a timestamp', () => {
  assert.equal(nearestAtOrBefore(payloadCommits, 450), 'pSPb'); // pSPb@400 newest <= 450
  assert.equal(nearestAtOrBefore(payloadCommits, 700), 'pB');
  assert.equal(nearestAtOrBefore(payloadCommits, 50), null);
});

test('resolveFullSha expands an abbreviated ledger SHA to the full commit SHA', () => {
  const commits = [c('abc1234deadbeef', 200), c('seed', 100)];
  assert.equal(resolveFullSha(commits, 'abc1234'), 'abc1234deadbeef'); // prefix
  assert.equal(resolveFullSha(commits, 'seed'), 'seed'); // exact
  assert.equal(resolveFullSha(commits, 'missing'), 'missing'); // unchanged when absent
});

test('a save-point rolls up to the nearest ack even when it is in the OTHER repo', () => {
  const model = buildMilestones({ savePoints, payloadCommits, loreCommits });
  const b = model.savePoints[0];
  assert.equal(b?.id, 'sp:B');
  // pSPb is boxed by save-points in the payload log, but lX (lore) is adjacent
  // in the merged timeline → that's the bound ack.
  assert.equal(b?.boundAck?.sha, 'lX');
  assert.equal(b?.loreBaseline, 'lX');
  // Payload rolls to its commit at-or-before the bound ack (the save-point itself here).
  assert.equal(b?.payloadBaseline, 'pSPb');
});

test('a save-point boxed in by save-points (no ack in its era) does not roll up', () => {
  const model = buildMilestones({ savePoints, payloadCommits, loreCommits });
  const a = model.savePoints[1];
  assert.equal(a?.id, 'sp:A');
  assert.equal(a?.boundAck, null);
  assert.equal(a?.payloadBaseline, 'pSPa'); // its own commit
  assert.equal(a?.loreBaseline, 'lSPa');
});

test('rollup off uses the save-point commit but still surfaces the bound ack', () => {
  const model = buildMilestones({ savePoints, payloadCommits, loreCommits }, false);
  const b = model.savePoints[0];
  assert.equal(b?.payloadBaseline, 'pSPb');
  assert.equal(b?.loreBaseline, 'lSPb');
  assert.equal(b?.boundAck?.sha, 'lX'); // still exposed for display
});

test('defaultMilestone is the latest save-point', () => {
  const model = buildMilestones({ savePoints, payloadCommits, loreCommits });
  assert.equal(defaultMilestone(model)?.id, 'sp:B');
});

test('buildMilestones lists the un-rolled acks and never lists save-point commits', () => {
  const model = buildMilestones({ savePoints, payloadCommits, loreCommits });
  assert.ok(model.acks.some((m) => m.id === 'ack:pB'));
  assert.ok(model.acks.some((m) => m.id === 'ack:lX'));
  assert.ok(!model.acks.some((m) => m.id.startsWith('ack:pSP') || m.id.startsWith('ack:lSP')));
});

test('save-point timestamp falls back to the ledger date when the commit is out of window', () => {
  const sp: SavePointInfo[] = [
    { name: 'Y', title: 'SP Y', date: '2026-05-20', payloadCommit: 'gone', loreCommit: 'gone2' },
  ];
  const model = buildMilestones({
    savePoints: sp,
    payloadCommits: [c('p', 100)],
    loreCommits: [c('l', 100)],
  });
  assert.equal(model.savePoints[0]?.timestamp, dateToEpochSeconds('2026-05-20'));
  assert.ok((model.savePoints[0]?.timestamp ?? 0) > 0, 'still shows a date');
});

test('activeMilestoneId matches the per-scope baseline pair', () => {
  const model = buildMilestones({ savePoints, payloadCommits, loreCommits });
  assert.equal(activeMilestoneId(model, { payload: 'pSPb', lore: 'lX' }), 'sp:B');
  assert.equal(activeMilestoneId(model, { payload: 'pSPa', lore: 'lSPa' }), 'sp:A');
  assert.equal(activeMilestoneId(model, { payload: 'nope', lore: 'nope' }), null);
});
