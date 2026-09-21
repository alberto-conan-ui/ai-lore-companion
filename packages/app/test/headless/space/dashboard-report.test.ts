import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { DEFAULT_STAGES } from '@ai-lore-companion/core';
import {
  type FakeGitHub,
  type SpaceFixture,
  createFakeGitHub,
  makeSpaceFixture,
} from '@ai-lore-companion/core/testing';
import type { SpaceContext } from '../../../src/main/space/context.js';
import { createDashboardReportService } from '../../../src/main/space/dashboard-report.js';
import { spaceDashboardReport } from '../../../src/main/space/dashboard-report.js';
import { spaceGitHub } from '../../../src/main/space/github-service.js';
import { registerSpaceDashboardReport } from '../../../src/main/space/ipc/dashboard-report.js';
import {
  configureProjectRefresh,
  spaceProjectRefresh,
} from '../../../src/main/space/project-refresh.js';
import {
  type DashboardReportResult,
  SPACE_DASHBOARD_REPORT_CONTRACT,
} from '../../../src/shared/ipc/space/dashboard-report.contract.js';
import type {
  DashboardPmComponentValue,
  DashboardReportState,
} from '../../../src/shared/ipc/space/dashboard-report.types.js';
import {
  type FakeSpaceWindow,
  LORE_TEMPLATE_DIR,
  type SpaceHarness,
  spaceHarnessFor,
} from './space-harness.js';

async function typedInput(
  service: ReturnType<typeof createDashboardReportService>,
  text = 'A',
): Promise<{
  definitionHash: string;
  components: DashboardPmComponentValue[];
  basis: string;
}> {
  await service.ready();
  const resolved = service.definition();
  assert.ok(resolved);
  return {
    definitionHash: resolved.hash,
    components: resolved.definition.components
      .filter((component) => component.source === 'pm')
      .map((component) => {
        if (component.type === 'text') return { id: component.id, type: 'text', text };
        if (component.type === 'metric') return { id: component.id, type: 'metric', value: text };
        return { id: component.id, type: 'list', items: [] };
      }),
    basis: 'headless test',
  };
}

test('dashboard reports stay in their Space and a closed source becomes stale', async () => {
  let tick = 0;
  const a = createDashboardReportService({
    definition: { spaceRoot: process.cwd(), templateDir: LORE_TEMPLATE_DIR },
    now: () => new Date(`2026-09-20T00:00:0${tick++}.000Z`),
  });
  const b = createDashboardReportService({
    definition: { spaceRoot: process.cwd(), templateDir: LORE_TEMPLATE_DIR },
  });
  const input = await typedInput(a);
  a.openSession('pm-a');
  b.openSession('pm-b');
  assert.ok(a.publish('pm-a', input).ok);
  assert.equal(b.read().report, null);
  assert.equal(a.read().report?.stale, false);

  a.markProjectChanged();
  assert.equal(a.read().report?.staleReason, 'project-changed');
  const oldGeneration = a.publish('pm-a', input);
  assert.equal(oldGeneration.ok, false);
  if (!oldGeneration.ok) assert.equal(oldGeneration.error.kind, 'request-mismatch');
  assert.ok(a.readContextForSession('pm-a'));
  assert.ok(a.publish('pm-a', await typedInput(a, 'A again')).ok);
  a.closeSession('pm-a');
  assert.equal(a.read().report?.staleReason, 'session-ended');
  const late = a.publish('pm-a', input);
  assert.equal(late.ok, false);
  if (!late.ok) assert.equal(late.error.kind, 'session-ended');
});

const OWNER = 'fake-human';
const NAME = 'dashboard-report-space';

type Opened = {
  window: FakeSpaceWindow;
  context: SpaceContext;
};

let space: SpaceFixture;
let other: SpaceFixture;
let harness: SpaceHarness;
let fake: FakeGitHub;

before(async () => {
  space = await makeSpaceFixture({
    templateDir: LORE_TEMPLATE_DIR,
    name: NAME,
    owner: OWNER,
    project: 1,
  });
  other = await makeSpaceFixture({
    templateDir: LORE_TEMPLATE_DIR,
    name: 'other-dashboard-report-space',
    owner: OWNER,
    project: 2,
  });
});

after(async () => {
  await space.cleanup();
  await other.cleanup();
});

beforeEach(() => {
  configureProjectRefresh({ intervalMs: 0 });
  harness = spaceHarnessFor(registerSpaceDashboardReport);
  fake = createFakeGitHub();
});

