import { type JSX, useState } from 'react';
import type { SetRegisterArg } from '../../../shared/ipc.js';
import { PopoverShell } from './overlay/PopoverShell.js';

type Posture = 'chat' | 'plan' | 'reshape' | 'execute';
type Altitude = 'low' | 'mid' | 'high';
type Commitment = 'go' | 'neutral' | 'challenge';
type FocusType = 'build' | 'goal';

const POSTURE_OPTIONS: readonly Posture[] = ['chat', 'plan', 'reshape', 'execute'];
const ALTITUDE_OPTIONS: readonly Altitude[] = ['low', 'mid', 'high'];
const COMMITMENT_OPTIONS: readonly Commitment[] = ['go', 'neutral', 'challenge'];

/**
 * The cockpit header's AI-Lore conversational-register cluster.
 *
 * Four chips: posture, altitude, commitment, focus_type. The first three are
 * toggleable — clicking opens a popover with the methodology's stops; picking
 * one writes `status.index.md`'s frontmatter via `IPC.SetRegister` and the
 * next chain push refreshes the chip. Focus type is informational — toggling
 * a focus's type is an authoring move that belongs in the focus file itself.
 */
export function RegisterChips({
  posture,
  altitude,
  commitment,
  focusType,
}: {
  posture: Posture | null;
  altitude: Altitude | null;
  commitment: Commitment | null;
  focusType: FocusType | null;
}): JSX.Element {
  return (
    <div style={chipClusterStyle} data-testid="register-chips">
      <RegisterChip
        label="Posture"
        value={posture}
        options={POSTURE_OPTIONS}
        accent={POSTURE_ACCENT}
        testId="chip-posture"
        onPick={(next) => {
          void window.cockpit.setRegister({
            field: 'posture',
            value: next,
          } satisfies SetRegisterArg);
        }}
      />
      <RegisterChip
        label="Alt"
        value={altitude}
        options={ALTITUDE_OPTIONS}
        accent={DIAL_ACCENT}
        testId="chip-altitude"
        onPick={(next) => {
          void window.cockpit.setRegister({
            field: 'altitude',
            value: next,
          } satisfies SetRegisterArg);
        }}
      />
      <RegisterChip
        label="Cmt"
        value={commitment}
        options={COMMITMENT_OPTIONS}
        accent={DIAL_ACCENT}
        testId="chip-commitment"
        onPick={(next) => {
          void window.cockpit.setRegister({
            field: 'commitment',
            value: next,
          } satisfies SetRegisterArg);
        }}
      />
      <FocusTypeChip value={focusType} />
    </div>
  );
}

const POSTURE_ACCENT = 'var(--color-reg-posture)';
const DIAL_ACCENT = 'var(--color-reg-dial)';
const FOCUS_TYPE_ACCENT = 'var(--color-reg-focus)';

function RegisterChip<T extends string>({
  label,
  value,
  options,
  accent,
  testId,
  onPick,
}: {
  label: string;
  value: T | null;
  options: readonly T[];
  accent: string;
  testId: string;
  onPick: (next: T) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);

  const display = value ?? '—';
  return (
    <div style={chipWrapStyle}>
      <PopoverShell
        open={open}
        onOpenChange={setOpen}
        align="start"
        label={`${label} options`}
        testId={`${testId}-popover`}
        contentStyle={popoverStyle}
        trigger={
          <button
            type="button"
            data-testid={testId}
            title={`${label}: ${display}`}
            style={chipButtonStyle(accent)}
          >
            <span style={chipLabelStyle}>{label}</span>
            <span style={chipValueStyle(accent)}>{display}</span>
          </button>
        }
      >
        {options.map((option) => (
          <button
            key={option}
            type="button"
            data-testid={`${testId}-option-${option}`}
            onClick={() => {
              setOpen(false);
              onPick(option);
            }}
            style={popoverItemStyle(option === value, accent)}
          >
            {option}
          </button>
        ))}
      </PopoverShell>
    </div>
  );
}

function FocusTypeChip({ value }: { value: FocusType | null }): JSX.Element {
  const display = value ?? '—';
  return (
    <div
      data-testid="chip-focus-type"
      title={`Focus type: ${display}${value ? ' (set in the focus file, not the header)' : ''}`}
      style={{ ...chipButtonStyle(FOCUS_TYPE_ACCENT), cursor: 'default' }}
    >
      <span style={chipLabelStyle}>Focus</span>
      <span style={chipValueStyle(FOCUS_TYPE_ACCENT)}>{display}</span>
    </div>
  );
}

const chipClusterStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.35rem',
  flexShrink: 0,
};

const chipWrapStyle: React.CSSProperties = {
  position: 'relative',
};

function chipButtonStyle(_accent: string): React.CSSProperties {
  // The value text carries the accent; the border stays muted so the
  // header reads as a single calm row.
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    height: '1.55rem',
    padding: '0 0.55rem',
    background: 'var(--color-border)',
    color: 'var(--color-text-2)',
    border: '1px solid var(--color-border-strong)',
    borderRadius: '4px',
    fontSize: '0.72rem',
    fontWeight: 600,
    lineHeight: 1,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

const chipLabelStyle: React.CSSProperties = {
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

function chipValueStyle(accent: string): React.CSSProperties {
  return {
    color: accent,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  };
}

const popoverStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--color-header)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '5px',
  padding: '0.25rem',
  minWidth: '6rem',
  boxShadow: '0 6px 20px rgba(0, 0, 0, 0.4)',
};

function popoverItemStyle(selected: boolean, accent: string): React.CSSProperties {
  return {
    padding: '0.3rem 0.55rem',
    background: selected ? 'var(--color-border)' : 'transparent',
    color: selected ? accent : 'var(--color-text-2)',
    border: 'none',
    borderRadius: '3px',
    fontSize: '0.78rem',
    fontWeight: selected ? 700 : 500,
    lineHeight: 1.2,
    cursor: 'pointer',
    textAlign: 'left',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  };
}
