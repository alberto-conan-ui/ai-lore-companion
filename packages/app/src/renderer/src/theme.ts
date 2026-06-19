/**
 * Shared visual tokens (Read-only IDE P4 facelift). Before this, every component
 * inlined its own font stack — three near-identical monospace variants and the
 * system-ui sans — and the cockpit palette was ~30 loose hexes. These constants
 * give the file UI one font and one palette to read from; new code should pull
 * from here rather than re-inline.
 */

/** The one UI (sans) font — labels, rows, chrome. */
export const FONT_UI = 'system-ui, -apple-system, "Segoe UI", sans-serif';
/** The one monospace font — paths, code, the editor. */
export const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/** The one file-row text size — px number where a numeric size is needed,
 *  string for inline CSS. The navigator tree and the changes panel both
 *  read from this so a row reads the same on either side (P4 facelift). */
export const FONT_SIZE_PX = 12.5;
export const FONT_SIZE = `${FONT_SIZE_PX}px`;

/** Cockpit palette — the recurring surfaces, borders, and text tones. */
export const PALETTE = {
  /** Window shell — the darkest ground. */
  shell: 'var(--color-shell)',
  /** Tree / list column ground. */
  panel: 'var(--color-panel)',
  /** Header / chrome ground. */
  header: 'var(--color-header)',
  /** Raised chrome (grid edges, pills). */
  raised: 'var(--color-raised)',
  /** Hairline borders + grid lines. */
  border: 'var(--color-border)',
  /** Control borders (buttons, inputs). */
  borderStrong: 'var(--color-border-strong)',
  /** Primary text. */
  text: 'var(--color-text)',
  /** Bright text (headers, selection). */
  textBright: 'var(--color-text-bright)',
  /** Muted text. */
  textMuted: 'var(--color-text-muted)',
  /** Dim affordance text (reveal, kebab at rest). */
  textDim: 'var(--color-text-dim)',
  /** Selection / focus accent. */
  accent: 'var(--color-accent)',
} as const;
