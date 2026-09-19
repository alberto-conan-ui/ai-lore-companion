import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// `useXtermSession` is mocked as `machine-check.test.tsx` mocks it, so the command panel's own
// `spaceCommandRun` call and PTY id are exercised without a real terminal.
vi.mock('../../../src/renderer/src/components/useXtermSession.js', () => ({
  useXtermSession: (config: { spawn?: () => Promise<string | null> }) => {
    // biome-ignore lint/correctness/useExhaustiveDependencies: mounts once, like the real hook's spawn-on-mount effect.
    useEffect(() => {
      void config.spawn?.();
    }, []);
    return { hostRef: { current: null }, focus: () => {}, search: {} };
  },
}));

import { SetupScreen } from '../../../src/renderer/src/space/setup/SetupScreen.js';
import type {
  SetupReport,
  SetupStart,
  SpaceCommandCode,
  SpaceCommandExit,
  SpaceCommandRunResult,
  SpaceMachineCheckResult,
  SpaceSetupChooseFolderResult,
  SpaceSetupChooseSourceResult,
  SpaceSetupFailure,
  SpaceSetupListSpacesResult,
  SpaceSetupOwners,
  SpaceSetupPlanProgress,
  SpaceSetupPlanResult,
  SpaceSetupRunResult,
  SpaceSetupStateResult,
  SpaceSetupStopResult,
  SpaceSetupValidateResult,
  SpaceWindowResult,
  StepProgress,
} from '../../../src/shared/ipc.js';

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let progressListener: ((event: StepProgress) => void) | null = null;
let planProgressListener: ((event: SpaceSetupPlanProgress) => void) | null = null;
let commandExitListener: ((event: SpaceCommandExit) => void) | null = null;
let commandCodeListener: ((event: SpaceCommandCode) => void) | null = null;

const cockpit = {
  spaceSetupState: vi.fn<(arg: unknown) => Promise<SpaceSetupStateResult>>(),
  spaceSetupChooseFolder: vi.fn<(arg: unknown) => Promise<SpaceSetupChooseFolderResult>>(),
  spaceSetupChooseSource: vi.fn<(arg: unknown) => Promise<SpaceSetupChooseSourceResult>>(),
  spaceSetupListSpaces: vi.fn<(arg: unknown) => Promise<SpaceSetupListSpacesResult>>(),
  spaceSetupOpenExisting: vi.fn<(arg: unknown) => Promise<SpaceWindowResult>>(),
  spaceSetupValidate: vi.fn<(arg: unknown) => Promise<SpaceSetupValidateResult>>(),
  spaceSetupPlan: vi.fn<(arg: unknown) => Promise<SpaceSetupPlanResult>>(),
  spaceSetupRun: vi.fn<(arg: unknown) => Promise<SpaceSetupRunResult>>(),
  spaceSetupStop: vi.fn<(arg: unknown) => Promise<SpaceSetupStopResult>>(),
  spaceSetupOpenSpace: vi.fn<(arg: unknown) => Promise<SpaceWindowResult>>(),
  spaceMachineCheck: vi.fn<(arg: unknown) => Promise<SpaceMachineCheckResult>>(),
  spaceCommandRun: vi.fn<(arg: unknown) => Promise<SpaceCommandRunResult>>(),
  spaceNavigate: vi.fn<(arg: unknown) => Promise<SpaceWindowResult>>(),
  urlOpenExternal: vi.fn(),
  onSpaceSetupProgress: vi.fn((listener: (event: StepProgress) => void) => {
    progressListener = listener;
    return () => {
      progressListener = null;
    };
  }),
  onSpaceSetupPlanProgress: vi.fn((listener: (event: SpaceSetupPlanProgress) => void) => {
    planProgressListener = listener;
    return () => {
      planProgressListener = null;
    };
  }),
  onSpaceCommandExit: vi.fn((listener: (event: SpaceCommandExit) => void) => {
    commandExitListener = listener;
    return () => {
      commandExitListener = null;
    };
  }),
  onSpaceCommandCode: vi.fn((listener: (event: SpaceCommandCode) => void) => {
    commandCodeListener = listener;
    return () => {
      commandCodeListener = null;
    };
  }),
};

