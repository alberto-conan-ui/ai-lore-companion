import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MachineCheckScreen } from '../../../src/renderer/src/space/machine/MachineCheckScreen.js';
import {
  MACHINE_CHECK_STATE_KINDS,
  type MachineCheckReport,
  type MachineCheckState,
  type MachineRequirementCheck,
  type MachineRequirementId,
  type SpaceMachineCheckResult,
  type SpaceWindowResult,
} from '../../../src/shared/ipc.js';

const cockpit = {
  spaceMachineCheck: vi.fn<(arg: unknown) => Promise<SpaceMachineCheckResult>>(),
  spaceNavigate: vi.fn<(arg: unknown) => Promise<SpaceWindowResult>>(),
  spaceOpenFolder: vi.fn<(arg: unknown) => Promise<SpaceWindowResult>>(),
  copyText: vi.fn<(text: string) => void>(),
};

const GH_SCOPE_COMMAND = 'gh auth refresh --hostname github.com --scopes project';

/** One state of each kind, with the sentence and the command core would give for `gh`. */
const STATES: Record<
  MachineCheckState['kind'],
  { state: MachineCheckState; guidance: string | null; command: string | null }
> = {
  fine: { state: { kind: 'fine', version: '2.60.1' }, guidance: null, command: null },
  missing: {
    state: { kind: 'missing' },
    guidance:
      'gh was not found on this machine. Install it from https://cli.github.com. Then check again.',
    command: null,
  },
  'too-old': {
    state: { kind: 'too-old', version: '2.10.0', minimum: '2.40.0' },
    guidance: 'gh 2.10.0 is installed, and the companion needs 2.40.0 or later.',
    command: null,
  },
  'not-signed-in': {
    state: { kind: 'not-signed-in' },
    guidance: 'gh is installed and not signed in. Run the command in the terminal.',
    command: 'gh auth login --hostname github.com --scopes project',
  },
  'missing-scope': {
    state: { kind: 'missing-scope', scope: 'project' },
    guidance: 'gh is signed in, and its token lacks the `project` scope.',
    command: GH_SCOPE_COMMAND,
  },
  undetermined: {
    state: { kind: 'undetermined', reason: '`gh auth status` did not answer in 10 seconds.' },
    guidance: 'The state of gh could not be determined: `gh auth status` did not answer.',
    command: null,
  },
};

function fine(id: MachineRequirementId, binary: string, version: string): MachineRequirementCheck {
  return { id, binary, state: { kind: 'fine', version }, guidance: null, command: null };
}

function reportWithGh(kind: MachineCheckState['kind']): MachineCheckReport {
  const gh = STATES[kind];
  return {
    check: {
      requirements: [
        fine('git', 'git', '2.43.0'),
        { id: 'gh', binary: 'gh', ...gh },
        fine('engine', 'claude', '2.1.0'),
        fine('python3', 'python3', '3.12.1'),
      ],
      engines: [
        {
          engineId: 'default.claude',
          name: 'Claude',
          binary: 'claude',
          state: { kind: 'fine', version: '2.1.0' },
          guidance: null,
          command: null,
        },
      ],
      ready: kind === 'fine',
    },
    checkedAt: 1_789_000_000_000,
    pathSource: 'login-shell',
  };
}

function answerWith(report: MachineCheckReport): void {
  cockpit.spaceMachineCheck.mockResolvedValue({ ok: true, value: report });
}

beforeEach(() => {
  cockpit.spaceMachineCheck.mockReset();
  cockpit.spaceNavigate.mockReset().mockResolvedValue({ ok: true, value: { mode: 'setup' } });
  cockpit.spaceOpenFolder.mockReset().mockResolvedValue({ ok: true, value: { mode: 'space' } });
  cockpit.copyText.mockReset();
  (window as unknown as { cockpit: unknown }).cockpit = cockpit;
});

afterEach(() => cleanup());

