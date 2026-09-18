import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SetupScreen } from '../../../src/renderer/src/space/setup/SetupScreen.js';
import type {
  SetupReport,
  SetupStart,
  SpaceSetupChooseFolderResult,
  SpaceSetupFailure,
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

const cockpit = {
  spaceSetupState: vi.fn<(arg: unknown) => Promise<SpaceSetupStateResult>>(),
  spaceSetupChooseFolder: vi.fn<(arg: unknown) => Promise<SpaceSetupChooseFolderResult>>(),
  spaceSetupValidate: vi.fn<(arg: unknown) => Promise<SpaceSetupValidateResult>>(),
  spaceSetupPlan: vi.fn<(arg: unknown) => Promise<SpaceSetupPlanResult>>(),
  spaceSetupRun: vi.fn<(arg: unknown) => Promise<SpaceSetupRunResult>>(),
  spaceSetupStop: vi.fn<(arg: unknown) => Promise<SpaceSetupStopResult>>(),
  spaceSetupOpenSpace: vi.fn<(arg: unknown) => Promise<SpaceWindowResult>>(),
  spaceNavigate: vi.fn<(arg: unknown) => Promise<SpaceWindowResult>>(),
  onSpaceSetupProgress: vi.fn((listener: (event: StepProgress) => void) => {
    progressListener = listener;
    return () => {
      progressListener = null;
    };
  }),
};

const PARENT = '/work/spaces';

const PLAN: SpaceSetupPlanResult = {
  ok: true,
  value: {
    plan: {
      flow: 'create',
      spaceRoot: `${PARENT}/demo`,
      target: 'absent',
      steps: [
        {
          stepId: 'machine-check',
          title: 'Check the machine',
          done: false,
          lines: [{ what: 'Check that git, gh, an AI engine and python3 are on the machine.' }],
        },
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
      project: 'demo',
      projectExists: false,
      labels: ['spec', 'plan'],
      views: ['Board'],
    },
    token: 'plan-token-1',
  },
};

function failure(kind: string, message: string, extra: Partial<SpaceSetupFailure> = {}) {
  return {
    ok: false as const,
    error: { kind, message, stepId: null, title: null, problems: [], byHand: [], ...extra },
  };
}

function report(extra: Partial<SetupReport> = {}): SetupReport {
  return {
    flow: 'create',
    spaceRoot: `${PARENT}/demo`,
    completed: ['machine-check', 'space-repository', 'project'],
    skipped: [],
    repository: null,
    project: null,
    byHand: ['Set the Board view to group by the field Stage.'],
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
  const title = PLAN.ok ? (PLAN.value.plan.steps[index]?.title ?? stepId) : stepId;
  act(() => progressListener?.({ stepId, title, index, total: 3, state, message }));
}

beforeEach(() => {
  progressListener = null;
  cockpit.spaceSetupState.mockReset().mockResolvedValue({
    ok: true,
    value: {
      flow: 'create',
      parentDir: PARENT,
      sourceDir: null,
      originUrl: null,
      running: false,
      interrupted: null,
    },
  });
  cockpit.spaceSetupChooseFolder
    .mockReset()
    .mockResolvedValue({ ok: true, value: { parentDir: PARENT } });
  cockpit.spaceSetupValidate.mockReset().mockResolvedValue({ ok: true, value: { problems: [] } });
  cockpit.spaceSetupPlan.mockReset().mockResolvedValue(PLAN);
  cockpit.spaceSetupRun.mockReset();
  cockpit.spaceSetupStop.mockReset().mockResolvedValue({ ok: true, value: { stopping: true } });
  cockpit.spaceSetupOpenSpace.mockReset().mockResolvedValue({ ok: true, value: { mode: 'space' } });
  cockpit.spaceNavigate
    .mockReset()
    .mockResolvedValue({ ok: true, value: { mode: 'space-welcome' } });
  cockpit.onSpaceSetupProgress.mockClear();
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
  type('setup-field-owner', 'me');
  fireEvent.click(screen.getByTestId('setup-show-plan'));
  await screen.findByTestId('setup-plan');
}

test("live validation shows core's sentence beside the field that was changed", async () => {
  cockpit.spaceSetupValidate.mockResolvedValue({
    ok: true,
    value: {
      problems: [
        { field: 'name', message: "The Space's name holds a space." },
        { field: 'owner', message: 'The owner is empty.' },
      ],
    },
  });
  await renderFlow();
  type('setup-field-name', 'bad name');
  const problem = await screen.findByTestId('setup-problem-name');
  expect(problem.textContent).toBe("The Space's name holds a space.");
  const input = screen.getByTestId('setup-field-name');
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(input.getAttribute('aria-describedby')).toBe(problem.id);
  // The owner was not changed yet, so its problem waits.
  expect(screen.queryByTestId('setup-problem-owner')).toBeNull();
  expect(cockpit.spaceSetupValidate).toHaveBeenLastCalledWith({
    flow: 'create',
    name: 'bad name',
    description: '',
    owner: '',
    private: true,
    repositories: [],
  });
});

test('asking for the plan with problems shows them all, moves focus to the first, and asks no plan', async () => {
  cockpit.spaceSetupValidate.mockResolvedValue({
    ok: true,
    value: { problems: [{ field: 'owner', message: 'The owner is empty.' }] },
  });
  await renderFlow();
  fireEvent.click(screen.getByTestId('setup-show-plan'));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('setup-field-owner')));
  expect(screen.getByTestId('setup-problem-owner').textContent).toBe('The owner is empty.');
  expect(cockpit.spaceSetupPlan).not.toHaveBeenCalled();
});

test('a plan refused with invalid-input returns to the form with the problems', async () => {
  cockpit.spaceSetupPlan.mockResolvedValue(
    failure('invalid-input', 'The form has problems.', {
      problems: [{ field: 'parentDir', message: '/work/spaces is not a folder.' }],
    }),
  );
  await renderFlow();
  fireEvent.click(screen.getByTestId('setup-show-plan'));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByTestId('setup-field-parentDir')),
  );
  expect(screen.getByTestId('setup-problem-parentDir').textContent).toBe(
    '/work/spaces is not a folder.',
  );
});