const PARENT = '/work/spaces';

const OWNERS: SpaceSetupOwners = { account: 'me', organisations: ['acme'], defaultOwner: 'me' };

function machineCheckResult(commands: Record<string, string>): SpaceMachineCheckResult {
  return {
    ok: true,
    value: {
      check: {
        requirements: [],
        engines: [],
        ready: true,
        github: { account: 'me', organisations: [] },
        tools: { brew: true, npm: true },
      },
      checkedAt: 0,
      pathSource: 'login-shell',
      spacesFolder: { value: PARENT, proposed: PARENT },
      setUp: { ready: true, left: [] },
      commands,
    },
  };
}

const PLAN: SpaceSetupPlanResult = {
  ok: true,
  value: {
    plan: {
      flow: 'create',
      spaceRoot: `${PARENT}/demo`,
      target: 'absent',
      complete: false,
      repository: null,
      project: null,
      alreadyDone: [],
      leftToDo: ['Create the Space repository', 'Create the Project'],
      steps: [
        { stepId: 'machine-check', title: 'Check the machine', done: true, lines: [] },
        {
          stepId: 'space-repository',
          title: 'Create the Space repository',
          done: false,
          lines: [{ what: 'Create the private repository on GitHub.', to: 'me/demo' }],
        },
        {
          stepId: 'project',
          title: 'Create the Project',
          done: false,
          lines: [{ what: 'Create the GitHub Project "demo" of me.' }],
        },
      ],
    },
    github: {
      owner: 'me',
      repository: 'me/demo',
      visibility: 'private',
      repositoryExists: false,
      repositoryUrl: null,
      project: 'demo',
      projectExists: false,
      projectUrl: null,
      labels: ['spec', 'plan'],
      views: ['Board'],
    },
    token: 'plan-token-1',
  },
};

function failure(kind: string, message: string, extra: Partial<SpaceSetupFailure> = {}) {
  return {
    ok: false as const,
    error: {
      kind,
      message,
      stepId: null,
      title: null,
      problems: [],
      byHand: [],
      viewSettings: [],
      ...extra,
    },
  };
}

function report(extra: Partial<SetupReport> = {}): SetupReport {
  return {
    flow: 'create',
    spaceRoot: `${PARENT}/demo`,
    completed: ['machine-check', 'space-repository', 'project'],
    skipped: [],
    repository: {
      id: '1',
      fullName: 'me/demo',
      url: 'https://github.com/me/demo',
      cloneUrl: '',
      private: true,
    },
    project: {
      id: '2',
      owner: 'me',
      number: 1,
      title: 'demo',
      url: 'https://github.com/me/demo/projects/1',
    },
    byHand: [],
    viewSettings: [],
    repositories: [],
    ...extra,
  };
}

function emit(
  stepId: string,
  index: number,
  state: StepProgress['state'],
  message: string | null = null,
): void {
  const title = PLAN.value.plan.steps[index]?.title ?? stepId;
  act(() => progressListener?.({ stepId, title, index, total: 3, state, message }));
}

function emitCheck(
  planId: number,
  checkId: SpaceSetupPlanProgress['checkId'],
  state: 'running' | 'done' | 'failed',
  text: string,
): void {
  act(() => planProgressListener?.({ planId, checkId, state, text }));
}

