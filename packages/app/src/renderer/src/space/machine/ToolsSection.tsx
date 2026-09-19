import type { JSX } from 'react';
import type { MachineCheck, MachineCheckState } from '../../../../shared/ipc.js';
import { StatusRow } from '../common/StatusRow.js';
import { ghToolAction, requirementById, toolAction, toolRowText } from './machineText.js';

type Props = {
  check: MachineCheck;
  onRunCommand: (commandId: string) => void;
  onOpenUrl: (url: string) => void;
  /** True while a command panel is open; every other command button is disabled while it runs. */
  commandsBusy: boolean;
};

/**
 * Section A of Set up this computer: Git, Python 3 and the GitHub CLI. Each
 * row shows whether the tool is ready, and a button that installs or updates
 * it, or opens its download page, when it is not.
 */
export function ToolsSection({ check, onRunCommand, onOpenUrl, commandsBusy }: Props): JSX.Element {
  const git = requirementById(check, 'git');
  const python3 = requirementById(check, 'python3');
  const gh = requirementById(check, 'gh');
  return (
    <div style={listStyle}>
      {git !== undefined && (
        <ToolRow
          testId="machine-row-git"
          name="Git"
          purpose="Keeps the history of your Spaces."
          state={git.state}
          action={toolAction('git', git.state)}
          onRunCommand={onRunCommand}
          onOpenUrl={onOpenUrl}
          commandsBusy={commandsBusy}
        />
      )}
      {python3 !== undefined && (
        <ToolRow
          testId="machine-row-python3"
          name="Python 3"
          purpose="Runs the check that protects your files during AI sessions."
          state={python3.state}
          action={toolAction('python3', python3.state)}
          onRunCommand={onRunCommand}
          onOpenUrl={onOpenUrl}
          commandsBusy={commandsBusy}
        />
      )}
      {gh !== undefined && (
        <ToolRow
          testId="machine-row-gh"
          name="GitHub CLI"
          purpose="Lets AI-Lore create repositories and Projects on GitHub."
          state={gh.state}
          action={ghToolAction(gh.state, check.tools.brew)}
          onRunCommand={onRunCommand}
          onOpenUrl={onOpenUrl}
          commandsBusy={commandsBusy}
        />
      )}
    </div>
  );
}

function ToolRow({
  testId,
  name,
  purpose,
  state,
  action,
  onRunCommand,
  onOpenUrl,
  commandsBusy,
}: {
  testId: string;
  name: string;
  purpose: string;
  state: MachineCheckState;
  action: ReturnType<typeof toolAction>;
  onRunCommand: (commandId: string) => void;
  onOpenUrl: (url: string) => void;
  commandsBusy: boolean;
}): JSX.Element {
  const { stateWord, stateKind, detail, note } = toolRowText(state);
  return (
    <StatusRow
      testId={testId}
      name={name}
      tag="Required"
      purpose={purpose}
      stateWord={stateWord}
      stateKind={stateKind}
      detail={detail}
      note={action?.note ?? note}
      action={
        action === null
          ? null
          : {
              label: action.label,
              disabled: action.kind === 'command' && commandsBusy,
              title:
                action.kind === 'command' && commandsBusy
                  ? 'Wait for the command in the panel to end, or close the panel.'
                  : undefined,
              onClick: () =>
                action.kind === 'command' ? onRunCommand(action.commandId) : onOpenUrl(action.url),
            }
      }
    />
  );
}

const listStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.6rem' };
