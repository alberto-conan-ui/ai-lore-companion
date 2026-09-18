import type { JSX } from 'react';
import type { SetupFlow, SpaceInitOf } from '../../../../shared/ipc.js';
import { errorAreaStyle, folderPathStyle, secondaryButtonStyle } from '../styles.js';
import { SetupForm } from './SetupForm.js';
import { SetupPlanView } from './SetupPlanView.js';
import { SetupProgressView } from './SetupProgressView.js';
import { useSetupFlow } from './useSetupFlow.js';

type Props = { init: SpaceInitOf<'setup'> };

const TITLES: Record<SetupFlow, string> = {
  create: 'Create a Space',
  adopt: 'Create a Space about this repository',
  open: 'Open a Space by GitHub address',
};

const SENTENCES: Record<SetupFlow, string> = {
  create:
    "The companion creates the Space repository and its Project on GitHub, makes the Space's folder from the Lore template and clones the repositories you list into repos/. A session writes the rest.",
  adopt:
    "The companion creates the Space repository and its Project on GitHub, makes the Space's folder from the Lore template, and clones the repository fresh from its origin into repos/.",
  open: 'The companion clones the Space repository, creates the Workbench and installs into Claude Code. Then it lists the repositories of the Space for you to confirm.',
};

/**
 * The create-a-Space screens, for the flow `init.start` names: the form, the
 * plan with an explicit confirmation, the progress of the steps, a failed step
 * with "Run again", and the end. Every folder, every command and every call to
 * GitHub is main's; this screen sends the form's texts.
 */
export function SetupScreen({ init }: Props): JSX.Element {
  const view = useSetupFlow(init.start);
  const { stage, flow } = view;

  return (
    <main
      style={screenStyle}
      data-testid="setup"
      data-flow={flow}
      data-stage={stage}
      aria-labelledby="setup-title"
    >
      <div style={columnStyle}>
        <header style={headerStyle}>
          <div style={headerTextStyle}>
            <h1 id="setup-title" style={titleStyle}>
              {TITLES[flow]}
            </h1>
            <p style={sentenceStyle}>{SENTENCES[flow]}</p>
          </div>
          {(stage === 'form' || stage === 'plan' || stage === 'loading') && (
            <button
              type="button"
              style={secondaryButtonStyle}
              data-testid="setup-to-welcome"
              onClick={() => void window.cockpit.spaceNavigate({ to: 'space-welcome' })}
            >
              Back to the welcome screen
            </button>
          )}
        </header>

        {view.interrupted !== null && stage === 'form' && (
          <p style={noticeStyle} data-testid="setup-interrupted">
            A run for <span style={folderPathStyle}>{view.interrupted.spaceRoot}</span> stopped when
            its window closed. To run again, fill in the same form, ask for the plan and confirm it:
            what was done is kept, and the run continues.
          </p>
        )}

        {stage === 'loading' && <p style={sentenceStyle}>Loading…</p>}
        {(stage === 'form' || stage === 'planning') && <SetupForm view={view} />}
        {stage === 'plan' && <SetupPlanView view={view} />}
        {(stage === 'running' ||
          stage === 'stopped' ||
          stage === 'failed' ||
          stage === 'finished') && <SetupProgressView view={view} />}

        {view.error !== null && (
          <p role="alert" style={errorAreaStyle} data-testid="setup-error">
            {view.error}
          </p>
        )}
      </div>
    </main>
  );
}

const screenStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  height: '100vh',
  width: '100vw',
  margin: 0,
  overflowY: 'auto',
  background: 'var(--color-shell)',
  color: 'var(--color-text)',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
};

const columnStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
  width: '100%',
  maxWidth: '46rem',
  padding: '1.5rem',
  boxSizing: 'border-box',
  height: 'max-content',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '1rem',
};

const headerTextStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
  minWidth: 0,
};

const titleStyle: React.CSSProperties = { margin: 0, fontSize: '1.1rem', fontWeight: 600 };

const sentenceStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.85rem',
  color: 'var(--color-text-secondary)',
};

const noticeStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.85rem',
  color: 'var(--color-warn-fg)',
};
