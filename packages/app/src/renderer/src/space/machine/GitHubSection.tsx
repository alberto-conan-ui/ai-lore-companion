import type { JSX } from 'react';
import type { MachineCheck } from '../../../../shared/ipc.js';
import { primaryButtonStyle, rowCardStyle, secondaryButtonStyle } from '../styles.js';
import { requirementById } from './machineText.js';

type Props = {
  check: MachineCheck;
  onRunCommand: (commandId: string) => void;
  onCheckAgain: () => void;
  commandsBusy: boolean;
};

type Action = { label: string; onClick: () => void; secondary: boolean; isCommand: boolean };

/**
 * Section B of Set up this computer: the GitHub sign-in, its `project` scope
 * and the account's organisations. Every fix runs in the browser, through
 * `gh`; the companion never sees a password or a token.
 */
export function GitHubSection({
  check,
  onRunCommand,
  onCheckAgain,
  commandsBusy,
}: Props): JSX.Element {
  const gh = requirementById(check, 'gh');
  const kind = gh?.state.kind ?? 'missing';
  const { account, organisations } = check.github;

  let text = '';
  let secondLine: string | null = null;
  let action: Action | null = null;

  if (kind === 'missing' || kind === 'too-old') {
    text = 'Install the GitHub CLI first (Tools, above).';
  } else if (kind === 'not-signed-in') {
    text =
      'Sign in to GitHub in your browser. AI-Lore never sees your password or token; the GitHub CLI keeps them.';
    action = {
      label: 'Sign in with GitHub',
      onClick: () => onRunCommand('github-sign-in'),
      secondary: false,
      isCommand: true,
    };
  } else if (kind === 'missing-scope') {
    text = `Signed in as ${account ?? ''}. GitHub Projects need one more permission.`;
    action = {
      label: 'Allow access to Projects',
      onClick: () => onRunCommand('github-add-project-scope'),
      secondary: false,
      isCommand: true,
    };
  } else if (kind === 'fine') {
    text = `Signed in as ${account ?? ''}, with access to Projects.`;
    secondLine =
      organisations.length > 0
        ? `Organisations: ${organisations.join(', ')}.`
        : 'No organisations.';
    action = {
      label: 'Use another account…',
      onClick: () => onRunCommand('github-sign-in'),
      secondary: true,
      isCommand: true,
    };
  } else if (kind === 'undetermined' && gh?.state.kind === 'undetermined') {
    text = `Could not check the GitHub sign-in: ${gh.state.reason}`;
    action = { label: 'Check again', onClick: onCheckAgain, secondary: false, isCommand: false };
  }

  return (
    <div style={rowCardStyle} data-testid="machine-row-github">
      <p style={textStyle} data-testid="machine-row-github-text">
        {text}
      </p>
      {secondLine !== null && (
        <p style={textStyle} data-testid="machine-row-github-orgs">
          {secondLine}
        </p>
      )}
      {action !== null && (
        <button
          type="button"
          style={action.secondary ? secondaryButtonStyle : primaryButtonStyle}
          disabled={action.isCommand && commandsBusy}
          title={
            action.isCommand && commandsBusy
              ? 'Wait for the command in the panel to end, or close the panel.'
              : undefined
          }
          data-testid="machine-row-github-action"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

const textStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.85rem',
  color: 'var(--color-text)',
};
