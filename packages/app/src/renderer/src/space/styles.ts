/**
 * Style objects the 1.0 screens share. They use the tokens of `theme.css`, as
 * the cockpit's components do, so both palettes apply.
 */

/** The main action of a screen. */
export const primaryButtonStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: '0.4rem 1rem',
  fontSize: '0.85rem',
  fontWeight: 600,
  color: 'var(--color-text-bright)',
  background: 'var(--color-surface-blue)',
  border: '1px solid var(--color-surface-blue-border)',
  borderRadius: '5px',
  cursor: 'pointer',
};

/** Any other action of a screen. */
export const secondaryButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  fontWeight: 500,
  color: 'var(--color-text)',
  background: 'transparent',
};

/** A folder's path, in the monospace face. */
export const folderPathStyle: React.CSSProperties = {
  color: 'var(--color-text-secondary)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.8rem',
  wordBreak: 'break-all',
};

/** The screen's own error area: the message of a request that main refused or that failed. */
export const errorAreaStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: 'var(--color-warn-fg)',
};

/**
 * Style objects of `onboarding-architecture.md` A.12, shared by the setup and
 * welcome screens (M9.8) and by the forms and results that come after them.
 */

/** A card that groups a block of content: a section, the confirm card, a panel. */
export const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
  padding: '0.9rem 1rem',
  background: 'var(--color-shell-deep)',
  border: '1px solid var(--color-border)',
  borderRadius: '6px',
  boxSizing: 'border-box',
};

/** A single row shown as its own card: a requirement, an engine, a confirm line. */
export const rowCardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
  padding: '0.7rem 0.85rem',
  background: 'var(--color-shell-deep)',
  border: '1px solid var(--color-border)',
  borderRadius: '6px',
  boxSizing: 'border-box',
};

/** The kinds of state tag `stateTagStyle` and `bannerStyle` accept. */
export type StateTagKind = 'ready' | 'action' | 'failed' | 'muted' | 'new' | 'reused';
export type BannerKind = 'warn' | 'danger' | 'info';

/**
 * The colour and, for `new`/`reused`, the pill shape of a state word or tag.
 * The word itself still carries the state (never colour alone): `✓` ready,
 * `!` action, `✗` failed.
 */
export function stateTagStyle(kind: StateTagKind): React.CSSProperties {
  const base: React.CSSProperties = { fontSize: '0.85rem', fontWeight: 600 };
  switch (kind) {
    case 'ready':
      return { ...base, color: 'var(--color-success-fg)' };
    case 'action':
      return { ...base, color: 'var(--color-warn-fg)' };
    case 'failed':
      return { ...base, color: 'var(--color-danger-fg)' };
    case 'muted':
      return { ...base, fontWeight: 500, color: 'var(--color-text-muted)' };
    case 'new':
      return {
        ...base,
        fontSize: '0.75rem',
        padding: '0.1rem 0.5rem',
        borderRadius: '999px',
        background: 'var(--color-neutral-pill)',
        color: 'var(--color-text)',
      };
    case 'reused':
      return {
        ...base,
        fontSize: '0.75rem',
        padding: '0.1rem 0.5rem',
        borderRadius: '999px',
        background: 'var(--color-amber-tag-bg)',
        border: '1px solid var(--color-amber-tag-border)',
        color: 'var(--color-amber-tag-fg)',
      };
    default:
      return base;
  }
}

/** A field's label, above its input. */
export const fieldLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8rem',
  fontWeight: 600,
  color: 'var(--color-text-2)',
  marginBottom: '0.25rem',
};

/** A short helper line under a field or a row. */
export const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  color: 'var(--color-text-secondary)',
};

/** A text or select input. */
export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.4rem 0.6rem',
  fontSize: '0.85rem',
  color: 'var(--color-text)',
  background: 'var(--color-inset)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: '4px',
  boxSizing: 'border-box',
};

/** The live result line of a form ("Will create …"): the most visible line of the field. */
export const resultLineStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.85rem',
  color: 'var(--color-text)',
};

/** The button that opens or closes a `Disclosure`. */
export const disclosureStyle: React.CSSProperties = {
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'var(--color-link)',
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer',
  textAlign: 'left',
};

/** The "1 Details · 2 Confirm · 3 Create" line at the top of the setup screens. */
export const stepIndicatorStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: 'var(--color-text-muted)',
};

/** A banner block: a half-made Space notice, a plan error, an informational note. */
export function bannerStyle(kind: BannerKind): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.3rem',
    padding: '0.7rem 0.85rem',
    borderRadius: '6px',
    fontSize: '0.85rem',
    boxSizing: 'border-box',
  };
  switch (kind) {
    case 'warn':
      return {
        ...base,
        background: 'var(--color-warn-banner-bg)',
        border: '1px solid var(--color-warn-banner-border)',
      };
    case 'danger':
      return {
        ...base,
        background: 'var(--color-danger-box-bg)',
        border: '1px solid var(--color-danger-box-border)',
      };
    case 'info':
      return {
        ...base,
        background: 'var(--color-shell-deep)',
        border: '1px solid var(--color-border)',
      };
    default:
      return base;
  }
}
