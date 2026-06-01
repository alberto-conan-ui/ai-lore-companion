import type { CSSProperties, JSX, ReactNode } from 'react';

/**
 * A thin notice bar shown at the top of a surface — the project's general
 * warnings / messages strip. The first consumer is layout restore (a restored
 * tab's "last session, this was running …" note), but it carries no
 * restore-specific knowledge: pass a `tone`, the message as children, and
 * optionally a primary `action` and a `✕` `onDismiss`.
 */
export type BannerTone = 'warn' | 'info' | 'error';

/** Per-tone colours. `warn` mirrors the strip's amber token in `TabbedPanel`. */
const TONES: Record<BannerTone, { bg: string; fg: string }> = {
  warn: { bg: '#7a5a14', fg: '#ffdf91' },
  info: { bg: '#13405e', fg: '#bfe3ff' },
  error: { bg: '#6e1f1f', fg: '#ffc9c9' },
};

export function Banner({
  tone = 'warn',
  children,
  action,
  onDismiss,
  testId = 'banner',
}: {
  tone?: BannerTone;
  children: ReactNode;
  /** Optional primary action button, left of the dismiss `✕`. */
  action?: { label: string; onClick: () => void };
  /** When set, a trailing `✕` dismisses the banner. */
  onDismiss?: () => void;
  testId?: string;
}): JSX.Element {
  const c = TONES[tone];
  return (
    <div
      style={{ ...barStyle, background: c.bg, color: c.fg }}
      data-testid={testId}
      data-tone={tone}
    >
      <span style={msgStyle}>{children}</span>
      {action ? (
        <button
          type="button"
          style={{ ...actionStyle, color: c.fg }}
          onClick={action.onClick}
          data-testid={`${testId}-action`}
        >
          {action.label}
        </button>
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          style={{ ...dismissStyle, color: c.fg }}
          onClick={onDismiss}
          aria-label="Dismiss"
          data-testid={`${testId}-dismiss`}
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}

const barStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  flexShrink: 0,
  padding: '0.35rem 0.6rem',
  fontSize: '0.78rem',
  lineHeight: 1.3,
};

const msgStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const actionStyle: CSSProperties = {
  flexShrink: 0,
  padding: '0.15rem 0.6rem',
  background: 'rgba(0, 0, 0, 0.22)',
  border: '1px solid currentColor',
  borderRadius: '4px',
  fontSize: '0.74rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const dismissStyle: CSSProperties = {
  flexShrink: 0,
  width: '1.3rem',
  height: '1.3rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  fontSize: '0.8rem',
  cursor: 'pointer',
  padding: 0,
};
