import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// Phase M9.8: Set up this computer, with the command panel. `useXtermSession` is mocked as
// `dashboard-agents.test.tsx` mocks it; this mock also calls the `spawn` config once on mount, as
// the real hook does, so the panel's own `spaceCommandRun` call and PTY id are exercised.
vi.mock('../../../src/renderer/src/components/useXtermSession.js', () => ({
  useXtermSession: (config: { spawn?: () => Promise<string | null> }) => {
    // biome-ignore lint/correctness/useExhaustiveDependencies: mounts once, like the real hook's spawn-on-mount effect.
    useEffect(() => {
      void config.spawn?.();
    }, []);
    return { hostRef: { current: null }, focus: () => {}, search: {} };
  },
}));

import { MachineCheckScreen } from '../../../src/renderer/src/space/machine/MachineCheckScreen.js';
import type {
  EngineCheck,
  MachineCheck,
  MachineCheckReport,
  MachineRequirementCheck,
  SpaceCommandCode,
  SpaceCommandExit,
  SpaceCommandRunResult,
  SpaceMachineCheckResult,
  SpaceSpacesFolderResult,
  SpaceWindowResult,
} from '../../../src/shared/ipc.js';

const cockpit = {
  spaceMachineCheck: vi.fn<(arg: unknown) => Promise<SpaceMachineCheckResult>>(),
  spaceNavigate: vi.fn<(arg: unknown) => Promise<SpaceWindowResult>>(),
  spaceSpacesFolderUse: vi.fn<(arg: unknown) => Promise<SpaceSpacesFolderResult>>(),
  spaceSpacesFolderChoose: vi.fn<(arg: unknown) => Promise<SpaceSpacesFolderResult>>(),
  spaceCommandRun: vi.fn<(arg: unknown) => Promise<SpaceCommandRunResult>>(),
  onSpaceCommandCode: vi.fn<(cb: (p: SpaceCommandCode) => void) => () => void>(),
  onSpaceCommandExit: vi.fn<(cb: (p: SpaceCommandExit) => void) => () => void>(),
  urlOpenExternal: vi.fn(),
};

function requirement(
  id: MachineRequirementCheck['id'],
  state: MachineRequirementCheck['state'],
): MachineRequirementCheck {
  return { id, binary: id, state, guidance: null, command: null };
}

function claudeEngine(overrides: Partial<EngineCheck> = {}): EngineCheck {
  return {
    engineId: 'default.claude',
    name: 'Claude Code',
    binary: 'claude',
    state: { kind: 'fine', version: '2.1.0' },
    guidance: null,
    command: null,
    catalogId: 'claude-code',
    maker: 'Anthropic',
    required: true,
    guardedSessions: true,
    installed: { kind: 'installed', version: '2.1.0' },
    signIn: { kind: 'signed-in' },
    installCommand: 'curl -fsSL https://claude.ai/install.sh | bash',
    installNeeds: null,
    signInCommand: 'claude auth login',
    note: null,
    page: 'https://code.claude.com/docs/en/setup',
    ...overrides,
  };
}

function fineCheck(): MachineCheck {
  return {
    requirements: [
      requirement('git', { kind: 'fine', version: '2.43.0' }),
      requirement('gh', { kind: 'fine', version: '2.60.1' }),
      requirement('engine', { kind: 'fine', version: '2.1.0' }),
      requirement('python3', { kind: 'fine', version: '3.12.1' }),
    ],
    engines: [claudeEngine()],
    ready: true,
    github: { account: 'alberto-conan-ui', organisations: ['conan-ui'] },
    tools: { brew: true, npm: true },
  };
}

