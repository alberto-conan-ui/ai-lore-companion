import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type { SessionRecord } from '@ai-lore-companion/core';
import {
  readDashboardDefinition,
  validateDashboardReport,
} from '../../../src/main/space/dashboard-definition.js';
import {
  type DashboardReportService,
  createDashboardReportService,
} from '../../../src/main/space/dashboard-report.js';
import { readDashboardWorkbench } from '../../../src/main/space/dashboard-workbench.js';
import type { DashboardDefinition } from '../../../src/shared/ipc/space/dashboard-report.types.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function rootWithDefinition(definition: DashboardDefinition): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ai-lore-dashboard-definition-'));
  roots.push(root);
  await mkdir(join(root, 'lore', 'corpus', 'default'), { recursive: true });
  await mkdir(join(root, 'workbench', 'drafts'), { recursive: true });
  await mkdir(join(root, 'workbench', 'journal'), { recursive: true });
  await writeFile(join(root, 'lore', 'corpus', 'dashboard.json'), JSON.stringify(definition));
  return root;
}

function definition(): DashboardDefinition {
  return {
    version: 2,
    bands: [
      {
        id: 'needs-you',
        panels: [
          {
            id: 'next',
            kind: 'next-action',
            source: 'companion',
            pmLine: { id: 'position', instruction: 'Explain the present position.' },
          },
          {
            id: 'review',
            kind: 'review-documents',
            source: 'companion',
            limit: 3,
            recentDays: 14,
            order: 'newest',
          },
        ],
      },
      {
        id: 'waiting',
        panels: [
          { id: 'handover', kind: 'handovers', source: 'companion', limit: 5, order: 'newest' },
        ],
      },
    ],
  };
}

function reportInput(
  service: DashboardReportService,
  text = 'current',
): {
  definitionHash: string;
  components: [{ id: string; type: 'text'; text: string }];
} {
  const resolved = service.definition();
  assert.ok(resolved);
  return {
    definitionHash: resolved.hash,
    components: [{ id: 'position', type: 'text', text }],
  };
}

test('definition resolution prefers a custom file and retains the last valid definition on fallback', async () => {
  const root = await rootWithDefinition(definition());
  const first = await readDashboardDefinition({ spaceRoot: root });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.value.source, 'space');

  const service = createDashboardReportService({
    definition: { spaceRoot: root, templateDir: join(root, 'missing-template') },
    workbenchRoot: join(root, 'workbench'),
  });
  await service.ready();
  assert.equal(service.definition()?.hash, first.value.hash);
  await writeFile(join(root, 'lore', 'corpus', 'dashboard.json'), '{ broken');
  await writeFile(
    join(root, 'lore', 'corpus', 'default', 'dashboard.json'),
    JSON.stringify(definition()),
  );
  const fallback = await readDashboardDefinition({ spaceRoot: root });
  assert.equal(fallback.ok, true);
  if (fallback.ok) {
    assert.equal(fallback.value.source, 'installed-default');
    assert.ok(fallback.value.diagnostic);
  }

  await service.refreshContext();
  assert.equal(service.definition()?.hash, first.value.hash);
  service.dispose();
});

test('a v1 replacement keeps the accepted definition and exposes its diagnostic on state', async () => {
  const root = await rootWithDefinition(definition());
  const service = createDashboardReportService({
    definition: { spaceRoot: root, templateDir: join(root, 'missing-template') },
    workbenchRoot: join(root, 'workbench'),
  });
  await service.ready();
  const accepted = service.definition();
  assert.ok(accepted);
  await writeFile(
    join(root, 'lore', 'corpus', 'dashboard.json'),
    JSON.stringify({ version: 1, sections: [], components: [] }),
  );
  await service.refreshContext();
  assert.equal(service.definition()?.hash, accepted.hash);
  assert.equal(service.read().definition?.diagnostic?.kind, 'unsupported-version');
  service.dispose();
});

