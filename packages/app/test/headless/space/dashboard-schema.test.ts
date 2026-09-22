import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  dashboardDefinitionHash,
  readDashboardDefinition,
  validateDashboardReport,
} from '../../../src/main/space/dashboard-definition.js';
import type { DashboardDefinition, DashboardReportInput } from '../../../src/shared/ipc/space/dashboard-report.types.js';
import { LORE_TEMPLATE_DIR } from './space-harness.js';

const definition: DashboardDefinition = {
  version: 2,
  bands: [
    {
      id: 'needs-you',
      panels: [
        {
          id: 'next',
          kind: 'next-action',
          source: 'companion',
          pmLine: { id: 'next-note', instruction: 'Explain why this is next.' },
        },
        {
          id: 'review',
          kind: 'review-documents',
          source: 'companion',
          limit: 3,
          recentDays: 7,
          order: 'oldest',
        },
      ],
    },
    {
      id: 'moving',
      panels: [
        { id: 'progress', kind: 'in-progress', source: 'companion', limit: 2, order: 'stage' },
        {
          id: 'dormant',
          kind: 'dormant',
          source: 'companion',
          pmLine: { id: 'dormant-note', instruction: 'Characterise the dormant work.' },
        },
      ],
    },
    {
      id: 'waiting',
      panels: [
        { id: 'pulls', kind: 'pull-requests', source: 'companion', limit: 4, order: 'state' },
        { id: 'live', kind: 'live-sessions', source: 'companion' },
        { id: 'agents', kind: 'agents-board', source: 'companion' },
        { id: 'stats', kind: 'space-stats', source: 'companion' },
        { id: 'handover', kind: 'handovers', source: 'companion' },
      ],
    },
  ],
};

const reportDefinition: DashboardDefinition = {
  version: 2,
  bands: [
    {
      id: 'needs-you',
      panels: [
        { id: 'text', kind: 'text', source: 'pm', title: 'Text' },
        { id: 'metric', kind: 'metric', source: 'pm', title: 'Metric' },
        { id: 'list', kind: 'list', source: 'pm', title: 'List', limit: 1 },
      ],
    },
  ],
};

async function spaceWith(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'dashboard-schema-'));
  await mkdir(join(root, 'lore/corpus/default'), { recursive: true });
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('the packaged v2 definition validates and carries the three fixed bands', async () => {
  const space = await spaceWith();
  try {
    const resolved = await readDashboardDefinition({ spaceRoot: space.root, templateDir: LORE_TEMPLATE_DIR });
    assert.ok(resolved.ok);
    if (!resolved.ok) return;
    assert.equal(resolved.value.source, 'packaged-default');
    assert.deepEqual(resolved.value.definition.bands.map((band) => band.id), [
      'needs-you',
      'moving',
      'waiting',
    ]);
    const panels = resolved.value.definition.bands.flatMap((band) => band.panels);
    assert.ok(panels.some((panel) => panel.kind === 'agents-board'));
    assert.ok(panels.some((panel) => panel.kind === 'live-sessions'));
    assert.deepEqual(
      panels.flatMap((panel) => (panel.source === 'companion' && panel.pmLine ? [panel.pmLine.id] : [])),
      ['next-action-note', 'dormant-note'],
    );
  } finally {
    await space.cleanup();
  }
});

test('a v1 override falls through each tier with an unsupported-version diagnostic', async () => {
  const space = await spaceWith();
  try {
    const v1 = { version: 1, sections: [], components: [] };
    const own = join(space.root, 'lore/corpus/dashboard.json');
    await writeFile(own, JSON.stringify(v1));
    await writeFile(
      join(space.root, 'lore/corpus/default/dashboard.json'),
      JSON.stringify(definition),
    );
    const installed = await readDashboardDefinition({ spaceRoot: space.root, templateDir: LORE_TEMPLATE_DIR });
    assert.ok(installed.ok);
    if (!installed.ok) return;
    assert.equal(installed.value.source, 'installed-default');
    assert.equal(installed.value.diagnostic?.kind, 'unsupported-version');
    assert.equal(installed.value.diagnostic?.path, own);
    assert.equal(
      installed.value.diagnostic?.message,
      'This dashboard definition is version 1. The Dashboard requires version 2, so a default definition is shown instead. Rewrite it with the verb dashboard-update, or remove it with dashboard-reset.',
    );

    await writeFile(join(space.root, 'lore/corpus/default/dashboard.json'), JSON.stringify(v1));
    const packaged = await readDashboardDefinition({ spaceRoot: space.root, templateDir: LORE_TEMPLATE_DIR });
    assert.ok(packaged.ok);
    if (!packaged.ok) return;
    assert.equal(packaged.value.source, 'packaged-default');
    assert.equal(packaged.value.diagnostic?.kind, 'unsupported-version');
    assert.equal(packaged.value.diagnostic?.path, own);
  } finally {
    await space.cleanup();
  }
});

