import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SpaceSurface } from '../../../src/renderer/src/space/SpaceSurface.js';
import type {
  LegacySummary,
  MigrationIssueProgress,
  MigrationPlan,
  MigrationReport,
  SpaceMigrationChooseFolderResult,
  SpaceMigrationFailure,
  SpaceMigrationPlanResult,
  SpaceMigrationRunResult,
  SpaceMigrationStateResult,
  SpaceMigrationStopResult,
  SpaceWindowResult,
  StepProgress,
} from '../../../src/shared/ipc.js';

// The migration screen (M6.5) against a mocked bridge: the older-than-v0.8 state, the source,
// the fields, the plan, the explicit confirmation bound to the plan's token, the progress per
// step and per issue, a failed step with "Run again", stop, an interrupted run, and the end.

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let stepListener: ((event: StepProgress) => void) | null = null;
let issueListener: ((event: MigrationIssueProgress) => void) | null = null;

const cockpit = {
  spaceMigrationState: vi.fn<(arg: unknown) => Promise<SpaceMigrationStateResult>>(),
  spaceMigrationChooseFolder: vi.fn<(arg: unknown) => Promise<SpaceMigrationChooseFolderResult>>(),
  spaceMigrationPlan: vi.fn<(arg: unknown) => Promise<SpaceMigrationPlanResult>>(),
  spaceMigrationRun: vi.fn<(arg: unknown) => Promise<SpaceMigrationRunResult>>(),
  spaceMigrationStop: vi.fn<(arg: unknown) => Promise<SpaceMigrationStopResult>>(),
  spaceMigrationOpenSpace: vi.fn<(arg: unknown) => Promise<SpaceWindowResult>>(),
  spaceOpenInCockpit: vi.fn<(arg: unknown) => Promise<SpaceWindowResult>>(),
  onSpaceMigrationProgress: vi.fn((listener: (event: StepProgress) => void) => {
    stepListener = listener;
    return () => {
      stepListener = null;
    };
  }),
  onSpaceMigrationIssueProgress: vi.fn((listener: (event: MigrationIssueProgress) => void) => {
    issueListener = listener;
    return () => {
      issueListener = null;
    };
  }),
  // Every screen is now shown beside `<SpaceSettings />` (M9.10), which listens for it.
  onSettingsOpen: vi.fn(() => () => {}),
};

const FOLDER = '/work/old-project';

function legacy(extra: Partial<LegacySummary> = {}): LegacySummary {
  return {
    projectName: 'old-project',
    lorePath: `${FOLDER}/.ai-lore-old-project`,
    coreVersion: '0.8',
    manifestLocation: 'memory-folder',
    migratable: true,
    versionStanding: 'v0.8',
    reason: 'This is the AI-Lore project old-project. It can be migrated.',
    ...extra,
  };
}

function renderScreen(extra: Partial<LegacySummary> = {}): void {
  render(<SpaceSurface init={{ mode: 'migration', folder: FOLDER, legacy: legacy(extra) }} />);
}

function repository(path: string, extra: Partial<MigrationPlan['source']['payloadRepository']>) {
  return {
    path,
    present: true,
    originUrl: `https://github.com/me/${path === '.' ? 'old-project' : 'old-project-lore'}.git`,
    branch: 'main',
    head: '0123456789abcdef0123',
    hasUncommittedChanges: false,
    changedCount: 0,
    ...extra,
  };
}

function field(
  id: MigrationPlan['fields'][number]['id'],
  value: string,
  extra: Partial<MigrationPlan['fields'][number]> = {},
): MigrationPlan['fields'][number] {
  return {
    id,
    label: `label of ${id}`,
    value,
    proposed: true,
    options: [],
    suggestions: [],
    problem: null,
    ...extra,
  };
}