test('definition and PM validation reject unsupported, duplicate, incomplete and obsolete data', async () => {
  const root = await rootWithDefinition(definition());
  const resolved = await readDashboardDefinition({ spaceRoot: root });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  const valid = {
    definitionHash: resolved.value.hash,
    components: [{ id: 'position', type: 'text' as const, text: 'ok' }],
    basis: 'line one\n\tline two',
  };
  assert.equal(validateDashboardReport(resolved.value, valid).ok, true);
  assert.equal(
    validateDashboardReport(resolved.value, {
      ...valid,
      components: [{ id: 'position', type: 'text' as const, text: 'line one\n\tline two' }],
    }).ok,
    true,
  );
  assert.equal(
    validateDashboardReport(resolved.value, { ...valid, extra: true } as never).ok,
    false,
  );
  assert.equal(
    validateDashboardReport(resolved.value, { ...valid, definitionHash: 'old' }).ok,
    false,
  );
  assert.equal(
    validateDashboardReport(resolved.value, {
      definitionHash: resolved.value.hash,
      components: [
        { id: 'position', type: 'text', text: 'a' },
        { id: 'position', type: 'text', text: 'b' },
      ],
    }).ok,
    false,
  );

  const badDefinition = {
    version: 2,
    bands: [
      {
        id: 'needs-you',
        panels: [{ id: 'next', kind: 'next-action', source: 'companion', bogus: true }],
      },
    ],
  };
  await writeFile(join(root, 'lore', 'corpus', 'dashboard.json'), JSON.stringify(badDefinition));
  const rejected = await readDashboardDefinition({ spaceRoot: root });
  assert.equal(rejected.ok, true);
  if (rejected.ok) assert.ok(rejected.value.diagnostic);

  const badLimit: DashboardDefinition = {
    version: 2,
    bands: [
      {
        id: 'needs-you',
        panels: [{ id: 'position', kind: 'text', source: 'pm', title: 'Position', limit: 2 }],
      },
    ],
  };
  await writeFile(join(root, 'lore', 'corpus', 'dashboard.json'), JSON.stringify(badLimit));
  const ignoredLimit = await readDashboardDefinition({ spaceRoot: root });
  assert.equal(ignoredLimit.ok, true);
  if (ignoredLimit.ok) assert.ok(ignoredLimit.value.diagnostic);
});

test('duplicate list item IDs and Workbench reads are bounded', async () => {
  const root = await rootWithDefinition(definition());
  const resolved = await readDashboardDefinition({ spaceRoot: root });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(
    validateDashboardReport(resolved.value, {
      definitionHash: resolved.value.hash,
      components: [
        {
          id: 'position',
          type: 'text',
          text: 'ok',
        },
      ],
    }).ok,
    true,
  );
  const listDefinition: DashboardDefinition = {
    version: 2,
    bands: [
      {
        id: 'needs-you',
        panels: [{ id: 'items', kind: 'list', source: 'pm', title: 'Items', limit: 5 }],
      },
    ],
  };
  const listRoot = await rootWithDefinition(listDefinition);
  const listResolved = await readDashboardDefinition({ spaceRoot: listRoot });
  assert.equal(listResolved.ok, true);
  if (!listResolved.ok) return;
  assert.equal(
    validateDashboardReport(listResolved.value, {
      definitionHash: listResolved.value.hash,
      components: [
        {
          id: 'items',
          type: 'list',
          items: [
            { id: 'same', label: 'one' },
            { id: 'same', label: 'two' },
          ],
        },
      ],
    }).ok,
    false,
  );

  for (let index = 0; index < 5; index += 1)
    await writeFile(join(root, 'workbench', 'drafts', `doc-${index}.md`), `# Document ${index}\n`);
  const snapshot = await readDashboardWorkbench({
    workbenchRoot: join(root, 'workbench'),
    recentDays: 60,
    limit: 10,
  });
  assert.equal(snapshot.documents.length, 5);
  assert.equal(
    snapshot.documents.every((document) => document.reviewCandidate === true),
    true,
  );
});

test('Workbench reads a handover at the end of a bounded long journal and rejects escapes', async () => {
  const root = await rootWithDefinition(definition());
  const longPrefix = 'x'.repeat(180 * 1024);
  await writeFile(
    join(root, 'workbench', 'journal', 's-123.md'),
    `${longPrefix}\n## Handover\nKeep this evidence.\n`,
  );
  const outside = await mkdtemp(join(tmpdir(), 'ai-lore-dashboard-outside-'));
  roots.push(outside);
  await writeFile(join(outside, 'secret.md'), '# Secret\n');
  await symlink(outside, join(root, 'workbench', 'drafts', 'outside'));
  const snapshot = await readDashboardWorkbench({
    workbenchRoot: join(root, 'workbench'),
    limit: 10,
  });
  assert.equal(snapshot.handovers[0]?.text, 'Keep this evidence.');
  assert.equal(
    snapshot.documents.some((document) => document.path.includes('secret')),
    false,
  );
  assert.equal(
    snapshot.problems.some((problem) => problem.kind === 'unsafe-path'),
    true,
  );
});