afterEach(async () => {
  for (const window of harness.space.created) await harness.space.host.windowClosed(window.id);
  harness.cleanup();
  configureProjectRefresh(null);
  await fake.dispose();
});

async function open(root: string): Promise<Opened> {
  await harness.space.host.openFolder(undefined, root);
  const window = harness.space.created.at(-1);
  assert.ok(window);
  const context = harness.space.host.contextFor({ sender: { id: window.webContents.id } });
  assert.ok(context);
  return { window, context };
}

async function installProject(): Promise<void> {
  assert.ok((await fake.createRepository({ owner: OWNER, name: NAME, private: true })).ok);
  const made = await fake.createProject({ owner: OWNER, title: NAME });
  assert.ok(made.ok);
  assert.ok(
    (
      await fake.ensureSingleSelectField({
        project: made.value,
        name: 'Stage',
        options: [...DEFAULT_STAGES],
      })
    ).ok,
  );
}

async function read(opened: Opened, arg: unknown = {}): Promise<DashboardReportResult> {
  return (await harness.invoke(
    'spaceDashboardReport',
    opened.window,
    arg,
  )) as DashboardReportResult;
}

function pushes(window: FakeSpaceWindow): DashboardReportState[] {
  return window.sent
    .filter(
      (message) =>
        message.channel === SPACE_DASHBOARD_REPORT_CONTRACT.onSpaceDashboardReport.channel,
    )
    .map((message) => message.payload as DashboardReportState);
}

test('IPC reads and pushes reports only to their own Space, once per subscribed Space', async () => {
  const a = await open(space.root);
  const b = await open(other.root);
  assert.ok((await read(a)).ok);
  assert.ok((await read(a)).ok, 'a repeat read does not add a second subscriber');
  assert.ok((await read(b)).ok);

  const reports = a.context.service(spaceDashboardReport);
  reports.openSession('pm-a');
  assert.ok(reports.publish('pm-a', await typedInput(reports, '# A')).ok);

  assert.equal(pushes(a.window).length, 1);
  assert.deepEqual(pushes(a.window)[0]?.report?.sessionId, 'pm-a');
  assert.equal(pushes(b.window).length, 0);
  const otherRead = await read(b);
  assert.ok(otherRead.ok);
  assert.equal(otherRead.value.report, null);
});

test('IPC refuses malformed input and calls outside a Space window', async () => {
  const opened = await open(space.root);
  const malformed = await read(opened, { extra: true });
  assert.equal(malformed.ok, false);
  assert.equal(!malformed.ok && malformed.error.kind, 'invalid-argument');

  const outsider = (await harness.invoke(
    'spaceDashboardReport',
    { webContentsId: 987654 },
    {},
  )) as {
    ok: boolean;
    error?: { kind: string };
  };
  assert.equal(outsider.ok, false);
  assert.equal(outsider.error?.kind, 'not-a-space-window');
});

test('a Project refresh stales a reported summary and pushes the transition once', async () => {
  await installProject();
  const opened = await open(space.root);
  opened.context.service(spaceGitHub).use(fake);
  assert.ok((await read(opened)).ok);

  const reports = opened.context.service(spaceDashboardReport);
  reports.openSession('pm-refresh');
  assert.ok(
    reports.publish('pm-refresh', await typedInput(reports, 'The Project needs review.')).ok,
  );
  assert.equal(reports.read().report?.stale, false);
  const before = pushes(opened.window).length;

  await opened.context.service(spaceProjectRefresh).refresh();
  const after = reports.read().report;
  assert.ok(after);
  assert.equal(after.stale, true);
  assert.equal(after.staleReason, 'project-changed');
  assert.equal(pushes(opened.window).length, before + 1);
});

test('a Project refresh stales a report published before the Dashboard reads it', async () => {
  await installProject();
  const opened = await open(space.root);
  opened.context.service(spaceGitHub).use(fake);

  const reports = opened.context.service(spaceDashboardReport);
  reports.openSession('pm-before-read');
  assert.ok(
    reports.publish('pm-before-read', await typedInput(reports, 'A report before the first read.'))
      .ok,
  );

  await opened.context.service(spaceProjectRefresh).refresh();

  const result = await read(opened);
  assert.ok(result.ok);
  assert.equal(result.value.report?.stale, true);
  assert.equal(result.value.report?.staleReason, 'project-changed');
  assert.equal(pushes(opened.window).length, 0, 'the first read returns the already-stale report');
});
