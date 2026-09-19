/**
 * Whether Set up this computer is ready, and what is left when it is not.
 * Reads a `MachineCheck` and the Spaces folder setting; asks nothing itself.
 */

import type { MachineCheck, MachineRequirementCheck, MachineRequirementId } from './types.js';

/** One thing Set up this computer may still be waiting on. */
export type SetUpItemId = 'git' | 'python3' | 'gh' | 'github' | 'claude-code' | 'spaces-folder';

/** Whether Set up this computer is ready, and what is left when it is not. */
export type SetUpReadiness = { ready: boolean; left: { id: SetUpItemId; text: string }[] };

function requirementById(
  check: MachineCheck,
  id: MachineRequirementId,
): MachineRequirementCheck | undefined {
  return check.requirements.find((requirement) => requirement.id === id);
}

/**
 * Whether Set up this computer is ready: every requirement fine, Claude Code
 * installed and not signed out, and a Spaces folder chosen. `spacesFolder` is
 * the setting's value when it names an existing folder, else `null`.
 */
export function setUpReadiness(check: MachineCheck, spacesFolder: string | null): SetUpReadiness {
  const left: { id: SetUpItemId; text: string }[] = [];

  const git = requirementById(check, 'git');
  if (git?.state.kind === 'missing') left.push({ id: 'git', text: 'install Git' });
  else if (git?.state.kind === 'too-old') left.push({ id: 'git', text: 'update Git' });
  else if (git?.state.kind === 'undetermined') left.push({ id: 'git', text: 'check Git' });

  const python3 = requirementById(check, 'python3');
  if (python3?.state.kind === 'missing') left.push({ id: 'python3', text: 'install Python 3' });
  else if (python3?.state.kind === 'too-old') left.push({ id: 'python3', text: 'update Python 3' });
  else if (python3?.state.kind === 'undetermined')
    left.push({ id: 'python3', text: 'check Python 3' });

  const gh = requirementById(check, 'gh');
  if (gh?.state.kind === 'missing') left.push({ id: 'gh', text: 'install the GitHub CLI' });
  else if (gh?.state.kind === 'too-old') left.push({ id: 'gh', text: 'update the GitHub CLI' });
  else if (gh?.state.kind === 'not-signed-in')
    left.push({ id: 'github', text: 'sign in to GitHub' });
  else if (gh?.state.kind === 'missing-scope') {
    left.push({ id: 'github', text: 'give GitHub access to Projects' });
  } else if (gh?.state.kind === 'undetermined') {
    left.push({ id: 'github', text: 'check the GitHub sign-in' });
  }

  const claudeCode = check.engines.find((engine) => engine.catalogId === 'claude-code');
  if (claudeCode?.installed.kind === 'missing') {
    left.push({ id: 'claude-code', text: 'install Claude Code' });
  } else if (claudeCode?.installed.kind === 'undetermined') {
    left.push({ id: 'claude-code', text: 'check Claude Code' });
  } else if (claudeCode?.signIn.kind === 'not-signed-in') {
    left.push({ id: 'claude-code', text: 'sign in to Claude Code' });
  }

  if (spacesFolder === null) left.push({ id: 'spaces-folder', text: 'choose a Spaces folder' });

  return { ready: left.length === 0, left };
}
