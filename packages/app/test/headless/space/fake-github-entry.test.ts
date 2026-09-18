import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as core from '@ai-lore-companion/core';
import { formatIssueMarker } from '@ai-lore-companion/core';
import { createFakeGitHub } from '@ai-lore-companion/core/testing';

// `FakeGitHub` is reached through the package entry
// `@ai-lore-companion/core/testing`, as the fixture builders are. This file
// shows that the app's headless tests can build one, steer it and read its
// state, and that the main barrel, which the main process loads in production,
// does not carry it.

test('the app builds a FakeGitHub from @ai-lore-companion/core/testing, steers it and reads its state', async () => {
  const gitHub = createFakeGitHub({ account: 'fake-human' });
  try {
    const repository = await gitHub.createRepository({
      owner: 'fake-human',
      name: 'my-space',
      private: true,
    });
    assert.ok(repository.ok);
    const marker = formatIssueMarker('session', 'S-1');
    const created = await gitHub.createIssue({
      repository: repository.value.fullName,
      title: 'Session S-1',
      body: marker,
      labels: [],
    });
    assert.ok(created.ok);
    const found = await gitHub.findIssueByMarker({
      repository: repository.value.fullName,
      marker,
    });
    assert.deepEqual(found, { ok: true, value: created.value });

    gitHub.setUnreachable(true);
    const offline = await gitHub.findIssueByMarker({
      repository: repository.value.fullName,
      marker,
    });
    assert.equal(!offline.ok && offline.error.kind, 'unreachable');
    gitHub.setUnreachable(false);
    gitHub.rateLimitNext(1, 30);
    const limited = await gitHub.auth();
    assert.equal(!limited.ok && limited.error.kind, 'rate-limited');

    assert.deepEqual(
      gitHub.state().issues.map((issue) => issue.title),
      ['Session S-1'],
    );
    assert.deepEqual(
      gitHub.calls.map((call) => call.operation),
      ['createRepository', 'createIssue', 'findIssueByMarker', 'findIssueByMarker', 'auth'],
    );
  } finally {
    gitHub.dispose();
  }
});

test('the main barrel of core does not carry FakeGitHub', () => {
  assert.equal('createFakeGitHub' in core, false);
  assert.equal(typeof core.createGhCliGitHub, 'function');
});