test("the folder is chosen in main's dialog; the renderer sends no path", async () => {
  cockpit.spaceSetupState.mockResolvedValue({
    ok: true,
    value: {
      flow: 'create',
      parentDir: null,
      sourceDir: null,
      originUrl: null,
      running: false,
      interrupted: null,
    },
  });
  await renderFlow();
  expect(screen.getByTestId('setup-parent-dir').textContent).toBe('No folder chosen.');
  fireEvent.click(screen.getByTestId('setup-field-parentDir'));
  await waitFor(() => expect(screen.getByTestId('setup-parent-dir').textContent).toBe(PARENT));
  expect(cockpit.spaceSetupChooseFolder).toHaveBeenCalledWith({});
});

test('the plan shows the names on GitHub and each step before anything runs', async () => {
  await fillAndPlan();
  expect(screen.getByTestId('setup-plan-github-repository').textContent).toContain('me/demo');
  expect(screen.getByTestId('setup-plan-github-repository').textContent).toContain(
    '(private) is created',
  );
  expect(screen.getByTestId('setup-plan-github-project').textContent).toContain('demo');
  const steps = within(screen.getByTestId('setup-plan-steps')).getAllByRole('listitem');
  expect(steps.length).toBeGreaterThanOrEqual(3);
  expect(screen.getByTestId('setup-plan-step-space-repository').textContent).toContain(
    'Create the private repository on GitHub. To: me/demo.',
  );
  expect(document.activeElement?.id).toBe('setup-plan-title');
  expect(cockpit.spaceSetupRun).not.toHaveBeenCalled();
  expect(screen.getByTestId('setup-confirm').textContent).toBe('Confirm: create on GitHub and run');
});

test('a double click on confirm starts one run', async () => {
  const run = deferred<SpaceSetupRunResult>();
  cockpit.spaceSetupRun.mockReturnValue(run.promise);
  await fillAndPlan();
  const button = screen.getByTestId('setup-confirm');
  fireEvent.click(button);
  fireEvent.click(button);
  await act(async () => run.resolve({ ok: true, value: report() }));
  expect(cockpit.spaceSetupRun).toHaveBeenCalledTimes(1);
});

