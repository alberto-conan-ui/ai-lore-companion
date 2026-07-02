import * as Popover from '@radix-ui/react-popover';
import type { CSSProperties, JSX, ReactNode } from 'react';

/**
 * The shared context-menu shell — the third overlay primitive, for menus that
 * open at a **point** (a right-click's viewport coordinates) rather than on a
 * trigger element. Radix Popover wants a trigger to anchor to, so this renders
 * a zero-size fixed-position `Popover.Anchor` at (x, y) — the virtual-anchor
 * pattern — and lets Radix own the rest: portal, Escape, outside-click
 * dismiss, and collision-aware placement (the hand-rolled menu could overflow
 * the viewport near an edge; this one flips).
 *
 * Modal, unlike `PopoverShell`: a context menu's outside click should only
 * dismiss the menu, never activate what's underneath — matching the swallowing
 * backdrop it replaces (and native menu convention).
 *
 * Conditionally mounted (`{menu ? <ContextMenuShell/> : null}`), so the root
 * is always `open` and every close intent funnels through `onClose`.
 */

type Props = {
  /** Viewport coordinates the menu opens at — the right-click point. */
  x: number;
  y: number;
  onClose: () => void;
  /** Accessible name for the menu panel. */
  label: string;
  /** Panel skin — everything beyond positioning and dismissal. */
  contentStyle?: CSSProperties;
  testId?: string;
  children: ReactNode;
};

export function ContextMenuShell(props: Props): JSX.Element {
  return (
    <Popover.Root
      open
      modal
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Popover.Anchor
        style={{ position: 'fixed', left: props.x, top: props.y, width: 0, height: 0 }}
      />
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={0}
          style={{ ...contentBaseStyle, ...props.contentStyle }}
          aria-label={props.label}
          {...(props.testId ? { 'data-testid': props.testId } : {})}
        >
          {props.children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const contentBaseStyle: CSSProperties = {
  zIndex: 101,
  outline: 'none',
};
