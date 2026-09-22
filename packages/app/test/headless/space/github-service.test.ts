import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { type GitHubPort, execFileRunner, formatIssueMarker } from '@ai-lore-companion/core';
import { createFakeGitHub } from '@ai-lore-companion/core/testing';
import type { SpaceContext } from '../../../src/main/space/context.js';
import { spaceGitHub, unreachableGitHub } from '../../../src/main/space/github-service.js';
import { silentSpaceLog } from '../../../src/main/space/log.js';

function context(): SpaceContext {
  return {
    key: 'concurrent-github-test',
    root: '/tmp/concurrent-github-test',
    paths: {} as SpaceContext['paths'],
    desk: {} as SpaceContext['desk'],
    manifest: {} as SpaceContext['manifest'],
    ptyService: null,
    windowIds: new Set(),
    log: silentSpaceLog,
    runner: execFileRunner,
    service: () => {
      throw new Error('not used by the GitHub service');
    },
  };
}

function withFakeEnvironment(stateFile: string): { restore(): void } {
  const oldCockpitE2e = process.env.COCKPIT_E2E;
  const oldStateFile = process.env.AI_LORE_FAKE_GITHUB;
  process.env.COCKPIT_E2E = '1';
  process.env.AI_LORE_FAKE_GITHUB = stateFile;
  return {
    restore() {
      if (oldCockpitE2e === undefined) Reflect.deleteProperty(process.env, 'COCKPIT_E2E');
      else process.env.COCKPIT_E2E = oldCockpitE2e;
      if (oldStateFile === undefined) Reflect.deleteProperty(process.env, 'AI_LORE_FAKE_GITHUB');
      else process.env.AI_LORE_FAKE_GITHUB = oldStateFile;
    },
  };
}

test('concurrent service port calls share one fake and its mutations', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'ai-lore-github-service-'));
  const stateFile = join(folder, 'github.json');
  const seed = createFakeGitHub({ stateFile });
  seed.save(stateFile);
  seed.dispose();
  const env = withFakeEnvironment(stateFile);
  try {
    const service = spaceGitHub.create(context());
    const [first, second] = await Promise.all([service.port(), service.port()]);

    assert.strictEqual(first, second);
    assert.ok(
      (await first.createRepository({ owner: 'fake-human', name: 'shared', private: true })).ok,
    );
    const marker = formatIssueMarker('dashboard', 'shared');
    assert.ok(
      (
        await first.createIssue({
          repository: 'fake-human/shared',
          title: 'Visible to both callers',
          body: marker,
          labels: [],
        })
      ).ok,
    );
    const foundBySecond = await second.findIssueByMarker({
      repository: 'fake-human/shared',
      marker,
    });
    assert.ok(foundBySecond.ok);
    assert.ok(foundBySecond.value);
  } finally {
    env.restore();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('a rejected default port build is cleared so the next call retries', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'ai-lore-github-service-'));
  const stateFile = join(folder, 'github.json');
  writeFileSync(stateFile, '{ malformed');
  const env = withFakeEnvironment(stateFile);
  try {
    const service = spaceGitHub.create(context());
    await assert.rejects(service.port());

    const seed = createFakeGitHub();
    seed.save(stateFile);
    seed.dispose();
    const retried = await service.port();
    assert.ok((await retried.auth()).ok);
  } finally {
    env.restore();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('use replaces a default port even when its build is still pending', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'ai-lore-github-service-'));
  const stateFile = join(folder, 'github.json');
  const seed = createFakeGitHub({ stateFile });
  seed.save(stateFile);
  seed.dispose();
  const env = withFakeEnvironment(stateFile);
  try {
    const service = spaceGitHub.create(context());
    const pending = service.port();
    const replacement: GitHubPort = unreachableGitHub('test replacement');
    service.use(replacement);
    assert.strictEqual(await pending, replacement);
    assert.strictEqual(await service.port(), replacement);
  } finally {
    env.restore();
    rmSync(folder, { recursive: true, force: true });
  }
});