test.each(MACHINE_CHECK_STATE_KINDS)(
  'state %s: the row shows the state by name and mark, the sentence, and the command when there is one',
  async (kind) => {
    answerWith(reportWithGh(kind));
    render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
    const row = await screen.findByTestId('machine-check-row-gh');
    expect(row.dataset.state).toBe(kind);
    // The state is written with its own name, and a mark that is not only a colour.
    const mark = kind === 'fine' ? '✓' : kind === 'undetermined' ? '?' : '✗';
    expect(screen.getByTestId('machine-check-state-gh').textContent).toBe(`${mark} ${kind}`);

    const { guidance, command } = STATES[kind];
    if (guidance === null) expect(screen.queryByTestId('machine-check-guidance-gh')).toBeNull();
    else expect(screen.getByTestId('machine-check-guidance-gh').textContent).toBe(guidance);
    if (command === null) {
      expect(screen.queryByTestId('machine-check-command-gh')).toBeNull();
      expect(screen.queryByTestId('machine-check-copy-gh')).toBeNull();
    } else {
      expect(screen.getByTestId('machine-check-command-gh').textContent).toBe(command);
      expect(screen.getByTestId('machine-check-copy-gh')).toBeTruthy();
    }

    const overall = screen.getByTestId('machine-check-overall');
    // An `output` element has the status role, so the result is read out when it changes.
    expect(screen.getAllByRole('status')).toContain(overall);
    expect(overall.dataset.ready).toBe(String(kind === 'fine'));
    expect(overall.textContent).toContain(
      kind === 'fine' ? 'Machine check: ready.' : `Machine check: not ready. gh is ${kind}.`,
    );
  },
);

test('the four requirements are listed in fixed order, whatever order the report has', async () => {
  const report = reportWithGh('fine');
  report.check.requirements.reverse();
  answerWith(report);
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  const list = await screen.findByTestId('machine-check-requirements');
  const names = within(list)
    .getAllByRole('heading', { level: 2 })
    .map((heading) => heading.textContent);
  expect(names).toEqual(['git', 'gh', 'engine', 'python3']);
  expect(screen.getByTestId('machine-check-binary-engine').textContent).toBe('command claude');
});

test('the version found is shown for fine and for too-old; the scope for missing-scope', async () => {
  answerWith(reportWithGh('too-old'));
  const first = render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  expect((await screen.findByTestId('machine-check-found-gh')).textContent).toBe(
    'version 2.10.0, lowest accepted 2.40.0',
  );
  expect(screen.getByTestId('machine-check-found-git').textContent).toBe('version 2.43.0');
  first.unmount();

  answerWith(reportWithGh('missing-scope'));
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  expect((await screen.findByTestId('machine-check-found-gh')).textContent).toBe('scope project');
});

test('the copy button puts the literal command on the clipboard and says so', async () => {
  answerWith(reportWithGh('missing-scope'));
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  const copy = await screen.findByTestId('machine-check-copy-gh');
  expect(copy.getAttribute('aria-label')).toBe(`Copy the command ${GH_SCOPE_COMMAND}`);
  fireEvent.click(copy);
  expect(cockpit.copyText).toHaveBeenCalledWith(GH_SCOPE_COMMAND);
  expect(screen.getByTestId('machine-check-row-gh').textContent).toContain('Copied.');
});

test('check again: the screen checks on mount, and the button runs the check again and shows the new result', async () => {
  answerWith(reportWithGh('not-signed-in'));
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  await screen.findByTestId('machine-check-row-gh');
  expect(cockpit.spaceMachineCheck).toHaveBeenCalledTimes(1);
  expect(cockpit.spaceMachineCheck).toHaveBeenLastCalledWith({ fresh: true });
  expect(screen.getByTestId('machine-check-overall').dataset.ready).toBe('false');

  let finish: (result: SpaceMachineCheckResult) => void = () => {};
  cockpit.spaceMachineCheck.mockReturnValue(
    new Promise<SpaceMachineCheckResult>((resolve) => {
      finish = resolve;
    }),
  );
  const again = screen.getByTestId('machine-check-again') as HTMLButtonElement;
  expect(again.textContent).toBe('Check again');
  fireEvent.click(again);
  expect(cockpit.spaceMachineCheck).toHaveBeenCalledTimes(2);
  expect(cockpit.spaceMachineCheck).toHaveBeenLastCalledWith({ fresh: true });
  // While the check runs the button says so, and the earlier result stays on the screen.
  expect(again.disabled).toBe(true);
  expect(again.textContent).toBe('Checking…');
  expect(screen.getByTestId('machine-check-state-gh').textContent).toBe('✗ not-signed-in');

  finish({ ok: true, value: reportWithGh('fine') });
  await waitFor(() =>
    expect(screen.getByTestId('machine-check-overall').dataset.ready).toBe('true'),
  );
  expect(screen.getByTestId('machine-check-state-gh').textContent).toBe('✓ fine');
  expect(again.disabled).toBe(false);
});

test('not ready: create, adopt and open by address do nothing, and the reason is stated', async () => {
  answerWith(reportWithGh('missing'));
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  await screen.findByTestId('machine-check-row-gh');
  const reason = screen.getByTestId('machine-check-setup-reason');
  expect(reason.textContent).toBe('Not available: the machine check is not ready. gh is missing.');
  for (const id of ['create', 'adopt', 'open-by-address']) {
    const entry = screen.getByTestId(`machine-check-${id}`);
    expect(entry.getAttribute('aria-disabled')).toBe('true');
    expect(entry.getAttribute('aria-describedby')).toContain(reason.id);
    fireEvent.click(entry);
  }
  expect(cockpit.spaceNavigate).not.toHaveBeenCalled();
  expect(cockpit.spaceOpenFolder).not.toHaveBeenCalled();
});