beforeEach(() => {
  progressListener = null;
  planProgressListener = null;
  commandExitListener = null;
  commandCodeListener = null;
  cockpit.spaceSetupState.mockReset().mockResolvedValue({
    ok: true,
    value: {
      flow: 'create',
      parentDir: PARENT,
      sourceDir: null,
      originUrl: null,
      source: null,
      owners: OWNERS,
      spacesFolder: PARENT,
      running: false,
      interrupted: null,
    },
  });
  cockpit.spaceSetupChooseFolder
    .mockReset()
    .mockResolvedValue({ ok: true, value: { parentDir: PARENT } });
  cockpit.spaceSetupChooseSource.mockReset();
  cockpit.spaceSetupListSpaces
    .mockReset()
    .mockResolvedValue({ ok: true, value: { repositories: [] } });
  cockpit.spaceSetupOpenExisting
    .mockReset()
    .mockResolvedValue({ ok: true, value: { mode: 'space' } });
  cockpit.spaceSetupValidate
    .mockReset()
    .mockResolvedValue({ ok: true, value: { problems: [], target: null } });
  cockpit.spaceSetupPlan.mockReset().mockResolvedValue(PLAN);
  cockpit.spaceSetupRun.mockReset();
  cockpit.spaceSetupStop.mockReset().mockResolvedValue({ ok: true, value: { stopping: true } });
  cockpit.spaceSetupOpenSpace.mockReset().mockResolvedValue({ ok: true, value: { mode: 'space' } });
  cockpit.spaceMachineCheck.mockReset().mockResolvedValue(
    machineCheckResult({
      'github-add-project-scope': 'gh auth refresh --hostname github.com --scopes project',
      'github-sign-in': 'gh auth login --hostname github.com --web',
    }),
  );
  cockpit.spaceCommandRun.mockReset().mockResolvedValue({ ok: true, value: { ptyId: 'pty-1' } });
  cockpit.spaceNavigate
    .mockReset()
    .mockResolvedValue({ ok: true, value: { mode: 'space-welcome' } });
  cockpit.urlOpenExternal.mockReset();
  cockpit.onSpaceSetupProgress.mockClear();
  cockpit.onSpaceSetupPlanProgress.mockClear();
  (window as unknown as { cockpit: unknown }).cockpit = cockpit;
});

afterEach(() => cleanup());

async function renderFlow(start: SetupStart = { kind: 'new' }): Promise<void> {
  render(<SetupScreen init={{ mode: 'setup', start }} />);
  await screen.findByTestId('setup-form');
}

