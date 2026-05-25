import type { JSX, ReactNode } from 'react';

type Props = {
  /** Inline glyph rendered to the left of the label — e.g. `⚙`, `↗`. */
  icon: string;
  /** The button label — kept visible (no demote-to-tooltip). */
  label: ReactNode;
  onClick: () => void;
  title?: string;
  testId?: string;
};

/** Shared height for header action controls — uniform toolbar. */
export const ACTION_BUTTON_HEIGHT = '1.85rem';

/**
 * The uniform action button used across the cockpit header toolbar — Settings,
 * Shortcuts, Finder. One height, one padding, one border colour, one font
 * weight. The drift cluster (DriftPill + Ack all) matches its height but keeps
 * its own visual identity, by design.
 */
export function ActionButton({ icon, label, onClick, title, testId }: Props): JSX.Element {
  return (
    <button type="button" style={style} data-testid={testId} title={title} onClick={onClick}>
      <span aria-hidden style={iconStyle}>
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

const style: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.35rem',
  height: ACTION_BUTTON_HEIGHT,
  padding: '0 0.65rem',
  background: 'transparent',
  color: '#cbd5dd',
  border: '1px solid #2f3a45',
  borderRadius: '5px',
  fontSize: '0.78rem',
  fontWeight: 600,
  lineHeight: 1,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

const iconStyle: React.CSSProperties = {
  fontSize: '0.85rem',
  lineHeight: 1,
};
