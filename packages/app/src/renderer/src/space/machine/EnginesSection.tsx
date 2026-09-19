import type { JSX } from 'react';
import type { EngineCheck, MachineCheck } from '../../../../shared/ipc.js';
import { primaryButtonStyle, rowCardStyle } from '../styles.js';
import {
  engineInstalledText,
  engineSignInText,
  engineTag,
  enginesOverallText,
} from './machineText.js';

type Props = {
  check: MachineCheck;
  onRunCommand: (commandId: string) => void;
  onOpenUrl: (url: string) => void;
  commandsBusy: boolean;
};

/**
 * Section C of Set up this computer: one row per engine of the catalog, in
 * catalog order, then any engine the Human Lead added by hand. Claude Code is
 * Required; every other engine is Optional, and can be installed and signed
 * in here even though a Space session still runs on Claude Code only.
 */
export function EnginesSection({
  check,
  onRunCommand,
  onOpenUrl,
  commandsBusy,
}: Props): JSX.Element {
  return (
    <div style={listStyle}>
      <p style={overallStyle} data-testid="machine-engines-overall">
        {enginesOverallText(check)}
      </p>
      {check.engines.map((engine) => (
        <EngineRow
          key={engine.engineId}
          engine={engine}
          npm={check.tools.npm}
          onRunCommand={onRunCommand}
          onOpenUrl={onOpenUrl}
          commandsBusy={commandsBusy}
        />
      ))}
      <p style={noteStyle}>
        In this version AI sessions in a Space run with Claude Code. The other engines can be
        installed now and are used in the cockpit.
      </p>
    </div>
  );
}

function EngineRow({
  engine,
  npm,
  onRunCommand,
  onOpenUrl,
  commandsBusy,
}: {
  engine: EngineCheck;
  npm: boolean;
  onRunCommand: (commandId: string) => void;
  onOpenUrl: (url: string) => void;
  commandsBusy: boolean;
}): JSX.Element {
  const testId = `machine-row-engine-${engine.engineId}`;
  const signIn = engineSignInText(engine.signIn);
  const isCatalog = engine.catalogId !== null;
  const isOptionalCatalog = isCatalog && engine.catalogId !== 'claude-code';

  let action: { label: string; onClick: () => void; isCommand: boolean } | null = null;
  if (isCatalog) {
    if (engine.installed.kind !== 'installed') {
      if (engine.installNeeds === 'npm' && !npm) {
        action = {
          label: 'Open the download page',
          onClick: () => onOpenUrl('https://nodejs.org/en/download'),
          isCommand: false,
        };
      } else {
        action = {
          label: 'Install',
          onClick: () => onRunCommand(`engine-install:${engine.catalogId}`),
          isCommand: true,
        };
      }
    } else if (engine.signIn.kind === 'not-signed-in') {
      action = {
        label: 'Sign in',
        onClick: () => onRunCommand(`engine-sign-in:${engine.catalogId}`),
        isCommand: true,
      };
    }
  }

  return (
    <div style={rowCardStyle} data-testid={testId}>
      <div style={headStyle}>
        <div style={nameGroupStyle}>
          <span style={nameStyle}>{engine.name}</span>
          {engine.maker !== null && <span style={makerStyle}>{engine.maker}</span>}
        </div>
        <span style={tagStyle}>{engineTag(engine)}</span>
      </div>
      <div style={cellsStyle}>
        <span data-testid={`${testId}-installed`}>{engineInstalledText(engine.installed)}</span>
        <span data-testid={`${testId}-signed-in`} style={signIn.muted ? mutedTextStyle : undefined}>
          {signIn.word}
        </span>
      </div>
      {action !== null && (
        <button
          type="button"
          style={primaryButtonStyle}
          disabled={action.isCommand && commandsBusy}
          title={
            action.isCommand && commandsBusy
              ? 'Wait for the command in the panel to end, or close the panel.'
              : undefined
          }
          data-testid={`${testId}-action`}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
      {isOptionalCatalog && (
        <p style={noteStyle}>
          Installed and ready for AI tabs outside Spaces. Guarded Space sessions run on Claude Code
          only, for now.
        </p>
      )}
      {engine.note !== null && <p style={noteStyle}>{engine.note}</p>}
    </div>
  );
}

const listStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.6rem' };

const overallStyle: React.CSSProperties = { margin: 0, fontSize: '0.85rem', fontWeight: 600 };

const headStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '0.6rem',
  flexWrap: 'wrap',
};

const nameGroupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.5rem',
};

const nameStyle: React.CSSProperties = { fontSize: '0.9rem', fontWeight: 600 };

const makerStyle: React.CSSProperties = { fontSize: '0.78rem', color: 'var(--color-text-muted)' };

const tagStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 600,
  color: 'var(--color-text-muted)',
};

const cellsStyle: React.CSSProperties = { display: 'flex', gap: '1rem', fontSize: '0.82rem' };

const mutedTextStyle: React.CSSProperties = { color: 'var(--color-text-muted)' };

const noteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  color: 'var(--color-text-muted)',
};