function type(testId: string, value: string): void {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

async function fillAndPlan(): Promise<void> {
  await renderFlow();
  type('setup-field-name', 'demo');
  fireEvent.click(screen.getByTestId('setup-continue'));
  await screen.findByTestId('setup-plan');
}

test('no on-screen text names an internal field', async () => {
  await renderFlow();
  cockpit.spaceSetupValidate.mockResolvedValue({
    ok: true,
    value: {
      problems: [
        { field: 'name', message: 'bad' },
        { field: 'parentDir', message: 'also bad' },
      ],
      target: null,
    },
  });
  type('setup-field-name', 'x');
  await screen.findByTestId('setup-problem-name');
  const text = document.body.textContent ?? '';
  for (const banned of ['parentDir', 'folderName', 'sourceDir', 'repositoryName', 'github —']) {
    expect(text).not.toContain(banned);
  }
  expect(text).not.toContain('skipped');
});

test('the owner select lists the account then the organisations, with no text input', async () => {
  await renderFlow();
  const select = screen.getByTestId('setup-field-owner') as HTMLSelectElement;
  expect(select.tagName).toBe('SELECT');
  const options = within(select)
    .getAllByRole('option')
    .map((option) => option.textContent);
  expect(options).toEqual(['me (you)', 'acme']);
  expect(screen.queryByRole('textbox', { name: /owner/i })).toBeNull();
});

test('typing a name updates "What will be created", and the target state drives Continue', async () => {
  await renderFlow();
  cockpit.spaceSetupValidate.mockResolvedValue({
    ok: true,
    value: {
      problems: [],
      target: { spaceRoot: `${PARENT}/demo`, state: 'absent', message: null },
    },
  });
  type('setup-field-name', 'demo');
  await waitFor(() =>
    expect(screen.getByTestId('setup-will-create').textContent).toContain('a new folder.'),
  );
  expect(screen.getByTestId('setup-will-create').textContent).toContain(`${PARENT}/demo`);

  cockpit.spaceSetupValidate.mockResolvedValue({
    ok: true,
    value: {
      problems: [],
      target: { spaceRoot: `${PARENT}/demo`, state: 'complete', message: null },
    },
  });
  type('setup-field-name', 'demo2');
  await waitFor(() => expect(screen.getByTestId('setup-open-existing')).toBeTruthy());
  expect(screen.queryByTestId('setup-continue')).toBeNull();

  cockpit.spaceSetupValidate.mockResolvedValue({
    ok: true,
    value: {
      problems: [],
      target: { spaceRoot: `${PARENT}/demo`, state: 'incomplete', message: null },
    },
  });
  type('setup-field-name', 'demo3');
  await waitFor(() =>
    expect(screen.getByTestId('setup-continue').textContent).toBe('Finish setting it up'),
  );
  expect(screen.getByTestId('setup-open-existing')).toBeTruthy();

  cockpit.spaceSetupValidate.mockResolvedValue({
    ok: true,
    value: {
      problems: [],
      target: { spaceRoot: `${PARENT}/demo`, state: 'other-content', message: null },
    },
  });
  type('setup-field-name', 'demo4');
  await waitFor(() =>
    expect((screen.getByTestId('setup-continue') as HTMLButtonElement).disabled).toBe(true),
  );
});

test('the plan progress pushes render as a list, drop a stale planId, show the slow line, and Cancel returns to the form', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const plan = deferred<SpaceSetupPlanResult>();
    cockpit.spaceSetupPlan.mockReturnValue(plan.promise);
    await renderFlow();
    type('setup-field-name', 'demo');
    fireEvent.click(screen.getByTestId('setup-continue'));
    await vi.waitFor(() => expect(screen.getByTestId('setup-checking')).toBeTruthy());

    emitCheck(1, 'folder', 'done', `The folder ${PARENT}/demo does not exist yet`);
    emitCheck(1, 'repository', 'running', 'Looking for the repository me/demo on GitHub');
    expect(screen.getByTestId('setup-check-folder').textContent).toContain(
      'The folder /work/spaces/demo does not exist yet',
    );
    expect(screen.getByTestId('setup-check-repository').textContent).toContain(
      'Looking for the repository me/demo on GitHub',
    );

    // A push from an older plan is ignored.
    emitCheck(2, 'project', 'running', 'Looking for a Project named demo');
    emitCheck(1, 'project', 'done', 'stale, should be dropped');
    expect(screen.getByTestId('setup-check-project').textContent).toContain(
      'Looking for a Project named demo',
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(21_000);
    });
    expect(screen.getByTestId('setup-checking-slow')).toBeTruthy();

    fireEvent.click(screen.getByTestId('setup-check-cancel'));
    expect(screen.getByTestId('setup-form')).toBeTruthy();
    expect(screen.queryByTestId('setup-checking')).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

test('the confirmation has the question, three tagged rows, few lines, and the full plan only after "Show every step"', async () => {
  await fillAndPlan();
  expect(screen.getByTestId('setup-confirm-question').textContent).toBe('Create the Space demo?');
  await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('setup-confirm')));

  const folder = screen.getByTestId('setup-confirm-folder');
  expect(folder.textContent).toContain('New');
  const repository = screen.getByTestId('setup-confirm-repository');
  expect(repository.textContent).toContain('me/demo');
  expect(repository.textContent).toContain('New');
  const project = screen.getByTestId('setup-confirm-project');
  expect(project.textContent).toContain('demo');
  expect(project.textContent).toContain('New');

  // The "New" tag is a compact inline pill, not a full-width block: it must
  // size to its text regardless of the row's column-flex layout.
  for (const row of [folder, repository, project]) {
    const tag = row.querySelector('span:last-child') as HTMLElement;
    expect(tag.textContent).toBe('New');
    expect(tag.style.display).toBe('inline-block');
    expect(tag.style.alignSelf).toBe('flex-start');
  }

  expect(screen.queryByTestId('setup-plan-steps')).toBeNull();
  const section = screen.getByTestId('setup-plan');
  const before = Array.from(
    section.querySelectorAll('h2, p, [data-testid^="setup-confirm-"]'),
  ).filter((el) => el.closest('[data-testid="setup-show-every-step-content"]') === null);
  expect(before.length).toBeLessThanOrEqual(8);

  fireEvent.click(screen.getByTestId('setup-show-every-step'));
  expect(screen.getByTestId('setup-plan-steps')).toBeTruthy();
});