test('ready: the three entries lead to setup, and adopt asks main for the folder dialog', async () => {
  answerWith(reportWithGh('fine'));
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  await screen.findByTestId('machine-check-row-gh');
  expect(screen.queryByTestId('machine-check-setup-reason')).toBeNull();
  const create = screen.getByTestId('machine-check-create');
  expect(create.getAttribute('aria-disabled')).toBe('false');
  fireEvent.click(create);
  await waitFor(() =>
    expect(cockpit.spaceNavigate).toHaveBeenCalledWith({ to: 'setup', start: 'new' }),
  );
  await waitFor(() => expect(create.getAttribute('aria-disabled')).toBe('false'));
  fireEvent.click(screen.getByTestId('machine-check-open-by-address'));
  await waitFor(() =>
    expect(cockpit.spaceNavigate).toHaveBeenCalledWith({ to: 'setup', start: 'from-address' }),
  );
  await waitFor(() => expect(create.getAttribute('aria-disabled')).toBe('false'));
  fireEvent.click(screen.getByTestId('machine-check-adopt'));
  await waitFor(() => expect(cockpit.spaceOpenFolder).toHaveBeenCalledWith({}));
});

test('while the first check runs: the screen says so and the entries are not available', () => {
  cockpit.spaceMachineCheck.mockReturnValue(new Promise<SpaceMachineCheckResult>(() => {}));
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  expect(screen.getByTestId('machine-check-overall').textContent).toBe('Checking the machine…');
  expect(screen.getByTestId('machine-check-overall').dataset.ready).toBe('unknown');
  expect(screen.queryByTestId('machine-check-requirements')).toBeNull();
  expect(screen.getByTestId('machine-check-setup-reason').textContent).toBe(
    'Not available: the machine check is running.',
  );
  expect(screen.getByTestId('machine-check-create').getAttribute('aria-disabled')).toBe('true');
});

test('error state: a check that main refused is shown, and check again is offered', async () => {
  cockpit.spaceMachineCheck.mockResolvedValue({
    ok: false,
    error: { kind: 'check-failed', message: 'The machine check did not run: no registry.' },
  });
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  const error = await screen.findByTestId('machine-check-error');
  expect(error.getAttribute('role')).toBe('alert');
  expect(error.textContent).toContain('no registry.');
  expect(screen.getByTestId('machine-check-overall').textContent).toBe('Machine check: not run.');
  expect(screen.getByTestId('machine-check-setup-reason').textContent).toContain(
    'the machine check did not run',
  );
  expect((screen.getByTestId('machine-check-again') as HTMLButtonElement).disabled).toBe(false);
});

test('more than one engine in the registry: each is listed with its state under the engine row', async () => {
  const report = reportWithGh('fine');
  report.check.engines.push({
    engineId: 'default.gemini',
    name: 'Gemini',
    binary: 'gemini',
    state: { kind: 'missing' },
    guidance: 'Gemini was not found on this machine.',
    command: null,
  });
  answerWith(report);
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  const gemini = await screen.findByTestId('machine-check-engine-default.gemini');
  expect(gemini.textContent).toBe('Gemini, command gemini: ✗ missing');
  expect(screen.getByTestId('machine-check-engine-default.claude').textContent).toBe(
    'Claude, command claude: ✓ fine',
  );
});

test('an empty registry: the engine row says there is no engine', async () => {
  const report = reportWithGh('fine');
  report.check.requirements[2] = {
    id: 'engine',
    binary: null,
    state: { kind: 'missing' },
    guidance: 'No engine is in the registry.',
    command: null,
  };
  report.check.engines = [];
  report.check.ready = false;
  answerWith(report);
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  expect((await screen.findByTestId('machine-check-binary-engine')).textContent).toBe(
    'no engine in the registry',
  );
});

test('the screen says which PATH the commands ran with, and leads back to welcome', async () => {
  const report = reportWithGh('fine');
  report.pathSource = 'app-environment';
  answerWith(report);
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  expect((await screen.findByTestId('machine-check-path-source')).textContent).toContain(
    'The PATH of the login shell could not be read.',
  );
  fireEvent.click(screen.getByTestId('machine-check-back'));
  await waitFor(() => expect(cockpit.spaceNavigate).toHaveBeenCalledWith({ to: 'space-welcome' }));
});
