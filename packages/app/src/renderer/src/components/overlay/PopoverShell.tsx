import * as Popover from '@radix-ui/react-popover';
import type { CSSProperties, JSX, ReactNode } from 'react';

/**
 * The shared anchored-popover shell — the dropdown-grade sibling of
 * `ModalSheet`, wrapping Radix Popover. Radix owns what every hand-rolled
 * popover re-implemented: outside-click dismiss, Escape, portal, anchored
 * positioning with collision handling, and the trigger's `aria-expanded`
 * wiring. Callers own the trigger element (passed through `asChild`, so the
 * existing button renders unchanged), the panel skin, and the content.
 *
 * Non-modal by design (Radix default): a popover is a transient surface —
 * the page behind stays interactive, and any outside pointer-down dismisses.
 */

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The anchor — rendered as the caller's own element via `asChild`. */
  trigger: ReactNode;
  /** Horizontal alignment against the trigger (default `end` — right-edged). */
  align?: 'start' | 'center' | 'end';
  /** Gap in px between trigger and panel (default 4 — the hand-rolled offset). */
  sideOffset?: number;
  /** Panel skin and size — everything beyond positioning. */
  contentStyle?: CSSProperties;
  testId?: string;
  /** Accessible name for the panel. */
  label?: string;
  children: ReactNode;
};

export function PopoverShell(props: Props): JSX.Element {
  return (
    <Popover.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Popover.Trigger asChild>{props.trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={props.align ?? 'end'}
          sideOffset={props.sideOffset ?? 4}
          style={{ ...contentBaseStyle, ...props.contentStyle }}
          {...(props.label ? { 'aria-label': props.label } : {})}
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
