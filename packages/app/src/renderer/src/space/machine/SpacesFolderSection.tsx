import type { JSX } from 'react';
import type { SpacesFolderState } from '../../../../shared/ipc.js';
import {
  folderPathStyle,
  primaryButtonStyle,
  rowCardStyle,
  secondaryButtonStyle,
} from '../styles.js';
import { withHomeTilde } from './machineText.js';

type Props = {
  spacesFolder: SpacesFolderState;
  /** The Human Lead's home folder, so the path is shown with `~` (CTO addition to M9.10). */
  home: string;
  onUse: () => void;
  onChoose: () => void;
  busy: boolean;
};

/**
 * Section D of Set up this computer: the folder new Spaces are created in.
 * The Human Lead confirms the proposed folder with "Use this folder" or picks
 * another with "Choose…"; the renderer never sends a path of its own.
 */
export function SpacesFolderSection({
  spacesFolder,
  home,
  onUse,
  onChoose,
  busy,
}: Props): JSX.Element {
  const isSet = spacesFolder.value !== null;
  const path = spacesFolder.value ?? spacesFolder.proposed;
  return (
    <div style={rowCardStyle} data-testid="machine-row-spaces-folder">
      <p style={textStyle}>
        New Spaces are created in this folder. You can choose another folder for any one Space.
      </p>
      <code style={folderPathStyle} data-testid="machine-spaces-folder-path">
        {withHomeTilde(path, home)}
      </code>
      <div style={actionsStyle}>
        {isSet ? (
          <span style={readyStyle} aria-hidden="true">
            ✓
          </span>
        ) : (
          <button
            type="button"
            style={primaryButtonStyle}
            disabled={busy}
            data-testid="machine-spaces-folder-use"
            onClick={onUse}
          >
            Use this folder
          </button>
        )}
        <button
          type="button"
          style={secondaryButtonStyle}
          disabled={busy}
          data-testid="machine-spaces-folder-choose"
          onClick={onChoose}
        >
          Choose…
        </button>
      </div>
    </div>
  );
}

const textStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.85rem',
  color: 'var(--color-text)',
};

const actionsStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.6rem' };

const readyStyle: React.CSSProperties = { color: 'var(--color-success-fg)', fontWeight: 600 };
