/**
 * The guidance of the machine check: for each state that is not `fine`, the
 * sentence the screen shows and, when one command does it, that command.
 *
 * The companion installs nothing and signs in nowhere. The Human Lead runs the
 * command in the screen's terminal and presses "check again".
 */

import type { MachineCheckState, MachinePlatform } from './types.js';

/** The host the companion works with. GitHub Enterprise hosts are outside the MVP. */
export const GITHUB_HOST = 'github.com';

/**
 * The scope every Project operation of `gh` needs. The same value as
 * `PROJECT_SCOPE` in `github/types.ts`; declared here so that the machine
 * check has no import from a folder of another phase.
 */
export const REQUIRED_GH_SCOPE = 'project';

/** The literal command that adds the `project` scope to the token `gh` holds. */
export const GH_ADD_SCOPE_COMMAND = `gh auth refresh --hostname ${GITHUB_HOST} --scopes ${REQUIRED_GH_SCOPE}`;

/** The literal command that signs `gh` in, asking for the `project` scope at once. */
export const GH_SIGN_IN_COMMAND = `gh auth login --hostname ${GITHUB_HOST} --scopes ${REQUIRED_GH_SCOPE}`;

/** Where each tool is downloaded. The links are the choice of the session that built phase M3.2. */
export const INSTALL_LINKS = {
  git: 'https://git-scm.com/downloads',
  gh: 'https://cli.github.com',
  python3: 'https://www.python.org/downloads/',
  claude: 'https://docs.claude.com/en/docs/claude-code/setup',
} as const;

/** A guidance sentence, with the command that does it when there is one. */
export type Guidance = { guidance: string | null; command: string | null };

/** What the guidance needs to know about the tool it is written for. */
export type GuidanceSubject = {
  /** The name in the sentence: `git`, `gh`, `python3`, or an engine's name. */
  name: string;
  /** Where to get it, or `null` when the companion knows no link. */
  link: string | null;
  /** The command that installs it on this platform, or `null`. */
  installCommand: string | null;
  /** The command that signs it in, or `null`. */
  signInCommand: string | null;
};

const CHECK_AGAIN = 'Then check again.';

/**
 * The command that installs `git` or `python3` on `platform`, when the
 * platform has one command for it. On macOS both come with Apple's command
 * line developer tools.
 */
export function platformInstallCommand(
  tool: 'git' | 'python3',
  platform: MachinePlatform,
): string | null {
  const commands: Partial<Record<MachinePlatform, Record<'git' | 'python3', string>>> = {
    darwin: { git: 'xcode-select --install', python3: 'xcode-select --install' },
  };
  return commands[platform]?.[tool] ?? null;
}

function howToGet(subject: GuidanceSubject, verb: 'Install' | 'Update'): string {
  if (subject.installCommand !== null && subject.link !== null) {
    return `${verb} it by running \`${subject.installCommand}\` in the terminal, or from ${subject.link}.`;
  }
  if (subject.installCommand !== null) {
    return `${verb} it by running \`${subject.installCommand}\` in the terminal.`;
  }
  if (subject.link !== null) return `${verb} it from ${subject.link}.`;
  return `${verb} it with the instructions of its maker.`;
}

/** The guidance for `state` of `subject`. Both fields are `null` when the state is `fine`. */
export function guidanceFor(subject: GuidanceSubject, state: MachineCheckState): Guidance {
  switch (state.kind) {
    case 'fine':
      return { guidance: null, command: null };
    case 'missing':
      return {
        guidance: `${subject.name} was not found on this machine. ${howToGet(subject, 'Install')} ${CHECK_AGAIN}`,
        command: subject.installCommand,
      };
    case 'too-old':
      return {
        guidance: `${subject.name} ${state.version} is installed, and the companion needs ${state.minimum} or later. ${howToGet(subject, 'Update')} ${CHECK_AGAIN}`,
        command: null,
      };
    case 'not-signed-in':
      return {
        guidance:
          subject.signInCommand === null
            ? `${subject.name} is installed and not signed in. Sign in to it in the terminal, with its own flow. ${CHECK_AGAIN}`
            : `${subject.name} is installed and not signed in. Run \`${subject.signInCommand}\` in the terminal and follow its steps. ${CHECK_AGAIN}`,
        command: subject.signInCommand,
      };
    case 'missing-scope':
      return {
        guidance: `${subject.name} is signed in, and its token lacks the \`${state.scope}\` scope, which GitHub Projects need. Run \`${GH_ADD_SCOPE_COMMAND}\` in the terminal and follow its steps. ${CHECK_AGAIN}`,
        command: GH_ADD_SCOPE_COMMAND,
      };
    case 'undetermined':
      return {
        guidance: `The state of ${subject.name} could not be determined: ${state.reason} Correct that, then check again.`,
        command: null,
      };
  }
}
