import { type JSX, useEffect, useState } from 'react';
import {
  type FocusReadResult,
  type MemoryFrontmatter,
  type MemorySections,
  isFocusReadError,
} from '../../../shared/ipc.js';
import { ModalSheet } from './overlay/ModalSheet.js';

/**
 * The in-app view of a focus or AT-node Memory file.
 *
 * Opens as a sheet. Renders the frontmatter (title, status, focus_type or
 * node_kind) as a small header strip, then the body's sections. A `build`
 * focus leads with its **Gate**; a `goal` focus leads with its **Vision**.
 * Both then show Context, In scope, Out of scope, Watch-outs in order.
 * Anything else the section parser finds (Stack, Active child pointer,
 * Journal trail, intent, etc.) is rendered after the standard four.
 */
export function FocusView({ path, onClose }: { path: string; onClose: () => void }): JSX.Element {
  const [data, setData] = useState<FocusReadResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.cockpit.focusRead({ path }).then((result) => {
      if (!cancelled) setData(result);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <ModalSheet label="Focus view" onClose={onClose} testId="focus-view" panelStyle={sheetStyle}>
      <div style={headerStyle}>
        <span style={titleStyle} data-testid="focus-view-title">
          {data && !isFocusReadError(data)
            ? (data.frontmatter?.title ?? path.split('/').pop())
            : 'Loading…'}
        </span>
        {data && !isFocusReadError(data) && data.frontmatter ? (
          <FrontmatterChips fm={data.frontmatter} />
        ) : null}
        <button
          type="button"
          onClick={onClose}
          style={closeButtonStyle}
          data-testid="focus-view-close"
        >
          Close
        </button>
      </div>
      <div style={bodyStyle}>
        {data === null ? (
          <p style={loadingStyle}>Loading…</p>
        ) : isFocusReadError(data) ? (
          <p style={errorStyle}>Cannot open: {data.error}</p>
        ) : (
          <FocusBody frontmatter={data.frontmatter} sections={data.sections} />
        )}
      </div>
    </ModalSheet>
  );
}

function FrontmatterChips({ fm }: { fm: MemoryFrontmatter }): JSX.Element {
  // Lightweight chips that describe what kind of node this is. The chip
  // colours keep the `--color-reg-*` tokens the old header register chips
  // introduced (the chips themselves were dropped in the P5 chrome reshape).
  const chips: { label: string; value: string; accent: string; testId: string }[] = [];
  if (fm.type === 'focus') {
    chips.push({
      label: 'Type',
      value: fm.focus_type,
      accent: 'var(--color-reg-focus)',
      testId: 'focus-view-focus-type',
    });
    chips.push({
      label: 'Status',
      value: fm.status,
      accent: 'var(--color-reg-dial)',
      testId: 'focus-view-status',
    });
  } else if (fm.type === 'at-node') {
    chips.push({
      label: 'Kind',
      value: fm.node_kind,
      accent: 'var(--color-reg-focus)',
      testId: 'focus-view-node-kind',
    });
    chips.push({
      label: 'Status',
      value: fm.status,
      accent: 'var(--color-reg-dial)',
      testId: 'focus-view-status',
    });
  }
  return (
    <span style={chipRowStyle}>
      {chips.map((chip) => (
        <span key={chip.testId} data-testid={chip.testId} style={chipPillStyle(chip.accent)}>
          <span style={chipLabelStyle}>{chip.label}</span>
          <span style={chipValueStyle(chip.accent)}>{chip.value}</span>
        </span>
      ))}
    </span>
  );
}

function FocusBody({
  frontmatter,
  sections,
}: {
  frontmatter: MemoryFrontmatter | null;
  sections: MemorySections;
}): JSX.Element {
  // Lead with whichever section makes sense for this file type. Status
  // glances open at "Current state"; a goal focus opens at "Vision"; a
  // build focus or AT-node opens at "Gate". The body still renders
  // honestly — a section that's missing gets a "not present" placeholder.
  const { primary, secondary } = primaryAndSecondaryFor(frontmatter);

  const renderedKeys = new Set<string>([primary, ...secondary].map((k) => k.toLowerCase()));
  const otherKeys = Object.keys(sections).filter((k) => !renderedKeys.has(k.toLowerCase()));

  return (
    <div>
      <FocusSection title={primary} body={lookup(sections, primary)} testId="focus-view-primary" />
      {secondary.map((label) => (
        <FocusSection
          key={label}
          title={label}
          body={lookup(sections, label)}
          testId={`focus-view-section-${slug(label)}`}
        />
      ))}
      {otherKeys.map((key) => (
        <FocusSection
          key={key}
          title={key}
          body={lookup(sections, key)}
          testId={`focus-view-section-${slug(key)}`}
        />
      ))}
    </div>
  );
}

function primaryAndSecondaryFor(fm: MemoryFrontmatter | null): {
  primary: string;
  secondary: string[];
} {
  if (fm?.type === 'status') {
    // Status glances open at "Current state"; "Focus stack" and "Journal
    // trail" are the supporting picture.
    return { primary: 'Current state', secondary: ['Focus stack', 'Journal trail'] };
  }
  if (fm?.type === 'focus' && fm.focus_type === 'goal') {
    return {
      primary: 'Vision',
      secondary: ['Context', 'In scope', 'Out of scope', 'Watch-outs'],
    };
  }
  // Default — focus (build) and at-node both lead with Gate.
  return {
    primary: 'Gate',
    secondary: ['Context', 'In scope', 'Out of scope', 'Watch-outs'],
  };
}

function FocusSection({
  title,
  body,
  testId,
}: {
  title: string;
  body: string | undefined;
  testId: string;
}): JSX.Element {
  return (
    <section style={sectionStyle} data-testid={testId}>
      <h2 style={sectionHeadingStyle}>{title}</h2>
      {body ? (
        <pre style={sectionBodyStyle}>{body}</pre>
      ) : (
        <p style={sectionEmptyStyle}>— not present in this file</p>
      )}
    </section>
  );
}

function lookup(sections: MemorySections, label: string): string | undefined {
  const target = label.toLowerCase();
  for (const [key, value] of Object.entries(sections)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Top-aligned centred sheet — the placement the pre-Radix backdrop's flex
 *  layout produced (4rem head-room, 2rem foot-room). */
const sheetStyle: React.CSSProperties = {
  top: '4rem',
  left: '50%',
  transform: 'translateX(-50%)',
  background: 'var(--color-header)',
  color: 'var(--color-text-bright)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '8px',
  width: 'min(880px, 96vw)',
  maxHeight: 'calc(100vh - 6rem)',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 12px 36px rgba(0, 0, 0, 0.5)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  padding: '1rem 1.1rem',
  borderBottom: '1px solid var(--color-border-strong)',
};

const titleStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: '1.05rem',
  letterSpacing: '0.02em',
  flex: 1,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const closeButtonStyle: React.CSSProperties = {
  background: 'var(--color-border)',
  color: 'var(--color-text-2)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '5px',
  fontSize: '0.78rem',
  fontWeight: 600,
  padding: '0.35rem 0.7rem',
  cursor: 'pointer',
};

const bodyStyle: React.CSSProperties = {
  overflowY: 'auto',
  padding: '1rem 1.1rem 1.4rem',
};

const sectionStyle: React.CSSProperties = {
  marginBottom: '1.25rem',
};

const sectionHeadingStyle: React.CSSProperties = {
  margin: '0 0 0.45rem',
  fontSize: '0.82rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--color-text-secondary)',
};

const sectionBodyStyle: React.CSSProperties = {
  margin: 0,
  padding: '0.75rem 0.9rem',
  background: 'var(--color-shell)',
  border: '1px solid var(--color-border)',
  borderRadius: '5px',
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  fontSize: '0.82rem',
  lineHeight: 1.55,
  color: 'var(--color-text-2)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const sectionEmptyStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--color-text-muted)',
  fontSize: '0.8rem',
  fontStyle: 'italic',
};

const loadingStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--color-text-secondary)',
};

const errorStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--color-danger-fg)',
};

const chipRowStyle: React.CSSProperties = {
  display: 'inline-flex',
  gap: '0.35rem',
};

function chipPillStyle(_accent: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3rem',
    padding: '0.2rem 0.5rem',
    background: 'var(--color-border)',
    border: '1px solid var(--color-border-strong)',
    borderRadius: '4px',
    fontSize: '0.7rem',
    fontWeight: 600,
    lineHeight: 1,
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
