import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CommandRunner, RunResult } from '@ai-lore-companion/core';
import { createGhCliGitHub } from '@ai-lore-companion/core';
import { withCommandLog } from '../../../src/main/space/command-log.js';
import type { SpaceLog, SpaceLogFields } from '../../../src/main/space/log.js';

// `withCommandLog` (phase M9.6, architecture document A.6): one log line per
// `gh` call, and one per network `git` call, with output never logged.

type Logged = { event: string; fields: SpaceLogFields };

function recordingLog(): { log: SpaceLog; calls: Logged[] } {
  const calls: Logged[] = [];
  const record = (event: string, fields?: SpaceLogFields) =>
    calls.push({ event, fields: fields ?? {} });
  return { log: { info: record, warn: record, error: record }, calls };
}

test('withCommandLog names a graphql call after its query constant, with a number ms and outcome ok', async () => {
  const { log, calls } = recordingLog();
  const runner: CommandRunner = {
    run: async (): Promise<RunResult> => ({
      code: 0,
      stdout: '{"data":{"repository":null}}',
      stderr: '',
    }),
  };
  const port = createGhCliGitHub(withCommandLog(runner, log, 'gh'));
  await port.findRepository('octo/space');

  const line = calls.find((call) => call.event === 'github-call');
  assert.ok(line, calls.map((call) => call.event).join(','));
  assert.equal(line?.fields.name, 'REPOSITORY_QUERY');
  assert.equal(typeof line?.fields.ms, 'number');
  assert.equal(line?.fields.code, 0);
  assert.equal(line?.fields.outcome, 'ok');
});

test('withCommandLog reports a timeout as outcome timeout', async () => {
  const { log, calls } = recordingLog();
  const runner: CommandRunner = {
    run: async (): Promise<RunResult> => ({
      code: -1,
      stdout: '',
      stderr: 'gh did not answer in time',
      failure: 'timeout',
    }),
  };
  const port = createGhCliGitHub(withCommandLog(runner, log, 'gh'));
  await port.findRepository('octo/space');

  const line = calls.find((call) => call.event === 'github-call');
  assert.ok(line);
  assert.equal(line?.fields.outcome, 'timeout');
});

test('withCommandLog of git-network logs no line for status and one for push', async () => {
  const { log, calls } = recordingLog();
  const runner: CommandRunner = {
    run: async (): Promise<RunResult> => ({ code: 0, stdout: '', stderr: '' }),
  };
  const wrapped = withCommandLog(runner, log, 'git-network');

  await wrapped.run('git', ['status']);
  assert.equal(
    calls.some((call) => call.event === 'git-network-call'),
    false,
  );

  await wrapped.run('git', ['push', 'origin', 'main']);
  const line = calls.find((call) => call.event === 'git-network-call');
  assert.ok(line);
  assert.equal(line?.fields.subcommand, 'push');
  assert.equal(typeof line?.fields.ms, 'number');
  assert.equal(line?.fields.outcome, 'ok');
});

test('withCommandLog with no log given returns the runner untouched', async () => {
  const runner: CommandRunner = {
    run: async (): Promise<RunResult> => ({ code: 0, stdout: 'x', stderr: '' }),
  };
  const wrapped = withCommandLog(runner, undefined, 'gh');
  assert.equal(wrapped, runner);
});
