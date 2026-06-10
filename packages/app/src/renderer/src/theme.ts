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

/** The one file-row text size — px number for the ag-grid theme param,
 *  string for inline CSS. The navigator tree and the file/changes grids both
 *  read from this so a row reads the same on either side (P4 facelift). */
export const FONT_SIZE_PX = 12.5;
export const FONT_SIZE = `${FONT_SIZE_PX}px`;

/** Cockpit palette — the recurring surfaces, borders, and text tones. */
export const PALETTE = {
  /** Window shell — the darkest ground. */
  shell: '#0a0f17',
  /** Tree / list column ground. */
  panel: '#0c121a',
  /** Header / chrome ground. */
  header: '#0f1620',
  /** Raised chrome (grid edges, pills). */
  raised: '#121a24',
  /** Hairline borders + grid lines. */
  border: '#1f2933',
  /** Control borders (buttons, inputs). */
  borderStrong: '#2f3a45',
  /** Primary text. */
  text: '#dde3ea',
  /** Bright text (headers, selection). */
  textBright: '#e6edf3',
  /** Muted text. */
  textMuted: '#6c7783',
  /** Dim affordance text (reveal, kebab at rest). */
  textDim: '#8a96a2',
  /** Selection / focus accent. */
  accent: '#5a9bd4',
} as const;
