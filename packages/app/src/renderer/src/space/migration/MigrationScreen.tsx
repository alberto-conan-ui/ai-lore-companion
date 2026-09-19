import type { JSX } from 'react';
import type { LegacySummary, SpaceInitOf } from '../../../../shared/ipc.js';
import { errorAreaStyle, folderPathStyle } from '../styles.js';
import { MigrationPlanView } from './MigrationPlanView.js';
import { MigrationProgressView } from './MigrationProgressView.js';
import { OpenInCockpitButton } from './OpenInCockpitButton.js';
import { useMigrationFlow } from './useMigrationFlow.js';

type Props = { init: SpaceInitOf<'migration'> };

/** The sentence of the older-than-v0.8 state. Nothing else is offered in that state. */
export function upgradeFirstSentence(legacy: LegacySummary): string {
  const version = legacy.coreVersion ?? 'unknown';
  return `${legacy.projectName} is an AI-Lore project of core version ${version}. The companion migrates AI-Lore v0.8 projects only. Upgrade this project to v0.8 first, with AI-Lore v0.8, then open this folder again.`;
}

/**
 * The migration screen: what a folder that is an AI-Lore project of v0.8 or
 * older opens in. A project older than v0.8 gets one sentence: upgrade to v0.8
 * first. A v0.8 project gets the source, the fields, the plan with an explicit
 * confirmation, the progress of the thirteen steps, and at the end the
 * verification result and "Open the Space". Every folder, every command and
 * every call to GitHub is main's; this screen sends the form's texts.
 */
export function MigrationScreen({ init }: Props): JSX.Element {
  const { legacy } = init;
  return (
    <main style={screenStyle} data-testid="migration" aria-labelledby="migration-title">
      <div style={columnStyle}>
        <header style={headerStyle}>
          <h1 id="migration-title" style={titleStyle}>
            Migrate {legacy.projectName} from AI-Lore v0.8
          </h1>
          <p style={folderPathStyle} data-testid="migration-folder">
            {init.folder}
          </p>
        </header>
        {legacy.versionStanding === 'older' ? (
          <p style={sentenceStyle} data-testid="migration-upgrade-first">
            {upgradeFirstSentence(legacy)}
          </p>
        ) : legacy.migratable ? (
          <MigrationFlow />
        ) : (
          <>
            <p style={sentenceStyle} data-testid="migration-reason">
              {legacy.reason}
            </p>
            <OpenInCockpitButton />
          </>
        )}
      </div>
    </main>
  );
}

function MigrationFlow(): JSX.Element {
  const view = useMigrationFlow();
  const { stage } = view;
  return (
    <div style={flowStyle} data-testid="migration-flow" data-stage={stage}>
      {view.interrupted !== null && (stage === 'plan' || stage === 'planning') && (
        <p style={noticeStyle} data-testid="migration-interrupted">
          A migration into <span style={folderPathStyle}>{view.interrupted.spaceRoot}</span> stopped
          when its window closed. What it did is kept. Make the plan with the same fields and
          confirm it: the steps that are done are not repeated, and the run continues.
        </p>
      )}
      {view.runningElsewhere && (
        <p style={noticeStyle} data-testid="migration-running-elsewhere">
          A migration of this folder runs in another window. It cannot be run here until it ends.
        </p>
      )}
      {stage === 'loading' && <p style={sentenceStyle}>Loading…</p>}
      {(stage === 'plan' || stage === 'planning') && <MigrationPlanView view={view} />}
      {(stage === 'plan' || stage === 'planning') && <OpenInCockpitButton />}
      {(stage === 'running' ||
        stage === 'stopped' ||
        stage === 'failed' ||
        stage === 'finished') && <MigrationProgressView view={view} />}
      {view.error !== null && (
        <p role="alert" style={errorAreaStyle} data-testid="migration-error">
          {view.error}
        </p>
      )}
    </div>
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
  maxWidth: '56rem',
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
const flowStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '1rem' };
const sentenceStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.9rem',
  color: 'var(--color-text-secondary)',
};
const noticeStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.85rem',
  color: 'var(--color-warn-fg)',
};
