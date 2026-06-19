import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { baselineCommit, latestSavePoint, listSavePoints } from '../src/index.js';

function makeScratch(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'save-points-test-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function writeSavePointFile(
  dir: string,
  name: string,
  fm: { title?: string; date: string; lore: string; payload: string },
): void {
  const title = fm.title ?? `Save point ${name}`;
  writeFileSync(
    join(dir, name),
    `---
type: save-point
title: ${title}
updated: ${fm.date}
references: []
date: ${fm.date}
lore_commit: ${fm.lore}
payload_commit: ${fm.payload}
---

Milestone body for ${title}.
`,
  );
}

test('listSavePoints returns [] for a missing directory', () => {
  assert.deepEqual(listSavePoints('/tmp/this-does-not-exist-savepoints-987654'), []);
});

test('listSavePoints returns [] for an empty directory', () => {
  const { dir, cleanup } = makeScratch();
  try {
    assert.deepEqual(listSavePoints(dir), []);
  } finally {
    cleanup();
  }
});

test('listSavePoints reads a single save-point', () => {
  const { dir, cleanup } = makeScratch();
  try {
    writeSavePointFile(dir, '2026-05-26_alpha.save-point.md', {
      title: 'Alpha',
      date: '2026-05-26',
      lore: 'abc1234',
      payload: 'def5678',
    });
    const sp = listSavePoints(dir);
    assert.equal(sp.length, 1);
    assert.equal(sp[0]?.title, 'Alpha');
    assert.equal(sp[0]?.date, '2026-05-26');
    assert.equal(sp[0]?.loreCommit, 'abc1234');
    assert.equal(sp[0]?.payloadCommit, 'def5678');
    assert.match(sp[0]?.body ?? '', /Milestone body/);
  } finally {
    cleanup();
  }
});

test('listSavePoints sorts newest first by date, then by filename desc as tiebreak', () => {
  const { dir, cleanup } = makeScratch();
  try {
    writeSavePointFile(dir, '2026-05-20_alpha.save-point.md', {
      date: '2026-05-20',
      lore: 'a1',
      payload: 'p1',
    });
    writeSavePointFile(dir, '2026-05-26_beta.save-point.md', {
      date: '2026-05-26',
      lore: 'a2',
      payload: 'p2',
    });
    writeSavePointFile(dir, '2026-05-26_gamma.save-point.md', {
      date: '2026-05-26',
      lore: 'a3',
      payload: 'p3',
    });
    const order = listSavePoints(dir).map((s) => s.name);
    assert.deepEqual(order, [
      '2026-05-26_gamma.save-point.md',
      '2026-05-26_beta.save-point.md',
      '2026-05-20_alpha.save-point.md',
    ]);
  } finally {
    cleanup();
  }
});

test('listSavePoints skips files with no/malformed frontmatter', () => {
  const { dir, cleanup } = makeScratch();
  try {
    writeSavePointFile(dir, 'good.save-point.md', {
      date: '2026-05-25',
      lore: 'good-l',
      payload: 'good-p',
    });
    writeFileSync(join(dir, 'bare.save-point.md'), '# Just a body\n\nno yaml\n');
    writeFileSync(
      join(dir, 'wrong-type.md'),
      '---\ntype: blueprint\ntitle: wrong\nupdated: 2026-05-25\nreferences: []\nbranch: contracts\n---\nx\n',
    );
    const sp = listSavePoints(dir);
    assert.equal(sp.length, 1);
    assert.equal(sp[0]?.name, 'good.save-point.md');
  } finally {
    cleanup();
  }
});

test('listSavePoints reads a save-point with no `updated` field', () => {
  // Real-world projects (e.g. IBERIA_MESA) generate save-points without the
  // common `updated` field. The picker keys on date/commits, not `updated`, so
  // these must still surface rather than be dropped from the dropdown.
  const { dir, cleanup } = makeScratch();
  try {
    writeFileSync(
      join(dir, '2026-06-19_no-updated.save-point.md'),
      `---
type: save-point
title: "Iberia_mesa — sin updated"
date: 2026-06-19
slug: no-updated
lore_commit: 228f8f8
payload_commit: f184192
references:
  - group: "Parent"
    path: "./save-points.index.md"
---

Milestone body.
`,
    );
    const sp = listSavePoints(dir);
    assert.equal(sp.length, 1);
    assert.equal(sp[0]?.date, '2026-06-19');
    assert.equal(sp[0]?.loreCommit, '228f8f8');
    assert.equal(sp[0]?.payloadCommit, 'f184192');
  } finally {
    cleanup();
  }
});

test('listSavePoints skips the save-points.index.md (filtered by listMemoryDir)', () => {
  const { dir, cleanup } = makeScratch();
  try {
    writeFileSync(
      join(dir, 'save-points.index.md'),
      '---\ntype: index\ntitle: idx\nupdated: 2026-05-26\nreferences: []\n---\n\nindex\n',
    );
    writeSavePointFile(dir, '2026-05-26_real.save-point.md', {
      date: '2026-05-26',
      lore: 'r-l',
      payload: 'r-p',
    });
    const sp = listSavePoints(dir);
    assert.equal(sp.length, 1);
    assert.equal(sp[0]?.name, '2026-05-26_real.save-point.md');
  } finally {
    cleanup();
  }
});

test('latestSavePoint returns null when nothing is recorded', () => {
  const { dir, cleanup } = makeScratch();
  try {
    assert.equal(latestSavePoint(dir), null);
  } finally {
    cleanup();
  }
});

test('latestSavePoint returns the newest entry', () => {
  const { dir, cleanup } = makeScratch();
  try {
    writeSavePointFile(dir, '2026-05-20_older.save-point.md', {
      date: '2026-05-20',
      lore: 'old-l',
      payload: 'old-p',
    });
    writeSavePointFile(dir, '2026-05-26_newer.save-point.md', {
      date: '2026-05-26',
      lore: 'new-l',
      payload: 'new-p',
    });
    const sp = latestSavePoint(dir);
    assert.equal(sp?.name, '2026-05-26_newer.save-point.md');
    assert.equal(sp?.loreCommit, 'new-l');
    assert.equal(sp?.payloadCommit, 'new-p');
  } finally {
    cleanup();
  }
});

test('baselineCommit picks per-repo commit', () => {
  const sp = {
    path: '/tmp/x',
    name: 'x',
    title: 't',
    date: '2026-05-26',
    loreCommit: 'lore-c',
    payloadCommit: 'payload-c',
    body: '',
  };
  assert.equal(baselineCommit(sp, 'payload'), 'payload-c');
  assert.equal(baselineCommit(sp, 'lore'), 'lore-c');
});
