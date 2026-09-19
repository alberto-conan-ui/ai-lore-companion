import { type JSX, type ReactNode, useState } from 'react';
import { disclosureStyle } from '../styles.js';

type Props = {
  label: string;
  testId: string;
  defaultOpen: boolean;
  children: ReactNode;
};

/**
 * A button that shows or hides its children, with `aria-expanded`. Used for
 * "Show all details", "Show every step" and the collapsed one-line sections
 * of Set up this computer.
 */
export function Disclosure({ label, testId, defaultOpen, children }: Props): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = `${testId}-content`;
  return (
    <div style={wrapStyle}>
      <button
        type="button"
        style={disclosureStyle}
        aria-expanded={open}
        aria-controls={contentId}
        data-testid={testId}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? '▾' : '▸'} {label}
      </button>
      {open && (
        <div id={contentId} data-testid={contentId}>
          {children}
        </div>
      )}
    </div>
  );
}

const wrapStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.5rem' };