test.each([
  ['target-not-empty', '/work/spaces/demo holds files that are not this Space.'],
  ['repository-taken', 'me/demo exists on GitHub and is not this Space.'],
  ['project-taken', "The Project demo exists and is not this Space's."],
])('a plan refused with %s shows the message and offers no run', async (kind, message) => {
  cockpit.spaceSetupPlan.mockResolvedValue(failure(kind, message));
  await fillAndPlan();
  const error = screen.getByTestId('setup-plan-error');
  expect(error.dataset.kind).toBe(kind);
  expect(error.textContent).toContain(message);
  expect(screen.queryByTestId('setup-confirm')).toBeNull();
});

test('progress per step in words, a failed step with its sentence, and run again', async () => {
  const first = deferred<SpaceSetupRunResult>();
  cockpit.spaceSetupRun.mockReturnValueOnce(first.promise);
  await fillAndPlan();
  fireEvent.click(screen.getByTestId('setup-confirm'));
  await screen.findByTestId('setup-progress');
  expect(screen.getByTestId('setup-step-state-project').textContent).toBe('· waiting');

  emit('machine-check', 0, 'checking');
  emit('machine-check', 0, 'skipped');
  emit('space-repository', 1, 'checking');
  emit('space-repository', 1, 'running');
  expect(screen.getByTestId('setup-step-state-machine-check').textContent).toBe('– skipped');
  expect(screen.getByTestId('setup-step-state-space-repository').textContent).toBe('… running');
  expect(screen.getByTestId('setup-status').textContent).toBe(
    'Running: Create the Space repository — running.',
  );
  emit('space-repository', 1, 'done');
  emit('project', 2, 'running');
  emit('project', 2, 'failed', 'gh is not signed in.');
  expect(screen.getByTestId('setup-step-project').dataset.state).toBe('failed');
  expect(screen.getByTestId('setup-step-message-project').textContent).toBe('gh is not signed in.');

  await act(async () =>
    first.resolve(
      failure('not-signed-in', 'gh is not signed in.', {
        stepId: 'project',
        title: 'Create the Project',
      }),
    ),
  );
  const error = await screen.findByTestId('setup-run-error');
  expect(error.textContent).toContain('Failed at: Create the Project');
  expect(error.textContent).toContain('gh is not signed in.');

  const second = deferred<SpaceSetupRunResult>();
  cockpit.spaceSetupRun.mockReturnValueOnce(second.promise);
  fireEvent.click(screen.getByTestId('setup-run-again'));
  await waitFor(() => expect(cockpit.spaceSetupRun).toHaveBeenCalledTimes(2));
  expect(cockpit.spaceSetupRun.mock.calls[0]?.[0]).toEqual({ token: 'plan-token-1' });
  expect(cockpit.spaceSetupRun.mock.calls[1]?.[0]).toEqual(
    cockpit.spaceSetupRun.mock.calls[0]?.[0],
  );
  // The new run starts with every step waiting again.
  expect(screen.getByTestId('setup-step-state-project').textContent).toBe('· waiting');
  emit('space-repository', 1, 'skipped');
  emit('project', 2, 'done');
  await act(async () => second.resolve({ ok: true, value: report() }));

  const byHand = await screen.findByTestId('setup-by-hand');
  expect(byHand.textContent).toContain('Set the Board view to group by the field Stage.');
  fireEvent.click(screen.getByTestId('setup-open-space'));
  await waitFor(() => expect(cockpit.spaceSetupOpenSpace).toHaveBeenCalledWith({}));
});

test('stop asks main to stop after the current step, and a stopped run can be run again', async () => {
  const run = deferred<SpaceSetupRunResult>();
  cockpit.spaceSetupRun.mockReturnValueOnce(run.promise);
  await fillAndPlan();
  fireEvent.click(screen.getByTestId('setup-confirm'));
  emit('machine-check', 0, 'running');
  fireEvent.click(await screen.findByTestId('setup-stop'));
  await waitFor(() =>
    expect(screen.getByTestId('setup-stop').textContent).toBe('Stopping after this step…'),
  );
  expect(cockpit.spaceSetupStop).toHaveBeenCalledWith({});
  await act(async () =>
    run.resolve(
      failure('stopped', 'The run was stopped before this step.', {
        stepId: 'space-repository',
        title: 'Create the Space repository',
      }),
    ),
  );
  expect((await screen.findByTestId('setup-status')).textContent).toBe(
    'Stopped. Run again to continue.',
  );
  expect(screen.getByTestId('setup-run-error').textContent).toContain(
    'Stopped before: Create the Space repository',
  );
  expect(screen.getByTestId('setup-run-again')).toBeTruthy();
});

