import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type BaselineModel,
  type Milestone,
  activeMilestoneId,
  buildMilestones,
  findMilestone,
} from '../../../shared/baseline.js';
import { useCockpitStore } from '../store.js';
import { CommitRow, formatStamp, shortSha } from './CommitRow.js';

/**
 * The global baseline picker — one control beside the pinned tabs that drives
 * the Changes baseline for **every** pane at once (Payload + the lore-backed
 * Status/Memory). It replaces the per-pane dropdowns.
 *
 * Save-points are the default list (the mask); a tickbox reveals the acks
 * underneath. Selecting any milestone resolves a baseline for *both* repos
 * (the mask math lives in [shared/baseline.ts](../../../shared/baseline.ts))
 * and applies it to both scopes via `setBaseline`.
 */
export function BaselinePicker(): JSX.Element {
  const savePoints = useCockpitStore((s) => s.savePoints);
  const payloadCommits = useCockpitStore((s) => s.commitListByScope.payload);
  const loreCommits = useCockpitStore((s) => s.commitListByScope.lore);
  const baselineByScope = useCockpitStore((s) => s.baselineByScope);
  const storeSetBaseline = useCockpitStore((s) => s.setBaseline);

  const [open, setOpen] = useState(false);
  // Roll up ACKs (default on): each save-point folds in the ack it's bound to
  // and selects that ack. Off → acks un-roll into the timeline and a save-point
  // selects its own commit. Renaming/inverting the old "include acks" toggle.
  const [rollup, setRollup] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  const model = useMemo<BaselineModel>(
    () => buildMilestones({ savePoints, payloadCommits, loreCommits }, rollup),
    [savePoints, payloadCommits, loreCommits, rollup],
  );

  // What the live baseline resolves to. With rollup on, a save-point and its
  // bound ack share a commit, so a baseline alone is ambiguous —
  // `activeMilestoneId` scans save-points first.
  const derivedActiveId = useMemo(
    () => activeMilestoneId(model, baselineByScope),
    [model, baselineByScope],
  );
  // An explicit click wins over the derived match (so clicking that newest ack
  // highlights the ack, not its save-point) — until the live baseline moves to
  // something the pick no longer matches (e.g. follow-latest), then we defer to
  // the derived id again.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const activeId = useMemo(() => {
    if (pickedId) {
      const picked = findMilestone(model, pickedId);
      if (
        picked &&
        picked.payloadBaseline === baselineByScope.payload &&
        picked.loreBaseline === baselineByScope.lore
      ) {
        return pickedId;
      }
    }
    return derivedActiveId;
  }, [pickedId, model, baselineByScope, derivedActiveId]);
  const active = activeId ? findMilestone(model, activeId) : null;

  // One chronological timeline (newest first). Rolled up → save-points only;
  // un-rolled → acks slot between the save-points by date.
  const rows = useMemo(() => {
    const list = rollup ? model.savePoints : [...model.savePoints, ...model.acks];
    return list.slice().sort((a, b) => b.timestamp - a.timestamp);
  }, [model, rollup]);

  // Apply one logical milestone to both repos — store mirror + main tracker.
  const select = useCallback(
    (m: Milestone) => {
      setPickedId(m.id);
      storeSetBaseline('payload', m.payloadBaseline);
      storeSetBaseline('lore', m.loreBaseline);
      void window.cockpit.setBaseline({ scope: 'payload', baseline: m.payloadBaseline });
      void window.cockpit.setBaseline({ scope: 'lore', baseline: m.loreBaseline });
      setOpen(false);
    },
    [storeSetBaseline],
  );

  // Dismiss on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const buttonLabel = active ? active.label : 'Working tree';
  const buttonDate = active ? formatStamp(active.timestamp) : '';

  return (
    <div ref={rootRef} style={rootStyle}>
      <button
        type="button"
        style={triggerStyle}
        data-testid="baseline-picker"
        title="Compare every pane against this milestone"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span style={triggerIconStyle} aria-hidden="true">
          {active?.kind === 'ack' ? '•' : '★'}
        </span>
        <span style={triggerLabelStyle}>{buttonLabel}</span>
        {active ? <span style={triggerShaStyle}>{shortSha(active.commitSha)}</span> : null}
        {buttonDate ? <span style={triggerDateStyle}>{buttonDate}</span> : null}
        <span style={caretStyle} aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div style={popoverStyle} data-testid="baseline-picker-popover">
          <label style={ackToggleStyle}>
            <input
              type="checkbox"
              checked={rollup}
              onChange={(e) => setRollup(e.target.checked)}
              data-testid="baseline-rollup-acks"
            />
            Roll up ACKs
            <span style={ackToggleHintStyle}>
              {rollup ? 'save-points show their bound ack' : 'acks shown individually'}
            </span>
          </label>
          <div style={listStyle}>
            {rows.length === 0 ? <div style={emptyStyle}>No save-points or acks yet.</div> : null}
            {rows.map((m) => (
              <Row
                key={m.id}
                m={m}
                active={m.id === activeId}
                showBound={rollup}
                onSelect={select}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Row({
  m,
  active,
  showBound,
  onSelect,
}: {
  m: Milestone;
  active: boolean;
  /** Show the bound ack beneath a save-point (rollup mode). */
  showBound: boolean;
  onSelect: (m: Milestone) => void;
}): JSX.Element {
  return (
    <CommitRow
      kind={m.kind}
      label={m.label}
      sha={m.commitSha}
      timestamp={m.timestamp}
      active={active}
      testId={`baseline-option-${m.id}`}
      onClick={() => onSelect(m)}
    >
      {showBound && m.boundAck ? (
        <span style={boundAckStyle}>
          <span style={boundArrowStyle}>↳</span>
          <span style={boundDotStyle}>•</span>
          <span style={boundLabelStyle}>{m.boundAck.label}</span>
          <span style={boundShaStyle}>{shortSha(m.boundAck.sha)}</span>
          <span style={boundDateStyle}>{formatStamp(m.boundAck.timestamp)}</span>
        </span>
      ) : null}
    </CommitRow>
  );
}

const rootStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  marginLeft: 'auto',
  paddingRight: '0.3rem',
};

const triggerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  maxWidth: '22rem',
  height: '1.7rem',
  padding: '0 0.55rem',
  background: 'var(--color-panel)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '5px',
  color: 'var(--color-text)',
  fontSize: '0.72rem',
  cursor: 'pointer',
};

const triggerIconStyle: React.CSSProperties = { color: 'var(--color-amber)', flex: 'none' };

const triggerLabelStyle: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontWeight: 600,
};

const triggerShaStyle: React.CSSProperties = {
  flex: 'none',
  color: 'var(--color-text-soft)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.66rem',
};

const triggerDateStyle: React.CSSProperties = { color: 'var(--color-text-muted)', flex: 'none' };

const caretStyle: React.CSSProperties = { color: 'var(--color-text-muted)', flex: 'none', fontSize: '0.65rem' };

const popoverStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  right: 0,
  zIndex: 60,
  width: '44rem',
  maxWidth: '92vw',
  maxHeight: '60vh',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--color-raised)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '6px',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
  overflow: 'hidden',
};

const ackToggleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.5rem 0.7rem',
  borderBottom: '1px solid var(--color-border)',
  color: 'var(--color-text-secondary)',
  fontSize: '0.72rem',
  cursor: 'pointer',
};

const ackToggleHintStyle: React.CSSProperties = {
  color: 'var(--color-text-muted)',
  fontStyle: 'italic',
};

const listStyle: React.CSSProperties = {
  overflowY: 'auto',
  minHeight: 0,
  padding: '0.25rem',
};

const emptyStyle: React.CSSProperties = {
  padding: '0.7rem',
  color: 'var(--color-text-muted)',
  fontSize: '0.74rem',
  fontStyle: 'italic',
};

/** The bound-ack line's text spans (rollup mode) — the main commit row is the
 *  shared {@link CommitRow}; this sub-line stays local to the picker. */
const boundLabelStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const boundShaStyle: React.CSSProperties = {
  flex: 'none',
  color: 'var(--color-text-soft)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.66rem',
};

const boundDateStyle: React.CSSProperties = {
  flex: 'none',
  color: 'var(--color-text-muted)',
  fontSize: '0.68rem',
};

/** The bound-ack line under a save-point (rollup mode). */
const boundAckStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.35rem',
  paddingLeft: '0.2rem',
  color: 'var(--color-text-secondary)',
  fontSize: '0.7rem',
};

const boundArrowStyle: React.CSSProperties = { flex: 'none', color: 'var(--color-text-faint)' };

const boundDotStyle: React.CSSProperties = { flex: 'none', color: 'var(--color-accent-soft)' };
