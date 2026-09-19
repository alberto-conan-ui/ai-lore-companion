/**
 * The literal copy of Set up this computer (architecture document A.12, M9.8):
 * the words a row's state, its action and its collapsed summary use. Screens
 * import these instead of writing the sentences themselves, so the copy lives
 * in one place and a component test can check it directly.
 */

import type {
  EngineCheck,
  EngineInstallState,
  EngineSignInState,
  MachineCheck,
  MachineCheckState,
  MachineRequirementCheck,
  MachineRequirementId,
  SetUpReadiness,
  SpacesFolderState,
} from '../../../../shared/ipc.js';
import type { StateTagKind } from '../styles.js';

export function requirementById(
  check: MachineCheck,
  id: MachineRequirementId,
): MachineRequirementCheck | undefined {
  return check.requirements.find((requirement) => requirement.id === id);
}

/** The Claude Code entry of `check.engines`, or `undefined` when the list has none. */
export function claudeEngine(check: MachineCheck): EngineCheck | undefined {
  return check.engines.find((engine) => engine.catalogId === 'claude-code');
}

export type ToolRowText = {
  stateWord: string;
  stateKind: StateTagKind;
  /** The version, shown as muted text beside the state; `null` when there is none to show. */
  detail: string | null;
  /** The reason, shown under the row; `null` when there is none. */
  note: string | null;
};

/** The state word, its colour, the version detail and the note of a Tools row. */
export function toolRowText(state: MachineCheckState): ToolRowText {
  switch (state.kind) {
    case 'fine':
      return { stateWord: 'Ready', stateKind: 'ready', detail: state.version, note: null };
    case 'missing':
      return { stateWord: 'Not installed', stateKind: 'action', detail: null, note: null };
    case 'too-old':
      return {
        stateWord: `Too old: ${state.version} is installed and ${state.minimum} or later is needed`,
        stateKind: 'action',
        detail: null,
        note: null,
      };
    case 'undetermined':
      return {
        stateWord: 'Could not check',
        stateKind: 'failed',
        detail: null,
        note: state.reason,
      };
    case 'not-signed-in':
    case 'missing-scope':
      // Only the `gh` requirement reaches these two kinds, and only after its own version check
      // already passed (machine-check.ts's `ghStateAndReading`): the CLI is installed. The sign-in
      // itself is the GitHub section's row, below, so the Tools row reads as ready with no action.
      return { stateWord: 'Ready', stateKind: 'ready', detail: null, note: null };
    default:
      return { stateWord: 'Could not check', stateKind: 'failed', detail: null, note: null };
  }
}

/** One action a Tools row offers: a command run in the panel, or a link opened in the browser. */
export type ToolAction =
  | { kind: 'command'; label: string; commandId: string; note: string | null }
  | { kind: 'url'; label: string; url: string; note: string | null };

const DOWNLOAD_PAGE: Record<'git' | 'python3', string> = {
  git: 'https://git-scm.com/downloads',
  python3: 'https://www.python.org/downloads/',
};

/** The action of the Git or Python 3 row, or `null` when the row is fine or could not be checked. */
export function toolAction(id: 'git' | 'python3', state: MachineCheckState): ToolAction | null {
  if (state.kind === 'missing') {
    return {
      kind: 'command',
      label: 'Install',
      commandId: 'install-command-line-tools',
      note: "Opens Apple's installer for the command line developer tools. It installs Git and Python 3 together.",
    };
  }
  if (state.kind === 'too-old') {
    return { kind: 'url', label: 'Open the download page', url: DOWNLOAD_PAGE[id], note: null };
  }
  return null;
}

const GH_NO_BREW_NOTE =
  'Homebrew was not found, so the GitHub CLI is installed from its download page.';

/** The action of the GitHub CLI row of Tools, which depends on whether Homebrew is present. */
export function ghToolAction(state: MachineCheckState, hasBrew: boolean): ToolAction | null {
  if (state.kind === 'missing') {
    return hasBrew
      ? { kind: 'command', label: 'Install', commandId: 'install-gh', note: null }
      : {
          kind: 'url',
          label: 'Open the download page',
          url: 'https://cli.github.com',
          note: GH_NO_BREW_NOTE,
        };
  }
  if (state.kind === 'too-old') {
    return hasBrew
      ? { kind: 'command', label: 'Update', commandId: 'update-gh', note: null }
      : {
          kind: 'url',
          label: 'Open the download page',
          url: 'https://cli.github.com',
          note: GH_NO_BREW_NOTE,
        };
  }
  return null;
}