function reportOf(
  check: MachineCheck,
  spacesFolder: string | null = '/Users/alberto/Spaces',
): MachineCheckReport {
  return {
    check,
    checkedAt: 1_789_000_000_000,
    pathSource: 'login-shell',
    home: '/Users/alberto',
    spacesFolder: { value: spacesFolder, proposed: '/Users/alberto/Spaces' },
    setUp: (() => {
      const left: {
        id: 'git' | 'python3' | 'gh' | 'github' | 'claude-code' | 'spaces-folder';
        text: string;
      }[] = [];
      const git = check.requirements.find((r) => r.id === 'git');
      if (git?.state.kind !== 'fine') left.push({ id: 'git', text: 'install Git' });
      const python3 = check.requirements.find((r) => r.id === 'python3');
      if (python3?.state.kind !== 'fine') left.push({ id: 'python3', text: 'install Python 3' });
      const gh = check.requirements.find((r) => r.id === 'gh');
      if (gh?.state.kind === 'missing') left.push({ id: 'gh', text: 'install the GitHub CLI' });
      else if (gh?.state.kind === 'not-signed-in')
        left.push({ id: 'github', text: 'sign in to GitHub' });
      else if (gh?.state.kind === 'missing-scope')
        left.push({ id: 'github', text: 'give GitHub access to Projects' });
      else if (gh?.state.kind === 'undetermined')
        left.push({ id: 'github', text: 'check the GitHub sign-in' });
      const claude = check.engines.find((e) => e.catalogId === 'claude-code');
      if (claude?.installed.kind === 'missing')
        left.push({ id: 'claude-code', text: 'install Claude Code' });
      else if (claude?.signIn.kind === 'not-signed-in')
        left.push({ id: 'claude-code', text: 'sign in to Claude Code' });
      if (spacesFolder === null) left.push({ id: 'spaces-folder', text: 'choose a Spaces folder' });
      return { ready: left.length === 0, left };
    })(),
    commands: {
      'install-command-line-tools': 'xcode-select --install',
      'install-gh': 'brew install gh',
      'update-gh': 'brew upgrade gh',
      'github-sign-in':
        'gh auth login --hostname github.com --web --clipboard --git-protocol https --scopes project && gh auth setup-git',
      'github-add-project-scope': 'gh auth refresh --hostname github.com --scopes project',
      'engine-install:claude-code': 'curl -fsSL https://claude.ai/install.sh | bash',
      'engine-sign-in:claude-code': 'claude auth login',
    },
  };
}

function answerWith(report: MachineCheckReport): void {
  cockpit.spaceMachineCheck.mockResolvedValue({ ok: true, value: report });
}

beforeEach(() => {
  cockpit.spaceMachineCheck.mockReset();
  cockpit.spaceNavigate
    .mockReset()
    .mockResolvedValue({ ok: true, value: { mode: 'space-welcome' } });
  cockpit.spaceSpacesFolderUse.mockReset();
  cockpit.spaceSpacesFolderChoose.mockReset();
  cockpit.spaceCommandRun.mockReset().mockResolvedValue({
    ok: true,
    value: { ptyId: 'pty-default', commandId: 'noop', commandLine: '' },
  });
  cockpit.onSpaceCommandCode.mockReset().mockReturnValue(() => {});
  cockpit.onSpaceCommandExit.mockReset().mockReturnValue(() => {});
  cockpit.urlOpenExternal.mockReset();
  (window as unknown as { cockpit: unknown }).cockpit = cockpit;
});

afterEach(() => cleanup());

test('ready: the overall line says so, and Continue leads to the welcome screen', async () => {
  answerWith(reportOf(fineCheck()));
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  const overall = await screen.findByTestId('machine-check-overall');
  await waitFor(() => expect(overall.textContent).toBe('This computer is ready.'));
  expect(overall.dataset.ready).toBe('true');
  const continueButton = screen.getByTestId('machine-check-continue') as HTMLButtonElement;
  expect(continueButton.disabled).toBe(false);
  fireEvent.click(continueButton);
  await waitFor(() => expect(cockpit.spaceNavigate).toHaveBeenCalledWith({ to: 'space-welcome' }));
});

test('all sections fine: each collapses to its one line, with a Show button', async () => {
  answerWith(reportOf(fineCheck()));
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  await screen.findByTestId('machine-section-tools');
  expect(screen.getByTestId('machine-section-tools').textContent).toContain(
    '✓ Tools — Git 2.43.0, Python 3 3.12.1, GitHub CLI 2.60.1',
  );
  expect(screen.getByTestId('machine-section-github').textContent).toContain(
    '✓ GitHub — signed in as alberto-conan-ui, with access to Projects',
  );
  expect(screen.getByTestId('machine-section-engines').textContent).toContain(
    '✓ AI engines — Claude Code can run Space sessions',
  );
  expect(screen.getByTestId('machine-section-spaces-folder').textContent).toContain(
    '✓ Spaces folder — /Users/alberto/Spaces',
  );
  expect(screen.queryByTestId('machine-row-git')).toBeNull();

  fireEvent.click(screen.getByTestId('machine-section-tools-toggle'));
  expect(await screen.findByTestId('machine-row-git')).toBeTruthy();
});

