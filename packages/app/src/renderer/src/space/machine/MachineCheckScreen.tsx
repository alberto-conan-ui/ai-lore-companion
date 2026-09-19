import { type JSX, useEffect, useRef, useState } from 'react';
import type {
  MachineCheck,
  MachineCheckReport,
  MachineSection,
  SpaceInitOf,
} from '../../../../shared/ipc.js';
import { CommandPanel } from '../common/CommandPanel.js';
import {
  disclosureStyle,
  errorAreaStyle,
  hintStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../styles.js';
import { useWindowRequest } from '../useWindowRequest.js';
import { EnginesSection } from './EnginesSection.js';
import { GitHubSection } from './GitHubSection.js';
import { SpacesFolderSection } from './SpacesFolderSection.js';
import { ToolsSection } from './ToolsSection.js';
import {
  claudeEngine,
  enginesCollapsedLine,
  enginesFine,
  githubCollapsedLine,
  githubFine,
  leftSentence,
  requirementById,
  spacesFolderCollapsedLine,
  spacesFolderFine,
  toolsCollapsedLine,
  toolsFine,
} from './machineText.js';
import { useMachineCheck } from './useMachineCheck.js';

type Props = { init: SpaceInitOf<'machine-check'> };

type ActiveCommand = { commandId: string; commandLine: string };

const SECTION_IDS = ['tools', 'github', 'engines', 'spaces-folder'] as const;

/** Whether the search for a requirement's binary on the login shell's `PATH` came back empty or unsure. */
function notFoundOnPath(check: MachineCheck): boolean {
  const missing = (id: 'git' | 'python3' | 'gh'): boolean => {
    const kind = requirementById(check, id)?.state.kind;
    return kind === 'missing' || kind === 'undetermined';
  };
  const claude = claudeEngine(check);
  const claudeMissing =
    claude === undefined ||
    claude.installed.kind === 'missing' ||
    claude.installed.kind === 'undetermined';
  return missing('git') || missing('python3') || missing('gh') || claudeMissing;
}

/**
 * Set up this computer (architecture document A.12, M9.8): the four sections
 * of tools, GitHub, AI engines and the Spaces folder, each with a button that
 * fixes what is not ready, and the command panel the buttons run in.
 *
 * The companion runs install and sign-in commands itself, on a click, in a
 * terminal panel of this window: the Human Lead sees every line and answers
 * every question, and nothing runs without a click.
 */
export function MachineCheckScreen({ init }: Props): JSX.Element {
  const view = useMachineCheck({ freshOnMount: true });
  const { run, busy } = useWindowRequest();
  const { report, checking, error, checkAgain } = view;

  const [activeCommand, setActiveCommand] = useState<ActiveCommand | null>(null);
  const [forceOpen, setForceOpen] = useState<Record<string, boolean>>(() =>
    init.section === undefined ? {} : { [init.section]: true },
  );
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);

  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || init.section === undefined || report === null) return;
    scrolled.current = true;
    sectionRefs.current[init.section]?.scrollIntoView?.({ block: 'start' });
  }, [init.section, report]);

  const toggleSection = (id: MachineSection): void => setForceOpen((s) => ({ ...s, [id]: true }));

  const runCommand = (commandId: string): void => {
    if (report === null) return;
    setActiveCommand({ commandId, commandLine: report.commands[commandId] ?? '' });
  };

  const openUrl = (url: string): void => window.cockpit.urlOpenExternal(url);

  const useFolder = async (): Promise<void> => {
    setFolderBusy(true);
    setFolderError(null);
    try {
      const result = await window.cockpit.spaceSpacesFolderUse({});
      if (!result.ok && result.error.kind !== 'cancelled') setFolderError(result.error.message);
    } catch (caught) {
      setFolderError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setFolderBusy(false);
      checkAgain();
    }
  };

  const chooseFolder = async (): Promise<void> => {
    setFolderBusy(true);
    setFolderError(null);
    try {
      const result = await window.cockpit.spaceSpacesFolderChoose({});
      if (!result.ok && result.error.kind !== 'cancelled') setFolderError(result.error.message);
    } catch (caught) {
      setFolderError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setFolderBusy(false);
      checkAgain();
    }
  };

  const overallReady = report?.setUp.ready ?? null;

  return (
    <main style={screenStyle} data-testid="machine-check" aria-labelledby="machine-check-title">
      <div style={columnStyle}>
        <header style={headerStyle}>
          <div style={headerTextStyle}>
            <h1 id="machine-check-title" style={titleStyle}>
              Set up this computer
            </h1>
            <p style={sentenceStyle}>
              AI-Lore uses these tools on this computer. Items marked Required must be ready before
              you create a Space. A button runs its command in the panel at the bottom of this page,
              where you see what it prints and answer its questions.
            </p>
          </div>
          <button
            type="button"
            style={secondaryButtonStyle}
            disabled={busy}
            data-testid="machine-check-back"
            onClick={() => void run(() => window.cockpit.spaceNavigate({ to: 'space-welcome' }))}
          >
            Back
          </button>
        </header>

        <output
          style={overallStyle(overallReady)}
          data-testid="machine-check-overall"
          data-ready={overallReady === null ? 'unknown' : String(overallReady)}
        >
          {report === null
            ? 'Checking this computer…'
            : overallReady
              ? 'This computer is ready.'
              : ''}
        </output>

        {error !== null && (
          <p style={errorAreaStyle} role="alert" data-testid="machine-check-error">
            The machine check did not run. {error}
          </p>
        )}
        {folderError !== null && (
          <p style={errorAreaStyle} role="alert" data-testid="machine-check-folder-error">
            {folderError}
          </p>
        )}

        {report !== null && (
          <>
            <Section
              id="tools"
              heading="Tools"
              open={
                forceOpen.tools === true || !toolsFine(report.check) || init.section === 'tools'
              }
              collapsedLine={toolsCollapsedLine(report.check)}
              onShow={() => toggleSection('tools')}
              refCallback={(el) => {
                sectionRefs.current.tools = el;
              }}
            >
              <ToolsSection
                check={report.check}
                onRunCommand={runCommand}
                onOpenUrl={openUrl}
                commandsBusy={activeCommand !== null}
              />
            </Section>

            <Section
              id="github"
              heading="GitHub"
              open={
                forceOpen.github === true || !githubFine(report.check) || init.section === 'github'
              }
              collapsedLine={githubCollapsedLine(report.check)}
              onShow={() => toggleSection('github')}
              refCallback={(el) => {
                sectionRefs.current.github = el;
              }}
            >
              <GitHubSection
                check={report.check}
                onRunCommand={runCommand}
                onCheckAgain={checkAgain}
                commandsBusy={activeCommand !== null}
              />
            </Section>

            <Section
              id="engines"
              heading="AI engines"
              open={
                forceOpen.engines === true ||
                !enginesFine(report.check) ||
                init.section === 'engines'
              }
              collapsedLine={enginesCollapsedLine()}
              onShow={() => toggleSection('engines')}
              refCallback={(el) => {
                sectionRefs.current.engines = el;
              }}
            >
              <EnginesSection
                check={report.check}
                onRunCommand={runCommand}
                onOpenUrl={openUrl}
                commandsBusy={activeCommand !== null}
              />
            </Section>

            <Section
              id="spaces-folder"
              heading="Spaces folder"
              open={
                forceOpen['spaces-folder'] === true ||
                !spacesFolderFine(report.spacesFolder) ||
                init.section === 'spaces-folder'
              }
              collapsedLine={spacesFolderCollapsedLine(report.spacesFolder)}
              onShow={() => toggleSection('spaces-folder')}
              refCallback={(el) => {
                sectionRefs.current['spaces-folder'] = el;
              }}
            >
              <SpacesFolderSection
                spacesFolder={report.spacesFolder}
                onUse={() => void useFolder()}
                onChoose={() => void chooseFolder()}
                busy={folderBusy}
              />
            </Section>

            {notFoundOnPath(report.check) && (
              <p style={noteStyle} data-testid="machine-check-path-source">
                {report.pathSource === 'login-shell'
                  ? "Searched the folders of your login shell's PATH."
                  : "The login shell's PATH could not be read, so the search used the app's own PATH."}
              </p>
            )}

            {activeCommand !== null && (
              <CommandPanel
                commandId={activeCommand.commandId}
                commandLine={activeCommand.commandLine}
                onExit={() => checkAgain()}
                onClose={() => setActiveCommand(null)}
              />
            )}

            <footer style={footerStyle}>
              {report.setUp.ready ? (
                <button
                  type="button"
                  style={primaryButtonStyle}
                  data-testid="machine-check-continue"
                  onClick={() =>
                    void run(() => window.cockpit.spaceNavigate({ to: 'space-welcome' }))
                  }
                >
                  Continue
                </button>
              ) : (
                <button
                  type="button"
                  style={primaryButtonStyle}
                  disabled
                  aria-describedby="machine-check-left"
                  data-testid="machine-check-continue"
                >
                  Continue
                </button>
              )}
              <button
                type="button"
                style={disclosureStyle}
                disabled={checking}
                data-testid="machine-check-again"
                onClick={checkAgain}
              >
                {checking ? 'Checking…' : 'Check all again'}
              </button>
            </footer>
            {!report.setUp.ready && (
              <p id="machine-check-left" style={hintStyle} data-testid="machine-check-left">
                {leftSentence(report.setUp)}
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function Section({
  id,
  heading,
  open,
  collapsedLine,
  onShow,
  refCallback,
  children,
}: {
  id: MachineSection;
  heading: string;
  open: boolean;
  collapsedLine: string;
  onShow: () => void;
  refCallback: (el: HTMLElement | null) => void;
  children: React.ReactNode;
}): JSX.Element {
  const headingId = `machine-section-${id}-heading`;
  return (
    <section
      ref={refCallback}
      style={sectionStyle}
      aria-labelledby={headingId}
      data-testid={`machine-section-${id}`}
    >
      <h2 id={headingId} style={sectionHeadingStyle}>
        {heading}
      </h2>
      {open ? (
        children
      ) : (
        <div style={collapsedRowStyle}>
          <span style={collapsedTextStyle}>{collapsedLine}</span>
          <button
            type="button"
            style={disclosureStyle}
            data-testid={`machine-section-${id}-toggle`}
            onClick={onShow}
          >
            Show
          </button>
        </div>
      )}
    </section>
  );
}

function overallStyle(ready: boolean | null): React.CSSProperties {
  const color =
    ready === null
      ? 'var(--color-text-secondary)'
      : ready
        ? 'var(--color-success-fg)'
        : 'var(--color-text)';
  return { margin: 0, fontSize: '0.95rem', fontWeight: 600, color };
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
  gap: '0.9rem',
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

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
};

const sectionHeadingStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.95rem',
  fontWeight: 600,
};

const collapsedRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.6rem',
  padding: '0.6rem 0.8rem',
  background: 'var(--color-shell-deep)',
  border: '1px solid var(--color-border)',
  borderRadius: '6px',
};

const collapsedTextStyle: React.CSSProperties = {
  fontSize: '0.85rem',
  color: 'var(--color-success-fg)',
};

const footerStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.8rem' };

const noteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.75rem',
  color: 'var(--color-text-muted)',
};
