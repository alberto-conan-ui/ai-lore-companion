import type { JSX } from 'react';
import type { SpaceInitOf } from '../../../../shared/ipc.js';
import { TerminalTab } from '../../components/TerminalTab.js';
import {
  errorAreaStyle,
  folderPathStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../styles.js';
import { useWindowRequest } from '../useWindowRequest.js';

type Props = { init: SpaceInitOf<'not-a-space'> };

/**
 * The screen of a folder that is neither a Space nor an AI-Lore project of
 * v0.8 or older. It says what detection found, in detection's own sentence,
 * and gives a terminal rooted at the folder. A plain git repository also gets
 * the offer to create a Space about it; the folder itself is left alone, and
 * main takes it from its own record of this window, not from this screen.
 */
export function NotASpaceScreen({ init }: Props): JSX.Element {
  const { run, busy, error } = useWindowRequest();
  return (
    <div style={layoutStyle} data-testid="not-a-space">
      <div style={bannerStyle}>
        <div style={messageStyle}>
          <div>
            <strong style={{ color: 'var(--color-warn-fg)' }}>
              {init.plainRepository
                ? 'This folder is a git repository, not a Space.'
                : 'This folder is not a Space.'}
            </strong>{' '}
            <span style={folderPathStyle} data-testid="not-a-space-folder">
              {init.folder}
            </span>
          </div>
          <div style={hintStyle} data-testid="not-a-space-reason">
            {init.reason}
          </div>
          {init.plainRepository && (
            <div style={hintStyle}>
              A Space can be created about this repository. The repository is cloned into the new
              Space, and this folder is left as it is.
            </div>
          )}
          {error !== null && (
            <p style={errorAreaStyle} role="alert" data-testid="not-a-space-error">
              {error}
            </p>
          )}
        </div>
        <div style={actionsStyle}>
          {init.plainRepository && (
            <button
              type="button"
              style={primaryButtonStyle}
              disabled={busy}
              data-testid="not-a-space-create"
              onClick={() =>
                void run(() =>
                  window.cockpit.spaceNavigate({ to: 'setup', start: 'about-this-folder' }),
                )
              }
            >
              Create a Space about it
            </button>
          )}
          <button
            type="button"
            style={secondaryButtonStyle}
            disabled={busy}
            data-testid="not-a-space-open"
            onClick={() => void run(() => window.cockpit.spaceOpenFolder({}))}
          >
            Open another folder…
          </button>
          <button
            type="button"
            style={secondaryButtonStyle}
            disabled={busy}
            data-testid="not-a-space-reload"
            onClick={() => void window.cockpit.reload()}
          >
            Check again
          </button>
        </div>
      </div>
      <TerminalTab active />
    </div>
  );
}

const layoutStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  width: '100vw',
  margin: 0,
  background: 'var(--color-shell)',
  color: 'var(--color-text)',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
};

const bannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '1rem',
  padding: '0.7rem 1rem',
  background: 'var(--color-warn-banner-bg)',
  borderBottom: '1px solid var(--color-warn-banner-border)',
};

const messageStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  minWidth: 0,
  fontSize: '0.85rem',
};

const hintStyle: React.CSSProperties = {
  color: 'var(--color-text-secondary)',
  fontSize: '0.8rem',
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  flexShrink: 0,
  gap: '0.5rem',
};