test('not ready: Git missing shows Install, and the section stays open', async () => {
  const check = fineCheck();
  check.requirements[0] = requirement('git', { kind: 'missing' });
  check.ready = false;
  answerWith(reportOf(check));
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  const row = await screen.findByTestId('machine-row-git');
  expect(within(row).getByTestId('machine-row-git-state').textContent).toBe('! Not installed');
  const action = within(row).getByTestId('machine-row-git-action') as HTMLButtonElement;
  expect(action.textContent).toBe('Install');
  fireEvent.click(action);
  await waitFor(() =>
    expect(cockpit.spaceCommandRun).toHaveBeenCalledWith({
      commandId: 'install-command-line-tools',
    }),
  );
  expect((await screen.findByTestId('command-panel-command')).textContent).toContain(
    'Running: xcode-select --install',
  );

  const left = screen.getByTestId('machine-check-left');
  expect(left.textContent).toBe('Left to do: install Git.');
  expect(
    (screen.getByTestId('machine-check-continue') as HTMLButtonElement).getAttribute(
      'aria-describedby',
    ),
  ).toBe('machine-check-left');
});

test('Git too old: the download page opens in the browser, no command runs', async () => {
  const check = fineCheck();
  check.requirements[0] = requirement('git', {
    kind: 'too-old',
    version: '2.10.0',
    minimum: '2.40.0',
  });
  check.ready = false;
  answerWith(reportOf(check));
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  const row = await screen.findByTestId('machine-row-git');
  expect(within(row).getByTestId('machine-row-git-state').textContent).toBe(
    '! Too old: 2.10.0 is installed and 2.40.0 or later is needed',
  );
  fireEvent.click(within(row).getByTestId('machine-row-git-action'));
  expect(cockpit.urlOpenExternal).toHaveBeenCalledWith('https://git-scm.com/downloads');
  expect(cockpit.spaceCommandRun).not.toHaveBeenCalled();
});

test('GitHub CLI missing without Homebrew: opens the download page and notes why', async () => {
  const check = fineCheck();
  check.requirements[1] = requirement('gh', { kind: 'missing' });
  check.tools.brew = false;
  check.ready = false;
  answerWith(reportOf(check));
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  const row = await screen.findByTestId('machine-row-gh');
  expect(within(row).getByTestId('machine-row-gh-note').textContent).toBe(
    'Homebrew was not found, so the GitHub CLI is installed from its download page.',
  );
  fireEvent.click(within(row).getByTestId('machine-row-gh-action'));
  expect(cockpit.urlOpenExternal).toHaveBeenCalledWith('https://cli.github.com');
});

test('GitHub CLI signed out or missing a scope: the Tools row reads Ready, never the raw state name', async () => {
  const check = fineCheck();
  check.requirements[1] = requirement('gh', { kind: 'not-signed-in' });
  check.ready = false;
  answerWith(reportOf(check));
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  const row = await screen.findByTestId('machine-row-gh');
  expect(within(row).getByTestId('machine-row-gh-state').textContent).toBe('✓ Ready');
  expect(within(row).queryByTestId('machine-row-gh-action')).toBeNull();
  expect(row.textContent).not.toContain('not-signed-in');

  cleanup();
  const scopeCheck = fineCheck();
  scopeCheck.requirements[1] = requirement('gh', { kind: 'missing-scope', scope: 'project' });
  scopeCheck.ready = false;
  answerWith(reportOf(scopeCheck));
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  const scopeRow = await screen.findByTestId('machine-row-gh');
  expect(within(scopeRow).getByTestId('machine-row-gh-state').textContent).toBe('✓ Ready');
  expect(scopeRow.textContent).not.toContain('missing-scope');
});

