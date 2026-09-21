import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  readDashboardDefinition,
  validateDashboardReport,
} from '../../../src/main/space/dashboard-definition.js';
import type {
  DashboardDefinition,
  DashboardReportInput,
} from '../../../src/shared/ipc/space/dashboard-report.types.js';

const definition: DashboardDefinition = {
  version: 1,
  sections: [
    {
      id: 'summary',
      title: 'Summary',
      columns: [
        ['text', 'metric'],
        ['list', 'facts'],
      ],
    },
  ],
  components: [
    { id: 'text', type: 'text', source: 'pm', title: 'Text' },
    { id: 'metric', type: 'metric', source: 'pm', title: 'Metric' },
    { id: 'list', type: 'list', source: 'pm', title: 'List', limit: 1 },
    { id: 'facts', type: 'activity', source: 'companion', title: 'Facts' },
  ],
};

test('definition resolution covers packaged defaults, installed defaults and malformed override diagnostics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dashboard-schema-'));
  try {
    const templateDir = join(root, 'template');
    await mkdir(join(templateDir, 'lore/corpus/default'), { recursive: true });
    await writeFile(
      join(templateDir, 'lore/corpus/default/dashboard.json'),
      JSON.stringify(definition),
    );
    const spaceRoot = join(root, 'space');
    await mkdir(join(spaceRoot, 'lore/corpus/default'), { recursive: true });
    const packaged = await readDashboardDefinition({ spaceRoot, templateDir });
    assert.ok(packaged.ok);
    assert.equal(packaged.value.source, 'packaged-default');
    assert.equal(packaged.value.diagnostic, null);
    await writeFile(
      join(spaceRoot, 'lore/corpus/default/dashboard.json'),
      JSON.stringify(definition),
    );
    const installed = await readDashboardDefinition({ spaceRoot, templateDir });
    assert.ok(installed.ok);
    assert.equal(installed.value.source, 'installed-default');
    for (const bad of [
      { ...definition, version: 2 },
      { ...definition, components: [...definition.components, definition.components[0]] },
      { ...definition, sections: [...definition.sections, definition.sections[0]] },
      { ...definition, sections: [{ id: 's', title: 'Bad', columns: [['unknown']] }] },
      { ...definition, sections: [{ id: 's', title: 'Bad', columns: [['text', 'text']] }] },
      {
        ...definition,
        components: definition.components.map((c) =>
          c.id === 'facts' ? { ...c, type: 'javascript' } : c,
        ),
      },
    ]) {
      await writeFile(join(spaceRoot, 'lore/corpus/dashboard.json'), JSON.stringify(bad));
      const result = await readDashboardDefinition({ spaceRoot, templateDir });
      assert.ok(result.ok);
      assert.equal(result.value.source, 'installed-default');
      assert.equal(result.value.diagnostic?.kind, 'invalid-definition');
    }
    await writeFile(join(spaceRoot, 'lore/corpus/dashboard.json'), JSON.stringify(definition));
    const custom = await readDashboardDefinition({ spaceRoot, templateDir });
    assert.ok(custom.ok);
    assert.equal(custom.value.source, 'space');
    const valid = {
      definitionHash: custom.value.hash,
      components: [
        { id: 'text', type: 'text', text: 'First paragraph\nSecond paragraph' },
        { id: 'metric', type: 'metric', value: 0, unit: 'items' },
        { id: 'list', type: 'list', items: [{ id: 'one', label: '<script>literal</script>' }] },
      ],
      basis: 'Workbench',
    } as DashboardReportInput;
    assert.ok(validateDashboardReport(custom.value, valid).ok);
    if (!('components' in valid)) throw new Error('typed fixture');
    const checked = (value: unknown) =>
      validateDashboardReport(custom.value, value as DashboardReportInput).ok;
    assert.ok(
      checked({
        ...valid,
        components: valid.components.map((c) => ({
          id: c.id,
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
          { id: 'facts', type: 'text', text: 'Forged fact' },
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
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
