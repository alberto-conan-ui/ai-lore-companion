import type { JSX, ReactNode } from 'react';

type Props = {
  /** The name of the screen or part, as the Human Lead will know it: "Machine check". */
  title: string;
  /** The phase that builds it: "M3.6". */
  phase: string;
  /** Used in the `data-testid`: `space-placeholder-<id>`. */
  id: string;
  /** A part inside a window takes the room it is given; a screen fills the window. */
  fill?: 'window' | 'parent';
  /** What the placeholder already offers, below the sentence. */
  children?: ReactNode;
};

/**
 * What stands where a 1.0 screen is not built yet. It says which screen it is
 * and which phase builds it, so that an app that is partly built is not taken
 * for one that is broken. The phase that builds the screen replaces the file
 * that renders this, and keeps that file's exported name and props.
 */
export function Placeholder({ title, phase, id, fill = 'window', children }: Props): JSX.Element {
  return (
    <main
      style={fill === 'window' ? windowStyle : parentStyle}
      data-testid={`space-placeholder-${id}`}
      data-phase={phase}
    >
      <div style={cardStyle}>
        <h1 style={titleStyle}>{title}</h1>
        <p style={sentenceStyle}>This screen is built in phase {phase}.</p>
        <p style={noteStyle}>It is not built yet. Nothing is broken.</p>
        {children}
      </div>
    </main>
  );
}

const baseStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  margin: 0,
  background: 'var(--color-shell)',
  color: 'var(--color-text)',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
};

const windowStyle: React.CSSProperties = { ...baseStyle, height: '100vh', width: '100vw' };

const parentStyle: React.CSSProperties = { ...baseStyle, height: '100%', width: '100%' };

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.4rem',
  maxWidth: '34rem',
  padding: '1.5rem',
  textAlign: 'center',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '1.1rem',
  fontWeight: 600,
  color: 'var(--color-text)',
};

const sentenceStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.9rem',
  color: 'var(--color-text-secondary)',
};

const noteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: 'var(--color-text-muted)',
};
