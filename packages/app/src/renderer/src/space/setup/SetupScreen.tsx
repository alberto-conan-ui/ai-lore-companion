import type { JSX } from 'react';
import type { SetupFlow, SpaceInitOf } from '../../../../shared/ipc.js';
import { StepIndicator } from '../common/StepIndicator.js';
import { errorAreaStyle } from '../styles.js';
import { SetupChecking } from './SetupChecking.js';
import { SetupForm } from './SetupForm.js';
import { SetupCompleteView, SetupPlanView } from './SetupPlanView.js';
import { SetupProgressView } from './SetupProgressView.js';
import { type SetupStage, basenameOf, useSetupFlow } from './useSetupFlow.js';

type Props = { init: SpaceInitOf<'setup'> };

const TITLES: Record<SetupFlow, string> = {
  create: 'New Space',
  adopt: 'Space from a repository on this computer',
  open: 'Space from GitHub',
};

const SENTENCES: Record<SetupFlow, string> = {
  create: 'A Space is a GitHub repository with a Project, and a folder on this computer.',
  open: 'Copies a Space that already exists on GitHub into a folder on this computer.',
  adopt: 'A new Space whose repositories include one you already have on this computer.',
};

function stepOf(stage: SetupStage): 1 | 2 | 3 {
  if (stage === 'plan' || stage === 'complete') return 2;
  if (stage === 'running' || stage === 'stopped' || stage === 'failed' || stage === 'finished') {
    return 3;
  }
  return 1;
}

/**
 * The create-a-Space screens, for the flow `init.start` names: the form with
 * its live "What will be created" block, the checking list, the
 * confirmation, the run with state words, and the result. Every folder, every
 * command and every call to GitHub is main's; this screen sends the form's
 * texts.
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
        <StepIndicator current={stepOf(stage)} />
        <header style={headerStyle}>
          <h1 id="setup-title" style={titleStyle}>
            {TITLES[flow]}
          </h1>
          <p style={sentenceStyle}>{SENTENCES[flow]}</p>
        </header>

        {view.interrupted !== null && stage === 'form' && (
          <p style={noticeStyle} data-testid="setup-interrupted">
            Creating {basenameOf(view.interrupted.spaceRoot)} stopped when its window closed. The
            form is filled in again; Continue finishes it.
          </p>
        )}

        {stage === 'loading' && <p style={sentenceStyle}>Loading…</p>}
        {(stage === 'form' || stage === 'checking') && <SetupForm view={view} />}
        {stage === 'checking' && <SetupChecking view={view} />}
        {stage === 'plan' && <SetupPlanView view={view} />}
        {stage === 'complete' && <SetupCompleteView view={view} />}
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
  flexDirection: 'column',
  gap: '0.3rem',
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
