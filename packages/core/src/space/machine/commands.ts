/**
 * The commands Set up this computer, and the fixes on other screens, may run.
 * The companion never builds a command line itself from user input: every one
 * of these is a fixed literal, chosen by an id the renderer sends.
 */

import { ENGINE_CATALOG, type EngineCatalogId } from '../engines/index.js';
import { GH_ADD_SCOPE_COMMAND } from './guidance.js';

/** The id of one command the setup screens may run. */
export type SetupCommandId =
  | 'install-command-line-tools'
  | 'install-gh'
  | 'update-gh'
  | 'github-sign-in'
  | 'github-add-project-scope'
  | `engine-install:${EngineCatalogId}`
  | `engine-sign-in:${EngineCatalogId}`;

/**
 * Signs `gh` in through the browser, asking for the `project` scope and the
 * device code at once, then teaches `git` to use the token.
 */
export const GH_WEB_SIGN_IN_COMMAND =
  'gh auth login --hostname github.com --web --clipboard --git-protocol https --scopes project && gh auth setup-git';

/** Every command id with its command line, in a fixed order. */
export function setupCommands(): { id: SetupCommandId; commandLine: string }[] {
  const commands: { id: SetupCommandId; commandLine: string }[] = [
    { id: 'install-command-line-tools', commandLine: 'xcode-select --install' },
    { id: 'install-gh', commandLine: 'brew install gh' },
    { id: 'update-gh', commandLine: 'brew upgrade gh' },
    { id: 'github-sign-in', commandLine: GH_WEB_SIGN_IN_COMMAND },
    { id: 'github-add-project-scope', commandLine: GH_ADD_SCOPE_COMMAND },
  ];
  for (const entry of ENGINE_CATALOG) {
    commands.push({ id: `engine-install:${entry.catalogId}`, commandLine: entry.installCommand });
    commands.push({ id: `engine-sign-in:${entry.catalogId}`, commandLine: entry.signInCommand });
  }
  return commands;
}

/** The command line of `id`, or `null` when it is not one of `setupCommands()`. */
export function setupCommandLine(id: string): string | null {
  return setupCommands().find((command) => command.id === id)?.commandLine ?? null;
}

/** ANSI escape sequences, removed before `parseDeviceCode` reads the text. Built at runtime (not a regex literal) so the escape character is not written into the source. */
const ANSI_ESCAPE = String.fromCharCode(27);
const ANSI_SEQUENCE = new RegExp(`${ANSI_ESCAPE}\\[[0-9;?]*[A-Za-z]`, 'g');

/** The GitHub one-time code in `text` (`XXXX-XXXX`), or `null`. */
const DEVICE_CODE = /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i;

/** The GitHub one-time code in `text`, ANSI sequences removed, in upper case, or `null`. */
export function parseDeviceCode(text: string): string | null {
  const clean = text.replace(ANSI_SEQUENCE, '');
  const match = DEVICE_CODE.exec(clean);
  return match?.[1] === undefined ? null : match[1].toUpperCase();
}