test('open by address runs twice: the second run carries the confirmed repositories', async () => {
  cockpit.spaceSetupState.mockResolvedValue({
    ok: true,
    value: {
      flow: 'open',
      parentDir: PARENT,
      sourceDir: null,
      originUrl: null,
      running: false,
      interrupted: null,
    },
  });
  cockpit.spaceSetupPlan.mockResolvedValue({
    ok: true,
    value: {
      plan: {
        flow: 'open',
        spaceRoot: `${PARENT}/demo`,
        target: 'absent',
        steps: [{ stepId: 'clone-space', title: 'Clone the Space', done: false, lines: [] }],
      },
      github: null,
      token: 'plan-token-open',
    },
  });
  cockpit.spaceSetupRun
    .mockResolvedValueOnce({
      ok: true,
      value: report({
        flow: 'open',
        byHand: [],
        repositories: [
          { name: 'app', github: 'me/app', cloned: false },
          { name: 'docs', github: 'me/docs', cloned: false },
        ],
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      value: report({
        flow: 'open',
        byHand: [],
        repositories: [
          { name: 'app', github: 'me/app', cloned: true },
          { name: 'docs', github: 'me/docs', cloned: false },
        ],
      }),
    });
  await renderFlow({ kind: 'from-address' });
  type('setup-field-address', 'me/demo');
  fireEvent.click(screen.getByTestId('setup-show-plan'));
  await screen.findByTestId('setup-plan');
  expect(screen.queryByTestId('setup-plan-github')).toBeNull();
  fireEvent.click(screen.getByTestId('setup-confirm'));
  await screen.findByTestId('setup-repositories-found');
  expect(cockpit.spaceSetupRun).toHaveBeenLastCalledWith({
    token: 'plan-token-open',
    repositories: [],
  });
  fireEvent.click(screen.getByTestId('setup-found-docs'));
  fireEvent.click(screen.getByTestId('setup-clone-confirmed'));
  await waitFor(() =>
    expect(cockpit.spaceSetupRun).toHaveBeenLastCalledWith({
      token: 'plan-token-open',
      repositories: ['app'],
    }),
  );
  await waitFor(() =>
    expect((screen.getByTestId('setup-found-docs') as HTMLInputElement).checked).toBe(true),
  );
});

test('adopt shows the folder main opened and its origin, and sends neither', async () => {
  cockpit.spaceSetupState.mockResolvedValue({
    ok: true,
    value: {
      flow: 'adopt',
      parentDir: PARENT,
      sourceDir: '/work/app',
      originUrl: 'https://github.com/me/app.git',
      running: false,
      interrupted: null,
    },
  });
  await renderFlow({
    kind: 'about-repository',
    folder: '/work/app',
    originUrl: 'https://github.com/me/app.git',
  });
  expect(screen.getByTestId('setup-about-folder').textContent).toBe('/work/app');
  expect(screen.getByTestId('setup-origin').textContent).toContain('https://github.com/me/app.git');
  type('setup-field-name', 'demo');
  await waitFor(() =>
    expect(cockpit.spaceSetupValidate).toHaveBeenLastCalledWith({
      flow: 'adopt',
      name: 'demo',
      description: '',
      owner: '',
      private: true,
    }),
  );
});

test('a run stopped by a closed window is announced, with how to continue it', async () => {
  cockpit.spaceSetupState.mockResolvedValue({
    ok: true,
    value: {
      flow: 'create',
      parentDir: PARENT,
      sourceDir: null,
      originUrl: null,
      running: false,
      interrupted: { flow: 'create', spaceRoot: `${PARENT}/demo` },
    },
  });
  await renderFlow();
  expect(screen.getByTestId('setup-interrupted').textContent).toContain(`${PARENT}/demo`);
  expect(screen.getByTestId('setup-interrupted').textContent).toContain('run again');
});
