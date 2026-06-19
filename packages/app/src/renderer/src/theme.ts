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

/** The stored `appearance.theme` values: explicit, or follow the OS. */
export type ThemeSetting = 'dark' | 'light' | 'system';

/** Whether the OS currently prefers a dark colour scheme. */
export function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
}

/** Resolve a stored theme setting to the concrete theme to render. `system`
 *  (and any unknown value) follows the OS preference. */
export function resolveTheme(setting: unknown): 'dark' | 'light' {
  if (setting === 'light') return 'light';
  if (setting === 'dark') return 'dark';
  return systemPrefersDark() ? 'dark' : 'light';
}

/**
 * Subscribe to the *effective* theme — the concrete dark/light to render —
 * tracking both the `appearance.theme` setting and, while it is `system`, the
 * OS preference. Fires once on subscribe and on every change; returns an
 * unsubscribe. One source of truth so the document attribute, the header tint,
 * and the terminal can't drift apart.
 */
export function onEffectiveTheme(cb: (theme: 'dark' | 'light') => void): () => void {
  // Defensive: in non-app contexts (e.g. component tests with a partial cockpit
  // mock) the settings API may be absent — emit the resolved default and no-op.
  const cockpit = window.cockpit;
  if (!cockpit?.settingsGet || !cockpit.onSettingsChanged) {
    cb(resolveTheme(undefined));
    return () => {};
  }
  let setting: unknown;
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  const emit = (): void => cb(resolveTheme(setting));
  void cockpit.settingsGet().then((snap) => {
    setting = snap.resolved['appearance.theme'];
    emit();
  });
  const offSettings = cockpit.onSettingsChanged((snap) => {
    setting = snap.resolved['appearance.theme'];
    emit();
  });
  mq?.addEventListener('change', emit);
  return () => {
    offSettings();
    mq?.removeEventListener('change', emit);
  };
}