test('GitHub section: not signed in offers the browser sign-in with its full command', async () => {
  const check = fineCheck();
  check.requirements[1] = requirement('gh', { kind: 'not-signed-in' });
  check.ready = false;
  answerWith(reportOf(check));
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  const row = await screen.findByTestId('machine-row-github');
  expect(row.textContent).toContain(
    'Sign in to GitHub in your browser. AI-Lore never sees your password or token; the GitHub CLI keeps them.',
  );
  fireEvent.click(within(row).getByTestId('machine-row-github-action'));
  await waitFor(() =>
    expect(cockpit.spaceCommandRun).toHaveBeenCalledWith({ commandId: 'github-sign-in' }),
  );
  expect((await screen.findByTestId('command-panel-command')).textContent).toContain(
    'gh auth login --hostname github.com --web --clipboard --git-protocol https --scopes project && gh auth setup-git',
  );
});

test('GitHub section: fine names the account and organisations, with a secondary Use another account', async () => {
  answerWith(reportOf(fineCheck()));
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  fireEvent.click(await screen.findByTestId('machine-section-github-toggle'));
  const row = await screen.findByTestId('machine-row-github');
  expect(row.textContent).toContain('Signed in as alberto-conan-ui, with access to Projects.');
  expect(within(row).getByTestId('machine-row-github-orgs').textContent).toBe(
    'Organisations: conan-ui.',
  );
  expect(within(row).getByTestId('machine-row-github-action').textContent).toBe(
    'Use another account…',
  );
});

test('GitHub section: undetermined offers Check again, which asks main fresh, not a command', async () => {
  const check = fineCheck();
  check.requirements[1] = requirement('gh', {
    kind: 'undetermined',
    reason: '`gh auth status` did not answer in 10 seconds.',
  });
  check.ready = false;
  answerWith(reportOf(check));
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  const row = await screen.findByTestId('machine-row-github');
  expect(row.textContent).toContain(
    'Could not check the GitHub sign-in: `gh auth status` did not answer in 10 seconds.',
  );
  cockpit.spaceMachineCheck.mockClear();
  fireEvent.click(within(row).getByTestId('machine-row-github-action'));
  await waitFor(() => expect(cockpit.spaceMachineCheck).toHaveBeenCalledWith({ fresh: true }));
  expect(cockpit.spaceCommandRun).not.toHaveBeenCalled();
});