function plan(extra: Partial<MigrationPlan> = {}): MigrationPlan {
  return {
    source: {
      root: FOLDER,
      projectName: 'old-project',
      coreVersion: '0.8',
      loreFolder: '.ai-lore-old-project',
      payloadRepository: repository('.', { hasUncommittedChanges: true, changedCount: 2 }),
      loreRepository: repository('.ai-lore-old-project/memory', {}),
      complete: true,
    },
    spaceRoot: '/work/old-project-space',
    repository: 'me/old-project-space',
    target: 'absent',
    fields: [
      field('parentDir', '/work'),
      field('name', 'old-project-space'),
      field('owner', 'me'),
      field('description', '', {
        proposed: false,
        suggestions: ['A companion for AI-Lore.'],
      }),
      field('focusStage', 'Build', { options: ['Spec', 'Plan', 'Build', 'Review', 'Done'] }),
      field('payloadGitHub', 'me/old-project'),
    ],
    steps: [
      {
        stepId: 'record-source',
        number: 1,
        title: 'Record the source',
        done: false,
        lines: [{ what: 'Record the head of both repositories.' }],
      },
      {
        stepId: 'issues',
        number: 11,
        title: 'Create the issues',
        done: false,
        lines: [{ what: 'Create 2 issues.', count: 2 }],
      },
      {
        stepId: 'verify',
        number: 13,
        title: 'Verify the migration',
        done: false,
        lines: [{ what: "Compare every archived file's SHA-256 with its source's." }],
      },
    ],
    mapping: [
      {
        id: 'archive',
        source: 'The whole memory/ tree and references/',
        destination: 'publish/archive/v0.8/',
        count: 120,
        items: [],
      },
      {
        id: 'backlog',
        source: 'Backlog items',
        destination: 'Standalone issues in me/old-project-space',
        count: 1,
        items: [{ from: '.ai-lore-old-project/memory/status/backlog/a.md', to: 'issue' }],
      },
    ],
    notCarried: [{ what: 'Other notes', count: 3, paths: ['a', 'b', 'c'] }],
    issues: [
      {
        kind: 'focus',
        title: 'The in-progress focus',
        labels: [],
        key: 'k1',
        marker: 'm1',
        archived: 'publish/archive/v0.8/x',
        parentKey: null,
        stage: 'Build',
      },
      {
        kind: 'backlog',
        title: 'A backlog item',
        labels: [],
        key: 'k2',
        marker: 'm2',
        archived: 'publish/archive/v0.8/y',
        parentKey: null,
        stage: null,
      },
    ],
    warnings: [
      {
        kind: 'uncommitted-changes',
        message: 'The payload repository has 2 uncommitted changes. They are not carried.',
        paths: ['README.md'],
      },
    ],
    refusals: [],
    ready: true,
    ...extra,
  };
}

const READY: SpaceMigrationPlanResult = { ok: true, value: { plan: plan(), token: 'token-1' } };

function failure(kind: string, message: string, extra: Partial<SpaceMigrationFailure> = {}) {
  return {
    ok: false as const,
    error: { kind, message, stepId: null, refusal: null, problems: [], ...extra },
  };
}

const REPORT: MigrationReport = {
  spaceRoot: '/work/old-project-space',
  repository: 'me/old-project-space',
  completed: ['record-source', 'issues', 'verify'],
  skipped: [],
};

function emit(
  stepId: string,
  index: number,
  state: StepProgress['state'],
  message: string | null = null,
) {
  act(() => stepListener?.({ stepId, title: stepId, index, total: 13, state, message }));
}

