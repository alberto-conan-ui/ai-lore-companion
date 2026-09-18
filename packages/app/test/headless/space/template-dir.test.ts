import assert from 'node:assert/strict';
import { mkdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { makeTempDir } from '@ai-lore-companion/core/testing';
import {
  TEMPLATE_FOLDER,
  isPackagedApp,
  loreTemplateDir,
} from '../../../src/main/space/template-dir.js';

// Where setup finds the Lore template (phase M3.9): the workspace copy in development,
// the packaged copy under the resources folder in a packaged app, and a literal refusal
// when the one it looks for is missing. Every folder here is temporary.

const WORKSPACE_TEMPLATE = realpathSync(resolve(process.cwd(), '../spec/lore-1.0'));

test('in development the template is the workspace copy, found by going up from the code', () => {
  const found = loreTemplateDir({ packaged: false });
  assert.ok(found.ok, found.ok ? '' : found.error.message);
  assert.equal(realpathSync(found.value), WORKSPACE_TEMPLATE);

  // From a folder deep below `packages/app`, as the built main code is.
  const deep = loreTemplateDir({ packaged: false, from: resolve(process.cwd(), 'out/main') });
  assert.ok(deep.ok);
  assert.equal(realpathSync(deep.value), WORKSPACE_TEMPLATE);
});

test('in a packaged app the template is the copy under the resources folder, not the workspace copy', () => {
  const temp = makeTempDir('ai-lore-template-dir-');
  try {
    const resources = join(temp.dir, 'Resources');
    mkdirSync(join(resources, TEMPLATE_FOLDER, 'lore'), { recursive: true });
    // `from` points into the workspace; a packaged app must still take its own copy.
    const found = loreTemplateDir({
      packaged: true,
      resourcesPath: resources,
      from: process.cwd(),
    });
    assert.ok(found.ok, found.ok ? '' : found.error.message);
    assert.equal(found.value, join(resources, TEMPLATE_FOLDER));
  } finally {
    temp.cleanup();
  }
});

test('a packaged app whose copy is missing refuses with a literal reason and does not take the workspace copy', () => {
  const temp = makeTempDir('ai-lore-template-dir-');
  try {
    const resources = join(temp.dir, 'Resources');
    mkdirSync(resources);
    const missing = loreTemplateDir({
      packaged: true,
      resourcesPath: resources,
      from: process.cwd(),
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.error.kind, 'template-missing');
      assert.match(missing.error.message, /The Lore template was not found/);
      assert.ok(missing.error.message.includes(join(resources, TEMPLATE_FOLDER)));
    }
    // A folder named `lore-1.0` without `lore/` in it is not the template either.
    mkdirSync(join(resources, TEMPLATE_FOLDER));
    assert.equal(loreTemplateDir({ packaged: true, resourcesPath: resources }).ok, false);
  } finally {
    temp.cleanup();
  }
});

test('in development with no template above the code, setup is refused with a literal reason', () => {
  const temp = makeTempDir('ai-lore-template-dir-');
  try {
    const missing = loreTemplateDir({ packaged: false, from: temp.dir });
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.error.kind, 'template-missing');
      assert.match(missing.error.message, /no folder above .* holds spec\/lore-1\.0/);
    }
  } finally {
    temp.cleanup();
  }
});

test('a process is a packaged app only under Electron, started without a main script, with a resources folder', () => {
  const electron = (extra: Partial<NodeJS.Process>): NodeJS.Process =>
    ({
      versions: { ...process.versions, electron: '32.2.7' },
      resourcesPath: '/Applications/AI-Lore.app/Contents/Resources',
      ...extra,
    }) as NodeJS.Process;
  assert.equal(isPackagedApp(electron({})), true);
  assert.equal(isPackagedApp(electron({ defaultApp: true })), false);
  assert.equal(isPackagedApp(electron({ resourcesPath: undefined as unknown as string })), false);
  assert.equal(isPackagedApp(process), false);
});