test('engines: four catalog engines listed with their tags, and Claude Code not signed in offers Sign in', async () => {
  const check = fineCheck();
  check.engines = [
    claudeEngine({ signIn: { kind: 'not-signed-in' } }),
    {
      engineId: 'default.codex',
      name: 'Codex CLI',
      binary: 'codex',
      state: { kind: 'missing' },
      guidance: null,
      command: null,
      catalogId: 'codex',
      maker: 'OpenAI',
      required: false,
      guardedSessions: false,
      installed: { kind: 'missing' },
      signIn: { kind: 'not-checked' },
      installCommand: 'npm install -g @openai/codex',
      installNeeds: 'npm',
      signInCommand: 'codex login',
      note: null,
      page: 'https://learn.chatgpt.com/docs/codex/cli',
    },
    {
      engineId: 'default.antigravity',
      name: 'Antigravity CLI',
      binary: 'agy',
      state: { kind: 'fine', version: null },
      guidance: null,
      command: null,
      catalogId: 'antigravity',
      maker: 'Google',
      required: false,
      guardedSessions: false,
      installed: { kind: 'installed', version: null },
      signIn: { kind: 'not-checked' },
      installCommand: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
      installNeeds: null,
      signInCommand: 'agy',
      note: null,
      page: 'https://antigravity.google/docs/cli/install',
    },
    {
      engineId: 'default.opencode',
      name: 'OpenCode',
      binary: 'opencode',
      state: { kind: 'missing' },
      guidance: null,
      command: null,
      catalogId: 'opencode',
      maker: null,
      required: false,
      guardedSessions: false,
      installed: { kind: 'missing' },
      signIn: { kind: 'not-checked' },
      installCommand: 'curl -fsSL https://opencode.ai/install | bash',
      installNeeds: null,
      signInCommand: 'opencode auth login',
      note: 'Also runs DeepSeek models: choose DeepSeek when signing in.',
      page: 'https://opencode.ai/docs',
    },
  ];
  check.requirements[2] = requirement('engine', { kind: 'not-signed-in' });
  check.ready = false;
  answerWith(reportOf(check));
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  expect((await screen.findByTestId('machine-engines-overall')).textContent).toContain(
    '! Needs Claude Code',
  );
  const claudeRow = screen.getByTestId('machine-row-engine-default.claude');
  expect(claudeRow.textContent).toContain('Required');
  expect(
    within(claudeRow).getByTestId('machine-row-engine-default.claude-installed').textContent,
  ).toBe('Installed 2.1.0');
  expect(
    within(claudeRow).getByTestId('machine-row-engine-default.claude-signed-in').textContent,
  ).toBe('Not signed in');
  fireEvent.click(within(claudeRow).getByTestId('machine-row-engine-default.claude-action'));
  await waitFor(() =>
    expect(cockpit.spaceCommandRun).toHaveBeenCalledWith({
      commandId: 'engine-sign-in:claude-code',
    }),
  );

  const codexRow = screen.getByTestId('machine-row-engine-default.codex');
  expect(codexRow.textContent).toContain('Optional');
  expect(codexRow.textContent).toContain(
    'Installed and ready for AI tabs outside Spaces. Guarded Space sessions run on Claude Code only, for now.',
  );
  expect(within(codexRow).getByTestId('machine-row-engine-default.codex-action').textContent).toBe(
    'Install',
  );

  const antigravityRow = screen.getByTestId('machine-row-engine-default.antigravity');
  expect(antigravityRow.textContent).toContain('Optional');
  expect(
    within(antigravityRow).getByTestId('machine-row-engine-default.antigravity-signed-in')
      .textContent,
  ).toBe('Not checked');
  expect(screen.queryByTestId('machine-row-engine-default.antigravity-action')).toBeNull();

  const opencodeRow = screen.getByTestId('machine-row-engine-default.opencode');
  expect(opencodeRow.textContent).toContain(
    'Also runs DeepSeek models: choose DeepSeek when signing in.',
  );
});

test('Spaces folder: not set offers Use this folder and Choose, and re-checks after either', async () => {
  const check = fineCheck();
  check.ready = true;
  const report = reportOf(check, null);
  answerWith(report);
  cockpit.spaceSpacesFolderUse.mockResolvedValue({
    ok: true,
    value: { folder: '/Users/alberto/Spaces' },
  });
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  const row = await screen.findByTestId('machine-row-spaces-folder');
  // The Spaces folder is shown with the home folder written as `~` (CTO addition to M9.10).
  expect(within(row).getByTestId('machine-spaces-folder-path').textContent).toBe('~/Spaces');
  expect(within(row).getByTestId('machine-spaces-folder-use')).toBeTruthy();
  cockpit.spaceMachineCheck.mockClear();
  fireEvent.click(within(row).getByTestId('machine-spaces-folder-use'));
  await waitFor(() => expect(cockpit.spaceSpacesFolderUse).toHaveBeenCalledWith({}));
  await waitFor(() => expect(cockpit.spaceMachineCheck).toHaveBeenCalledWith({ fresh: true }));
});

test('Spaces folder: a path outside the home folder is shown in full, not shortened', async () => {
  const check = fineCheck();
  check.ready = true;
  const report = reportOf(check, '/Volumes/External/Spaces');
  answerWith(report);
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  // The section is fine (a folder is set), so it starts collapsed; open it to see the row.
  fireEvent.click(await screen.findByTestId('machine-section-spaces-folder-toggle'));
  const row = await screen.findByTestId('machine-row-spaces-folder');
  expect(within(row).getByTestId('machine-spaces-folder-path').textContent).toBe(
    '/Volumes/External/Spaces',
  );
});