beforeEach(() => {
  stepListener = null;
  issueListener = null;
  cockpit.spaceMigrationState.mockReset().mockResolvedValue({
    ok: true,
    value: {
      sourceRoot: FOLDER,
      parentDir: null,
      running: false,
      runningElsewhere: false,
      interrupted: null,
    },
  });
  cockpit.spaceMigrationChooseFolder
    .mockReset()
    .mockResolvedValue({ ok: true, value: { parentDir: '/elsewhere' } });
  cockpit.spaceMigrationPlan.mockReset().mockResolvedValue(READY);
  cockpit.spaceMigrationRun.mockReset();
  cockpit.spaceMigrationStop.mockReset().mockResolvedValue({ ok: true, value: { stopping: true } });
  cockpit.spaceMigrationOpenSpace
    .mockReset()
    .mockResolvedValue({ ok: true, value: { mode: 'space' } });
  cockpit.spaceOpenInCockpit
    .mockReset()
    .mockResolvedValue({ ok: true, value: { mode: 'cockpit' } });
  (window as unknown as { cockpit: unknown }).cockpit = cockpit;
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => cleanup());

async function planShown(): Promise<void> {
  renderScreen();
  await screen.findByTestId('migration-mapping');
}

test('older than v0.8: one literal sentence to upgrade to v0.8 first, and nothing else offered', () => {
  renderScreen({ coreVersion: '0.7', migratable: false, versionStanding: 'older' });
  expect(screen.getByTestId('migration-upgrade-first').textContent).toBe(
    'old-project is an AI-Lore project of core version 0.7. The companion migrates AI-Lore v0.8 projects only. Upgrade this project to v0.8 first, with AI-Lore v0.8, then open this folder again.',
  );
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(cockpit.spaceMigrationState).not.toHaveBeenCalled();
  expect(cockpit.spaceMigrationPlan).not.toHaveBeenCalled();
});

test('a legacy project that is not migratable for another reason shows the reason and Open in the v0.8 cockpit, which sends no path', async () => {
  renderScreen({ coreVersion: '0.9', migratable: false, versionStanding: 'newer', reason: 'Why.' });
  expect(screen.getByTestId('migration-reason').textContent).toBe('Why.');
  const button = screen.getByTestId('migration-open-in-cockpit');
  expect(button.textContent).toBe('Open in the v0.8 cockpit');
  fireEvent.click(button);
  await waitFor(() => expect(cockpit.spaceOpenInCockpit).toHaveBeenCalledWith({}));
  expect(cockpit.spaceMigrationPlan).not.toHaveBeenCalled();
});

test('error state: a refused Open in the v0.8 cockpit shows the message', async () => {
  cockpit.spaceOpenInCockpit.mockResolvedValue({
    ok: false,
    error: { kind: 'not-allowed-here', message: 'Not from this screen.' },
  });
  await planShown();
  fireEvent.click(screen.getByTestId('migration-open-in-cockpit'));
  const error = await screen.findByTestId('migration-open-in-cockpit-error');
  expect(error.textContent).toBe('Not from this screen.');
});

test('the plan is asked on opening with no folder and shows the source, the fields, the mapping, the archive-only kinds, the issues and the warnings', async () => {
  await planShown();
  expect(cockpit.spaceMigrationPlan).toHaveBeenCalledWith({ private: true });
  expect(screen.getByTestId('migration-source-name').textContent).toBe('old-project');
  expect(screen.getByTestId('migration-source-version').textContent).toBe('0.8');
  expect(screen.getByTestId('migration-source-payloadRepository-state').textContent).toBe(
    '2 uncommitted changes',
  );
  expect(screen.getByTestId('migration-source-loreRepository-state').textContent).toBe(
    'no uncommitted changes',
  );
  expect(
    within(screen.getByTestId('migration-source-payloadRepository')).getByText(
      'https://github.com/me/old-project.git',
    ),
  ).toBeTruthy();
  expect(screen.getByTestId('migration-source-unchanged').textContent).toContain(
    'The v0.8 folder and both its repositories, the payload repository and the Lore repository, are left exactly as they were.',
  );

  expect((screen.getByTestId('migration-field-name') as HTMLInputElement).value).toBe(
    'old-project-space',
  );
  expect(screen.getByLabelText(/^name — label of name/)).toBeTruthy();
  expect((screen.getByTestId('migration-field-owner') as HTMLInputElement).value).toBe('me');
  expect((screen.getByTestId('migration-field-focusStage') as HTMLSelectElement).value).toBe(
    'Build',
  );
  expect((screen.getByTestId('migration-field-private') as HTMLInputElement).checked).toBe(true);
  expect(screen.getByTestId('migration-parent-dir').textContent).toBe('/work');

  expect(screen.getByTestId('migration-mapping-count-archive').textContent).toBe('120');
  expect(screen.getByTestId('migration-mapping-backlog').textContent).toContain(
    'Standalone issues in me/old-project-space',
  );
  expect(screen.getByTestId('migration-not-carried').textContent).toContain('Other notes: 3');
  expect(screen.getByTestId('migration-issues-count').textContent).toBe(
    '2 issues will be created.',
  );
  expect(screen.getByTestId('migration-issues').textContent).toContain('A backlog item');
  expect(screen.getByTestId('migration-warning-uncommitted-changes').textContent).toContain(
    'The payload repository has 2 uncommitted changes.',
  );
  expect(screen.getByTestId('migration-plan-root').textContent).toBe('/work/old-project-space');
  expect(screen.getByTestId('migration-confirm-sentence').textContent).toBe(
    'Confirming creates on GitHub the private repository me/old-project-space, its Project, and 2 issues, which others with access can see.',
  );
  expect((screen.getByTestId('migration-confirm') as HTMLButtonElement).disabled).toBe(false);
  expect(cockpit.spaceMigrationRun).not.toHaveBeenCalled();
});

test('a changed field disables the confirmation until the plan is made again, and the plan request carries no folder', async () => {
  await planShown();
  fireEvent.change(screen.getByTestId('migration-field-description'), {
    target: { value: 'What it is about.' },
  });
  fireEvent.click(screen.getByTestId('migration-field-private'));
  expect(screen.getByTestId('migration-plan-changed')).toBeTruthy();
  expect((screen.getByTestId('migration-confirm') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByTestId('migration-make-plan'));
  await waitFor(() => expect(cockpit.spaceMigrationPlan).toHaveBeenCalledTimes(2));
  const sent = cockpit.spaceMigrationPlan.mock.calls[1]?.[0];
  expect(sent).toEqual({
    private: false,
    name: 'old-project-space',
    owner: 'me',
    description: 'What it is about.',
    payloadGitHub: 'me/old-project',
    focusStage: 'Build',
  });
  await waitFor(() => expect(screen.queryByTestId('migration-plan-changed')).toBeNull());
});

test('the folder comes from main’s dialog, and a description suggestion can be taken', async () => {
  await planShown();
  fireEvent.click(screen.getByTestId('migration-field-parentDir'));
  await waitFor(() =>
    expect(screen.getByTestId('migration-parent-dir').textContent).toBe('/elsewhere'),
  );
  expect(cockpit.spaceMigrationChooseFolder).toHaveBeenCalledWith({});
  expect((screen.getByTestId('migration-confirm') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('Use this text'));
  expect((screen.getByTestId('migration-field-description') as HTMLTextAreaElement).value).toBe(
    'A companion for AI-Lore.',
  );
});

test('a refused plan shows its refusal and the problems of its fields, and offers no confirmation', async () => {
  cockpit.spaceMigrationPlan.mockResolvedValue({
    ok: true,
    value: {
      plan: plan({
        ready: false,
        refusals: [{ kind: 'repository-taken', message: 'me/old-project-space is taken.' }],
        fields: [field('owner', '', { problem: 'The owner is missing.' })],
      }),
      token: null,
    },
  });
  await planShown();
  expect(screen.getByTestId('migration-refusal-repository-taken').textContent).toBe(
    'repository-taken: me/old-project-space is taken.',
  );
  expect(screen.getByTestId('migration-problem-owner').textContent).toBe('The owner is missing.');
  expect(screen.getByTestId('migration-field-owner').getAttribute('aria-invalid')).toBe('true');
  expect((screen.getByTestId('migration-confirm') as HTMLButtonElement).disabled).toBe(true);
});

test('a plan that could not be made shows core’s sentence', async () => {
  cockpit.spaceMigrationPlan.mockResolvedValue(
    failure('read-failed', 'The Lore folder could not be read.'),
  );
  renderScreen();
  const error = await screen.findByTestId('migration-plan-error');
  expect(error.textContent).toContain('The Lore folder could not be read.');
  expect(screen.queryByTestId('migration-confirm')).toBeNull();
});

test('confirm runs the plan by its token; progress per step and per issue; the end shows the verification and opens the Space', async () => {
  const running = deferred<SpaceMigrationRunResult>();
  cockpit.spaceMigrationRun.mockReturnValue(running.promise);
  await planShown();
  fireEvent.click(screen.getByTestId('migration-confirm'));
  await screen.findByTestId('migration-progress');
  expect(cockpit.spaceMigrationRun).toHaveBeenCalledWith({ token: 'token-1' });
  emit('record-source', 0, 'running');
  expect(screen.getByTestId('migration-status').textContent).toBe(
    'Running: 1. Record the source — running.',
  );
  emit('record-source', 0, 'done');
  emit('issues', 10, 'running');
  act(() =>
    issueListener?.({
      key: 'k1',
      kind: 'focus',
      title: 'The in-progress focus',
      index: 0,
      total: 2,
      state: 'completed',
      issue: { repository: 'me/old-project-space', number: 1, url: 'u' },
      message: 'Done.',
    }),
  );
  act(() =>
    issueListener?.({
      key: 'k2',
      kind: 'backlog',
      title: 'A backlog item',
      index: 1,
      total: 2,
      state: 'waiting',
      issue: null,
      message: 'GitHub asked for a pause of 60 seconds.',
    }),
  );
  expect(screen.getByTestId('migration-issue-count').textContent).toBe('1 of 2 issues');
  expect(screen.getByTestId('migration-issue-0').textContent).toContain('me/old-project-space#1');
  expect(screen.getByTestId('migration-issue-1').textContent).toContain(
    'GitHub asked for a pause of 60 seconds.',
  );
  fireEvent.click(screen.getByTestId('migration-stop'));
  await waitFor(() => expect(cockpit.spaceMigrationStop).toHaveBeenCalledWith({}));
  await waitFor(() =>
    expect(screen.getByTestId('migration-stop').textContent).toBe('Stopping after this step…'),
  );
  await act(async () => running.resolve({ ok: true, value: REPORT }));
  const verification = await screen.findByTestId('migration-verification');
  expect(verification.dataset.passed).toBe('true');
  expect(verification.textContent).toContain("Compare every archived file's SHA-256");
  const prompt = screen.getByTestId('migration-follow-up-prompt');
  expect(prompt.textContent).toBe(
    'In /work/old-project-space, read workbench/migration-follow-up.md and do what it says.',
  );
  expect(screen.getByTestId('migration-follow-up-path').textContent).toContain(
    'workbench/migration-follow-up.md',
  );
  fireEvent.click(screen.getByTestId('migration-follow-up-copy'));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
    'In /work/old-project-space, read workbench/migration-follow-up.md and do what it says.',
  );
  expect(await screen.findByText('Copied.')).toBeTruthy();
  fireEvent.click(screen.getByTestId('migration-open-space'));
  await waitFor(() => expect(cockpit.spaceMigrationOpenSpace).toHaveBeenCalledWith({}));
});

test('a failed step shows its sentence, and Run again runs the same plan again', async () => {
  cockpit.spaceMigrationRun
    .mockResolvedValueOnce(
      failure('push-failed', 'The push was refused by GitHub.', { stepId: 'record-source' }),
    )
    .mockResolvedValueOnce({ ok: true, value: REPORT });
  await planShown();
  fireEvent.click(screen.getByTestId('migration-confirm'));
  emit('record-source', 0, 'failed', 'The push was refused by GitHub.');
  const error = await screen.findByTestId('migration-run-error');
  expect(error.textContent).toContain('Failed at: 1. Record the source');
  expect(error.textContent).toContain('The push was refused by GitHub.');
  fireEvent.click(screen.getByTestId('migration-run-again'));
  await screen.findByTestId('migration-finished');
  expect(cockpit.spaceMigrationRun).toHaveBeenCalledTimes(2);
  expect(cockpit.spaceMigrationRun.mock.calls[1]?.[0]).toEqual({ token: 'token-1' });
});

test('a run refused as not planned goes back to the plan with main’s sentence', async () => {
  cockpit.spaceMigrationRun.mockResolvedValue(failure('not-planned', 'Nothing was run.'));
  await planShown();
  fireEvent.click(screen.getByTestId('migration-confirm'));
  expect((await screen.findByTestId('migration-error')).textContent).toBe('Nothing was run.');
  expect(screen.getByTestId('migration-mapping')).toBeTruthy();
});

test('a run interrupted by a closed window is recognised when the folder is opened again', async () => {
  cockpit.spaceMigrationState.mockResolvedValue({
    ok: true,
    value: {
      sourceRoot: FOLDER,
      parentDir: '/work',
      running: false,
      runningElsewhere: false,
      interrupted: { spaceRoot: '/work/old-project-space', stepId: 'issues' },
    },
  });
  const halfMade = plan({ target: 'half-made' });
  const [first] = halfMade.steps;
  if (first !== undefined) first.done = true;
  cockpit.spaceMigrationPlan.mockResolvedValue({
    ok: true,
    value: { plan: halfMade, token: 'token-2' },
  });
  await planShown();
  expect(screen.getByTestId('migration-interrupted').textContent).toContain(
    '/work/old-project-space',
  );
  const target = screen.getByTestId('migration-plan-target').textContent ?? '';
  expect(target).toContain('The folder holds this migration from an earlier run.');
  expect(target).toContain('An earlier run did part of this migration');
  expect(target).not.toContain('Nothing has been done yet.');
  expect(screen.getByTestId('migration-plan-step-record-source').textContent).toContain(
    'Already done',
  );
});

test('a run that ends without step 13 says the verification was not run', async () => {
  cockpit.spaceMigrationRun.mockResolvedValue({
    ok: true,
    value: { ...REPORT, completed: ['record-source', 'issues'] },
  });
  await planShown();
  fireEvent.click(screen.getByTestId('migration-confirm'));
  const verification = await screen.findByTestId('migration-verification');
  expect(verification.dataset.passed).toBe('false');
  expect(verification.textContent).toContain('The verification was not run.');
  expect(verification.textContent).not.toContain('passed');
  expect(screen.queryByTestId('migration-follow-up')).toBeNull();
});