test('handover sheets retain text beyond the old preview limit and the whole fallback note', async () => {
  const root = await rootWithDefinition(definition());
  const done = `${'A detailed implementation note. '.repeat(200)}The final evidence.`;
  const fallback =
    '# An unstructured note\nOpening line.\nSecond line.\nThird line.\nFourth line must survive.';
  await writeFile(
    join(root, 'workbench', 'journal', 'parts.md'),
    `# Session\n## Handover\n### Done\n${done}\n### In progress\nVerification.\n### What the next session should do\nReview the result.`,
  );
  await writeFile(join(root, 'workbench', 'journal', 'fallback.md'), fallback);
  const snapshot = await readDashboardWorkbench({
    workbenchRoot: join(root, 'workbench'),
    limit: 10,
  });
  assert.equal(
    snapshot.handovers.find((entry) => entry.path.endsWith('parts.md'))?.parts.done,
    done,
  );
  assert.equal(
    snapshot.handovers.find((entry) => entry.path.endsWith('fallback.md'))?.parts.text,
    fallback,
  );
});

test('polling marks body edits stale, ignores transient activity and rejects late request generations', async () => {
  const root = await rootWithDefinition(definition());
  const draft = join(root, 'workbench', 'drafts', 'draft.md');
  await writeFile(draft, '# Draft\nfirst\n');
  let purpose: SessionRecord['purpose'] = 'dashboard-refresh';
  const service = createDashboardReportService({
    definition: { spaceRoot: root },
    workbenchRoot: join(root, 'workbench'),
    pollIntervalMs: 250,
    sessions: () => [
      {
        id: 'refresh-session',
        engine: 'test',
        attended: true,
        purpose,
        mode: 'read-only',
        startedAt: '2026-09-21T00:00:00.000Z',
      },
    ],
  });
  await service.ready();
  service.openSession('pm');
  assert.equal(service.publish('pm', reportInput(service)).ok, true);
  purpose = 'dashboard-refresh';
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(service.read().report?.stale, false);
  await writeFile(
    join(root, 'lore', 'corpus', 'dashboard.json'),
    JSON.stringify({
      version: 2,
      bands: [
        {
          id: 'needs-you',
          panels: [
            {
              id: 'next',
              kind: 'next-action',
              source: 'companion',
              pmLine: { id: 'position', instruction: 'Changed position.' },
            },
            {
              id: 'review',
              kind: 'review-documents',
              source: 'companion',
              limit: 3,
              recentDays: 14,
              order: 'newest',
            },
          ],
        },
        {
          id: 'waiting',
          panels: [
            { id: 'handover', kind: 'handovers', source: 'companion', limit: 5, order: 'newest' },
          ],
        },
      ],
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(service.read().report?.staleReason, 'definition-changed');
  service.openSession('pm-after-definition');
  assert.equal(service.publish('pm-after-definition', reportInput(service)).ok, true);
  await writeFile(draft, '# Draft\nsecond body\n');
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(service.read().report?.staleReason, 'workbench-changed');

  const request = service.request('human').request;
  service.openSession('refresh', request.requestId);
  const late = service.publish('refresh', { ...reportInput(service), definitionHash: 'late' });
  assert.equal(late.ok, false);
  if (!late.ok) assert.equal(late.error.kind, 'request-mismatch');
  service.failRequest(request.requestId, { kind: 'timeout', message: 'late' });
  assert.equal(service.publish('refresh', reportInput(service)).ok, false);
  service.dispose();
});

test('request-bound reports refresh generation on context read but reject later source changes', async () => {
  const root = await rootWithDefinition(definition());
  const service = createDashboardReportService({
    definition: { spaceRoot: root },
    workbenchRoot: join(root, 'workbench'),
  });
  await service.ready();

  const reread = service.request('human').request;
  service.openSession('refresh-after-attach');
  assert.equal(service.attachRequest(reread.requestId, 'refresh-after-attach'), true);
  service.markProjectChanged();
  assert.ok(service.readContextForSession('refresh-after-attach'));
  assert.equal(service.publish('refresh-after-attach', reportInput(service)).ok, true);
  service.closeSession('refresh-after-attach', { preserveReport: true });

  const rejectedRequest = service.request('human').request;
  service.openSession('refresh-after-read');
  assert.equal(service.attachRequest(rejectedRequest.requestId, 'refresh-after-read'), true);
  assert.ok(service.readContextForSession('refresh-after-read'));
  service.markProjectChanged();
  const rejected = service.publish('refresh-after-read', reportInput(service));
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.error.kind, 'request-mismatch');
  service.failRequest(rejectedRequest.requestId, { kind: 'test-reset', message: 'reset' });
  service.dispose();
});