test('while a command is active, other command buttons are disabled until Close', async () => {
  const check = fineCheck();
  check.requirements[0] = requirement('git', { kind: 'missing' });
  check.requirements[1] = requirement('gh', { kind: 'not-signed-in' });
  check.ready = false;
  answerWith(reportOf(check));
  cockpit.spaceCommandRun.mockResolvedValue({
    ok: true,
    value: {
      ptyId: 'pty-1',
      commandId: 'install-command-line-tools',
      commandLine: 'xcode-select --install',
    },
  });
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  const gitAction = await screen.findByTestId('machine-row-git-action');
  fireEvent.click(gitAction);
  await screen.findByTestId('command-panel');
  const githubAction = screen.getByTestId('machine-row-github-action') as HTMLButtonElement;
  expect(githubAction.disabled).toBe(true);
  fireEvent.click(screen.getByTestId('command-panel-close'));
  await waitFor(() => expect(screen.queryByTestId('command-panel')).toBeNull());
  expect((screen.getByTestId('machine-row-github-action') as HTMLButtonElement).disabled).toBe(
    false,
  );
});

test('command exit re-checks the machine, fresh', async () => {
  const check = fineCheck();
  check.requirements[0] = requirement('git', { kind: 'missing' });
  check.ready = false;
  answerWith(reportOf(check));
  cockpit.spaceCommandRun.mockResolvedValue({
    ok: true,
    value: {
      ptyId: 'pty-1',
      commandId: 'install-command-line-tools',
      commandLine: 'xcode-select --install',
    },
  });
  let exitHandler: ((p: SpaceCommandExit) => void) | null = null;
  cockpit.onSpaceCommandExit.mockImplementation((cb) => {
    exitHandler = cb;
    return () => {};
  });
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  fireEvent.click(await screen.findByTestId('machine-row-git-action'));
  await screen.findByTestId('command-panel');
  cockpit.spaceMachineCheck.mockClear();
  act(() => {
    exitHandler?.({ ptyId: 'pty-1', commandId: 'install-command-line-tools', exitCode: 0 });
  });
  await waitFor(() => expect(cockpit.spaceMachineCheck).toHaveBeenCalledWith({ fresh: true }));
  expect((await screen.findByTestId('command-panel-status')).textContent).toContain('Finished.');
});

test('Check all again and Back', async () => {
  answerWith(reportOf(fineCheck()));
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  await screen.findByTestId('machine-check-overall');
  cockpit.spaceMachineCheck.mockClear();
  fireEvent.click(screen.getByTestId('machine-check-again'));
  await waitFor(() => expect(cockpit.spaceMachineCheck).toHaveBeenCalledWith({ fresh: true }));
  fireEvent.click(screen.getByTestId('machine-check-back'));
  await waitFor(() => expect(cockpit.spaceNavigate).toHaveBeenCalledWith({ to: 'space-welcome' }));
});

test('the PATH note shows only when something was not found, and names its source', async () => {
  const readyReport = reportOf(fineCheck());
  answerWith(readyReport);
  const first = render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  await screen.findByTestId('machine-check-overall');
  expect(screen.queryByTestId('machine-check-path-source')).toBeNull();
  first.unmount();

  const check = fineCheck();
  check.requirements[0] = requirement('git', { kind: 'missing' });
  check.ready = false;
  const report = reportOf(check);
  report.pathSource = 'app-environment';
  answerWith(report);
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  expect((await screen.findByTestId('machine-check-path-source')).textContent).toBe(
    "The login shell's PATH could not be read, so the search used the app's own PATH.",
  );
});

test('init.section opens that section even when it is fine', async () => {
  answerWith(reportOf(fineCheck()));
  render(<MachineCheckScreen init={{ mode: 'machine-check', section: 'engines' }} />);
  expect(await screen.findByTestId('machine-row-engine-default.claude')).toBeTruthy();
  expect(screen.queryByTestId('machine-row-git')).toBeNull();
});

test('a check main refused is shown as an error', async () => {
  cockpit.spaceMachineCheck.mockResolvedValue({
    ok: false,
    error: { kind: 'check-failed', message: 'The machine check did not run: no registry.' },
  });
  render(<MachineCheckScreen init={{ mode: 'machine-check' }} />);
  const error = await screen.findByTestId('machine-check-error');
  expect(error.getAttribute('role')).toBe('alert');
  expect(error.textContent).toContain('no registry.');
});
