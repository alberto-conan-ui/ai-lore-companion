import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import { useXtermSession } from '../../components/useXtermSession.js';
import { errorAreaStyle, secondaryButtonStyle } from '../styles.js';

type Props = {
  /** The id of the command being run, one of `setupCommands()`. */
  commandId: string;
  /** The literal command line, shown above the terminal so the Human Lead sees it before it runs. */
  commandLine: string;
  /** Called once when the command's exit is pushed. */
  onExit: (exitCode: number) => void;
  /** Called when the Close button is pressed. */
  onClose: () => void;
};

const MONOSPACE = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * The terminal panel of architecture document A.8: runs one command of
 * core's `setupCommands()` in a PTY of this window and streams its output, so
 * the Human Lead sees every line the command prints and answers any question
 * it asks. The renderer never builds a command line itself; `commandId` names
 * a fixed entry of a list main already knows, and `spaceCommandRun` looks up
 * its command line.
 *
 * When main finds a GitHub one-time code in the command's output, it is shown
 * above the terminal with a copy button, because `gh auth login --clipboard`
 * already puts it on the clipboard and the sentence says so.
 */
export function CommandPanel({ commandId, commandLine, onExit, onClose }: Props): JSX.Element {
  const [ptyId, setPtyId] = useState<string | null>(null);
  const [spawnError, setSpawnError] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const spawn = useCallback(async (): Promise<string | null> => {
    const result = await window.cockpit.spaceCommandRun({ commandId });
    if (!result.ok) {
      setSpawnError(result.error.message);
      return null;
    }
    setPtyId(result.value.ptyId);
    return result.value.ptyId;
  }, [commandId]);

  const { hostRef } = useXtermSession({
    active: true,
    spawn,
    killOnUnmount: true,
    exitMessage: '[the command ended]',
  });

  useEffect(() => {
    if (ptyId === null) return undefined;
    const offExit = window.cockpit.onSpaceCommandExit((payload) => {
      if (payload.ptyId !== ptyId) return;
      setExitCode((current) => (current !== null ? current : payload.exitCode));
    });
    const offCode = window.cockpit.onSpaceCommandCode((payload) => {
      if (payload.ptyId === ptyId) setCode(payload.code);
    });
    return () => {
      offExit();
      offCode();
    };
  }, [ptyId]);

  // `onExit` is called from its own effect, not from inside the `setExitCode` updater above: an
  // updater must stay pure, and calling a parent's `setState` from it warns React ("cannot update a
  // component while rendering a different component").
  const exitReported = useRef(false);
  useEffect(() => {
    if (exitCode !== null && !exitReported.current) {
      exitReported.current = true;
      onExit(exitCode);
    }
  }, [exitCode, onExit]);

  const copyCode = (): void => {
    if (code === null) return;
    void navigator.clipboard.writeText(code);
    setCopied(true);
  };

  return (
    <div style={panelStyle} data-testid="command-panel">
      <div style={headerStyle}>
        <code style={commandLineStyle} data-testid="command-panel-command">
          Running: {commandLine}
        </code>
        <button
          type="button"
          style={secondaryButtonStyle}
          data-testid="command-panel-close"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      <output
        style={statusStyle(exitCode)}
        data-testid="command-panel-status"
        data-state={exitCode === null ? 'running' : 'exited'}
      >
        {exitCode === null
          ? ''
          : exitCode === 0
            ? 'Finished.'
            : `Ended with exit code ${exitCode}.`}
      </output>

      {spawnError !== null && (
        <p style={errorAreaStyle} role="alert" data-testid="command-panel-error">
          {spawnError}
        </p>
      )}

      {code !== null && (
        <div style={codeBoxStyle} data-testid="command-panel-code">
          <p style={codeLineStyle}>First copy your one-time code:</p>
          <div style={codeValueStyle} data-testid="command-panel-code-value">
            {code}
          </div>
          <button
            type="button"
            style={secondaryButtonStyle}
            data-testid="command-panel-copy-code"
            onClick={copyCode}
          >
            Copy code
          </button>
          <p style={codeLineStyle}>
            Paste this code on the GitHub page that opened in your browser. It is already on the
            clipboard.
          </p>
          {copied && <span style={copiedStyle}>Copied.</span>}
        </div>
      )}

      <div ref={hostRef} style={hostStyle} data-testid="command-panel-terminal" />
    </div>
  );
}

function statusStyle(exitCode: number | null): React.CSSProperties {
  const color =
    exitCode === null
      ? 'var(--color-text-secondary)'
      : exitCode === 0
        ? 'var(--color-success-fg)'
        : 'var(--color-danger-fg)';
  return { margin: 0, fontSize: '0.82rem', fontWeight: 600, color };
}

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
  padding: '0.8rem 0.9rem',
  background: 'var(--color-code-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: '6px',
  boxSizing: 'border-box',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.6rem',
};

const commandLineStyle: React.CSSProperties = {
  fontFamily: MONOSPACE,
  fontSize: '0.8rem',
  color: 'var(--color-text)',
  wordBreak: 'break-all',
  userSelect: 'text',
};

const codeBoxStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
  padding: '0.7rem 0.85rem',
  background: 'var(--color-shell-deep)',
  border: '1px solid var(--color-border)',
  borderRadius: '6px',
};

const codeLineStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: 'var(--color-text-secondary)',
};

const codeValueStyle: React.CSSProperties = {
  fontFamily: MONOSPACE,
  fontSize: '1.4rem',
  fontWeight: 600,
  color: 'var(--color-text-bright)',
  userSelect: 'text',
};

const copiedStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--color-text-secondary)',
};

const hostStyle: React.CSSProperties = { height: '14rem', width: '100%' };
