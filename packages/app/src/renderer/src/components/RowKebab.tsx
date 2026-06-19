import type { JSX } from 'react';

/**
 * Hover-visible "more actions" affordance — a kebab (`⋮`) button that opens
 * the same context menu the right-click opens. Stays at `opacity: 0` until
 * the row it lives in is hovered or focused; visibility transitions live in
 * the global stylesheet in `index.html` (`.row-kebab` rules).
 *
 * The kebab is a presentation primitive — it knows nothing about the menu.
 * The caller decides how the menu opens (set state on a Pane, position a
 * popover, etc.) by handling `onActivate`.
 *
 * Phase B task 6 of [Companion v0.6](../../../../.ai-lore-ai-lore-companion/memory/action-tree/companion-v0.6/B-drift-is-git.phase.md).
 */
type Props = {
  /** Called when the user clicks or keyboard-activates the kebab. */
  onActivate: (event: React.SyntheticEvent<HTMLButtonElement>) => void;
  /** Optional test-id for e2e selection. */
  testId?: string;
};

export function RowKebab({ onActivate, testId }: Props): JSX.Element {
  return (
    <button
      type="button"
      className="row-kebab"
      title="More actions"
      aria-label="Row actions"
      data-testid={testId}
      onClick={(e) => {
        // Stop the click reaching the row's own onClick (reveal-in-tree etc.);
        // the kebab is its own affordance.
        e.stopPropagation();
        onActivate(e);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onActivate(e);
        }
      }}
    >
      ⋮
    </button>
  );
}