/** The tag shown beside an engine's name. */
export function engineTag(engine: EngineCheck): string {
  if (engine.catalogId === null) return 'Added in Settings';
  return engine.required ? 'Required — runs the AI sessions in a Space' : 'Optional';
}

/** The text of an engine row's "Installed" cell. */
export function engineInstalledText(installed: EngineInstallState): string {
  switch (installed.kind) {
    case 'installed':
      return installed.version === null ? 'Installed' : `Installed ${installed.version}`;
    case 'missing':
      return 'Not installed';
    case 'undetermined':
      return 'Could not check';
    default:
      return 'Not installed';
  }
}

/** The text of an engine row's "Signed in" cell, and whether it is shown muted. */
export function engineSignInText(signIn: EngineSignInState): { word: string; muted: boolean } {
  switch (signIn.kind) {
    case 'signed-in':
      return { word: 'Signed in', muted: false };
    case 'not-signed-in':
      return { word: 'Not signed in', muted: false };
    case 'not-checked':
      return { word: 'Not checked', muted: true };
    case 'undetermined':
      return { word: 'Could not check', muted: false };
    default:
      return { word: 'Not checked', muted: true };
  }
}

/** The AI engines section's header line: "✓ Ready — …" or "! Needs Claude Code". */
export function enginesOverallText(check: MachineCheck): string {
  const engine = requirementById(check, 'engine');
  return engine?.state.kind === 'fine'
    ? '✓ Ready — Claude Code can run Space sessions'
    : '! Needs Claude Code';
}

/** Whether the Tools section (Git, Python 3, GitHub CLI) is all fine, so it collapses. */
export function toolsFine(check: MachineCheck): boolean {
  return (
    requirementById(check, 'git')?.state.kind === 'fine' &&
    requirementById(check, 'python3')?.state.kind === 'fine' &&
    requirementById(check, 'gh')?.state.kind === 'fine'
  );
}

/** Whether the GitHub section (the sign-in row) is fine, so it collapses. */
export function githubFine(check: MachineCheck): boolean {
  return requirementById(check, 'gh')?.state.kind === 'fine';
}

/** Whether the AI engines section is fine: Claude Code is ready. */
export function enginesFine(check: MachineCheck): boolean {
  return requirementById(check, 'engine')?.state.kind === 'fine';
}

/** Whether the Spaces folder section is fine: a folder is set. */
export function spacesFolderFine(spacesFolder: SpacesFolderState): boolean {
  return spacesFolder.value !== null;
}

/** "✓ Tools — Git <v>, Python 3 <v>, GitHub CLI <v>" */
export function toolsCollapsedLine(check: MachineCheck): string {
  const version = (id: MachineRequirementId): string => {
    const state = requirementById(check, id)?.state;
    return state?.kind === 'fine' && state.version !== null ? state.version : '';
  };
  return `✓ Tools — Git ${version('git')}, Python 3 ${version('python3')}, GitHub CLI ${version('gh')}`;
}

/** "✓ GitHub — signed in as <account>, with access to Projects" */
export function githubCollapsedLine(check: MachineCheck): string {
  return `✓ GitHub — signed in as ${check.github.account ?? ''}, with access to Projects`;
}

/** "✓ AI engines — Claude Code can run Space sessions" */
export function enginesCollapsedLine(): string {
  return '✓ AI engines — Claude Code can run Space sessions';
}

/** "✓ Spaces folder — <path>" */
export function spacesFolderCollapsedLine(spacesFolder: SpacesFolderState): string {
  return `✓ Spaces folder — ${spacesFolder.value ?? ''}`;
}

/** "Left to do: <texts joined by ", ">." */
export function leftSentence(setUp: SetUpReadiness): string {
  return `Left to do: ${setUp.left.map((item) => item.text).join(', ')}.`;
}

/**
 * `path`, with a leading `home` written as `~` (CTO addition to M9.10: the
 * design shows the Spaces folder as `~/…`, not the full absolute path).
 * `path` outside `home` is returned as it is.
 */
export function withHomeTilde(path: string, home: string): string {
  if (home === '') return path;
  if (path === home) return '~';
  if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
  return path;
}
