import type { JSX } from 'react';

/**
 * The left-region **activity rail** (AI Helper, CR9 Phase 3) — a slim vertical
 * icon rail, in the same WebStorm tool-window style as {@link ./SidebarTab.tsx},
 * that switches what the left region shows:
 *   - **Project** — the orientation panes (Status / Payload / Memory), which keep
 *     their own inner tab strip.
 *   - **Assistant** — the read-only {@link ./AssistantFeed.tsx} output.
 *
 * It's a switcher, not a toggle-to-closed: exactly one section is selected and
 * the left region is always visible. Both sections stay mounted (the App hides
 * the inactive one) so the Assistant feed keeps its history and its Channel-C
 * subscription while the user is in Project.
 */
export type LeftSection = 'project' | 'assistant';

export const LEFT_RAIL_WIDTH = 34;

export function LeftActivityRail({
  section,
  onSelect,
}: {
  section: LeftSection;
  onSelect: (s: LeftSection) => void;
}): JSX.Element {
  return (
    <div style={railStyle} data-testid="left-activity-rail">
      <RailButton
        id="project"
        label="Project"
        icon="▦"
        active={section === 'project'}
        onClick={() => onSelect('project')}
      />
      <RailButton
        id="assistant"
        label="Assistant"
        icon="✦"
        active={section === 'assistant'}
        onClick={() => onSelect('assistant')}
      />
    </div>
  );
}

function RailButton({
  id,
  label,
  icon,
  active,
  onClick,
}: {
  id: LeftSection;
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      style={active ? railIconActiveStyle : railIconStyle}
      title={label}
      aria-label={label}
      aria-pressed={active}
      data-testid={`left-rail-${id}`}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

const railStyle: React.CSSProperties = {
  flexShrink: 0,
  width: LEFT_RAIL_WIDTH,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  paddingTop: 6,
  gap: 4,
  background: 'var(--color-shell)',
  borderRight: '1px solid var(--color-border-rail)',
};

const railIconStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 5,
  color: 'var(--color-text-soft)',
  fontSize: '0.95rem',
  cursor: 'pointer',
  padding: 0,
};

const railIconActiveStyle: React.CSSProperties = {
  ...railIconStyle,
  background: 'var(--color-rail-active)',
  border: '1px solid var(--color-rail-border)',
  color: 'var(--color-text-2)',
};
