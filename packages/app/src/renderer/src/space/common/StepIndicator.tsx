import type { JSX } from 'react';
import { stepIndicatorStyle } from '../styles.js';

type Props = { current: 1 | 2 | 3 };

const STEPS = ['Details', 'Confirm', 'Create'] as const;

/**
 * The step indicator at the top of the setup screens: "1 Details · 2 Confirm
 * · 3 Create", plain text, the current step bright. It is not clickable;
 * "Back" moves back.
 */
export function StepIndicator({ current }: Props): JSX.Element {
  return (
    <p style={stepIndicatorStyle} data-testid="step-indicator">
      {STEPS.map((label, index) => {
        const step = index + 1;
        return (
          <span key={label} style={step === current ? currentStyle : undefined}>
            {index > 0 ? ' · ' : ''}
            {step} {label}
          </span>
        );
      })}
    </p>
  );
}

const currentStyle: React.CSSProperties = { color: 'var(--color-text-bright)' };