test('the validator resolves panel defaults and rejects structural and option mistakes', async () => {
  const space = await spaceWith();
  try {
    await writeFile(join(space.root, 'lore/corpus/dashboard.json'), JSON.stringify(definition));
    const resolved = await readDashboardDefinition({ spaceRoot: space.root, templateDir: LORE_TEMPLATE_DIR });
    assert.ok(resolved.ok);
    if (!resolved.ok) return;
    const panels = resolved.value.definition.bands.flatMap((band) => band.panels);
    assert.deepEqual(panels.find((panel) => panel.id === 'live'), {
      id: 'live',
      kind: 'live-sessions',
      source: 'companion',
      limit: 10,
      order: 'newest',
    });
    assert.deepEqual(panels.find((panel) => panel.id === 'handover'), {
      id: 'handover',
      kind: 'handovers',
      source: 'companion',
      limit: 5,
      order: 'newest',
    });
    const checked = async (value: unknown): Promise<string | undefined> => {
      await writeFile(join(space.root, 'lore/corpus/dashboard.json'), JSON.stringify(value));
      const read = await readDashboardDefinition({ spaceRoot: space.root, templateDir: LORE_TEMPLATE_DIR });
      if (!read.ok) throw new Error(read.error.message);
      return read.value.diagnostic?.message;
    };
    for (const [name, invalid] of [
      ['unknown kind', { ...definition, bands: [{ id: 'needs-you', panels: [{ id: 'x', kind: 'unknown', source: 'companion' }] }] }],
      ['wrong band', { ...definition, bands: [{ id: 'moving', panels: [{ id: 'x', kind: 'publish-area', source: 'companion' }] }] }],
      ['duplicate kind', { ...definition, bands: [{ id: 'waiting', panels: [{ id: 'x', kind: 'live-sessions', source: 'companion' }, { id: 'y', kind: 'live-sessions', source: 'companion' }] }] }],
      ['duplicate id', { ...definition, bands: [{ id: 'needs-you', panels: [{ id: 'x', kind: 'next-action', source: 'companion', pmLine: { id: 'x', instruction: 'x' } }] }] }],
      ['bad pm line', { ...definition, bands: [{ id: 'waiting', panels: [{ id: 'x', kind: 'space-stats', source: 'companion', pmLine: { id: 'note', instruction: 'x' } }] }] }],
      ['bad limit', { ...definition, bands: [{ id: 'waiting', panels: [{ id: 'x', kind: 'handovers', source: 'companion', limit: 51 }] }] }],
      ['bad recent days', { ...definition, bands: [{ id: 'needs-you', panels: [{ id: 'x', kind: 'review-documents', source: 'companion', recentDays: 0 }] }] }],
      ['bad order', { ...definition, bands: [{ id: 'waiting', panels: [{ id: 'x', kind: 'handovers', source: 'companion', order: 'age' }] }] }],
    ] as const) {
      assert.ok(await checked(invalid), name);
    }
  } finally {
    await space.cleanup();
  }
});

test('hashing stays canonical and typed PM values remain validated', async () => {
  const space = await spaceWith();
  try {
    await writeFile(join(space.root, 'lore/corpus/dashboard.json'), JSON.stringify(reportDefinition));
    const resolved = await readDashboardDefinition({ spaceRoot: space.root, templateDir: LORE_TEMPLATE_DIR });
    assert.ok(resolved.ok);
    if (!resolved.ok) return;
    assert.equal(resolved.value.hash, dashboardDefinitionHash(resolved.value.definition));
    const valid: DashboardReportInput = {
      definitionHash: resolved.value.hash,
      components: [
        { id: 'text', type: 'text', text: 'First paragraph\nSecond paragraph' },
        { id: 'metric', type: 'metric', value: 0, unit: 'items' },
        { id: 'list', type: 'list', items: [{ id: 'one', label: 'One' }] },
      ],
      basis: 'Workbench',
    };
    assert.ok(validateDashboardReport(resolved.value, valid).ok);
    const checked = (value: unknown) =>
      validateDashboardReport(resolved.value, value as DashboardReportInput).ok;
    assert.ok(
      checked({
        ...valid,
        components: valid.components.map((component) => ({
          id: component.id,
          unavailable: true,
          reason: 'Source unavailable',
        })),
      }),
    );
    for (const invalid of [
      { ...valid, definitionHash: 'obsolete' },
      { ...valid, components: valid.components.slice(1) },
      { ...valid, components: [valid.components[0], valid.components[0], valid.components[2]] },
      {
        ...valid,
        components: [
          { id: 'unknown', type: 'text', text: 'Forged value' },
          ...valid.components.slice(1),
        ],
      },
      {
        ...valid,
        components: [{ id: 'text', type: 'metric', value: 1 }, ...valid.components.slice(1)],
      },
      {
        ...valid,
        components: [
          { id: 'text', type: 'text', text: 'x'.repeat(4097) },
          ...valid.components.slice(1),
        ],
      },
      {
        ...valid,
        components: [
          { id: 'text', unavailable: true, reason: 'Unavailable', text: 'extra' },
          ...valid.components.slice(1),
        ],
      },
      {
        ...valid,
        components: [
          valid.components[0],
          { id: 'metric', type: 'metric', value: Number.POSITIVE_INFINITY },
          valid.components[2],
        ],
      },
      {
        ...valid,
        components: [
          valid.components[0],
          valid.components[1],
          {
            id: 'list',
            type: 'list',
            items: [
              { id: 'a', label: 'a' },
              { id: 'b', label: 'b' },
            ],
          },
        ],
      },
    ])
      assert.equal(checked(invalid), false, JSON.stringify(invalid).slice(0, 160));

    await writeFile(join(space.root, 'lore/corpus/dashboard.json'), JSON.stringify(definition));
    const lineDefinition = await readDashboardDefinition({
      spaceRoot: space.root,
      templateDir: LORE_TEMPLATE_DIR,
    });
    assert.ok(lineDefinition.ok);
    if (!lineDefinition.ok) return;
    assert.ok(
      validateDashboardReport(lineDefinition.value, {
        definitionHash: lineDefinition.value.hash,
        components: [
          { id: 'next-note', type: 'text', text: 'This action unblocks the release.' },
          { id: 'dormant-note', type: 'text', text: 'No work has happened this week.' },
        ],
      }).ok,
    );
  } finally {
    await space.cleanup();
  }
});
