import type { JSX } from 'react';
import { errorAreaStyle, secondaryButtonStyle } from '../styles.js';
import { useWindowRequest } from '../useWindowRequest.js';

/**
 * The action "Open in the v0.8 cockpit" of the migration screen. It opens this
 * window's folder the way the app opens a folder without detection routing, so
 * that daily work in v0.8 stays possible from a 1.0 build until this project
 * is switched. It sends no path: main uses the folder it recorded for this
 * window. Built in phase M3.5; phase M6.5 keeps it on the screen it builds.
 */
export function OpenInCockpitButton(): JSX.Element {
  const { run, busy, error } = useWindowRequest();
  return (
    <div style={wrapStyle}>
      <button
        type="button"
        style={secondaryButtonStyle}
        disabled={busy}
        data-testid="migration-open-in-cockpit"
        onClick={() => void run(() => window.cockpit.spaceOpenInCockpit({}))}
      >
        Open in the v0.8 cockpit
      </button>
      {error !== null && (
        <p style={errorAreaStyle} role="alert" data-testid="migration-open-in-cockpit-error">
          {error}
        </p>
      )}
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.4rem',
};