test('the plan answering complete: true shows the Space already exists and is complete', async () => {
  cockpit.spaceSetupPlan.mockResolvedValue({
    ok: true,
    value: {
      ...PLAN.value,
      plan: { ...PLAN.value.plan, complete: true, target: 'half-made' },
    },
  });
  await renderFlow();
  type('setup-field-name', 'demo');
  fireEvent.click(screen.getByTestId('setup-continue'));
  const complete = await screen.findByTestId('setup-complete');
  expect(complete.textContent).toContain('already exists and is complete');
  fireEvent.click(screen.getByTestId('setup-open-space'));
  await waitFor(() => expect(cockpit.spaceSetupOpenSpace).toHaveBeenCalledWith({}));
});

test('the run shows "Already done" for a skipped step, marked with the internal state', async () => {
  const run = deferred<SpaceSetupRunResult>();
  cockpit.spaceSetupRun.mockReturnValueOnce(run.promise);
  await fillAndPlan();
  fireEvent.click(screen.getByTestId('setup-confirm'));
  await screen.findByTestId('setup-running');
  emit('machine-check', 0, 'skipped');
  expect(screen.getByTestId('setup-step-machine-check').dataset.state).toBe('skipped');
  expect(screen.getByTestId('setup-step-state-machine-check').textContent).toContain(
    'Already done',
  );
  await act(async () => run.resolve({ ok: true, value: report() }));
});

test('the finished screen opens with "The Space demo is ready.", focuses Open the Space, and each view setting opens its link', async () => {
  const run = deferred<SpaceSetupRunResult>();
  cockpit.spaceSetupRun.mockReturnValueOnce(run.promise);
  await fillAndPlan();
  fireEvent.click(screen.getByTestId('setup-confirm'));
  await screen.findByTestId('setup-running');
  await act(async () =>
    run.resolve({
      ok: true,
      value: report({
        viewSettings: [
          {
            view: 'Board',
            setting: 'Column by Stage',
            url: 'https://github.com/me/demo/projects/1/views/1',
          },
        ],
      }),
    }),
  );
  const finished = await screen.findByTestId('setup-finished');
  expect(finished.textContent).toContain('The Space demo is ready.');
  await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('setup-open-space')));

  fireEvent.click(screen.getByTestId('setup-by-hand-open-0'));
  expect(cockpit.urlOpenExternal).toHaveBeenCalledWith(
    'https://github.com/me/demo/projects/1/views/1',
  );
});

test('a failure of kind github-missing-scope offers "Fix and run again", mounts the command panel, and an exit 0 asks for the plan again', async () => {
  const run = deferred<SpaceSetupRunResult>();
  cockpit.spaceSetupRun.mockReturnValueOnce(run.promise);
  await fillAndPlan();
  fireEvent.click(screen.getByTestId('setup-confirm'));
  await screen.findByTestId('setup-running');
  await act(async () =>
    run.resolve(
      failure('github-missing-scope', 'GitHub Projects need one more permission.', {
        stepId: 'project',
        title: 'Create the Project',
      }),
    ),
  );
  await screen.findByTestId('setup-failed');
  const fixButton = screen.getByTestId('setup-fix-and-run-again');
  expect(fixButton.textContent).toBe('Fix and run again');
  fireEvent.click(fixButton);
  const panel = await screen.findByTestId('command-panel-command');
  expect(panel.textContent).toContain('gh auth refresh --hostname github.com --scopes project');

  cockpit.spaceSetupPlan.mockClear();
  act(() => commandExitListener?.({ ptyId: 'pty-1', exitCode: 0 }));
  await waitFor(() => expect(cockpit.spaceSetupPlan).toHaveBeenCalled());
});

test('"Space from a repository on this computer": Choose… fills the source, defaults the name, and says the folder is not changed', async () => {
  cockpit.spaceSetupChooseSource.mockResolvedValue({
    ok: true,
    value: {
      sourceDir: '/work/app',
      originUrl: 'https://github.com/me/app',
      github: 'me/app',
      name: 'app',
    },
  });
  await renderFlow({ kind: 'from-repository' });
  fireEvent.click(screen.getByTestId('setup-choose-source'));
  await waitFor(() => expect(cockpit.spaceSetupChooseSource).toHaveBeenCalledWith({}));
  await waitFor(() =>
    expect((screen.getByTestId('setup-field-name') as HTMLInputElement).value).toBe('app-space'),
  );
  expect(screen.getByTestId('setup-source').textContent).toContain('This folder is not changed.');
});
