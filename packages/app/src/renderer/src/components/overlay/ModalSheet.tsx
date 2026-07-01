import * as Dialog from '@radix-ui/react-dialog';
import type { CSSProperties, JSX, ReactNode } from 'react';

/**
 * The one modal shell every dialog-grade overlay shares — a themed wrapper
 * over Radix Dialog. Radix owns the commodity every hand-rolled overlay
 * re-implemented (or forgot): portal to `document.body`, backdrop, **Escape**,
 * outside-click dismiss, focus trap + focus restore, `aria-modal` wiring.
 * Callers own only what differs per dialog: the panel's placement/size
 * (`panelStyle`), its content, and the test ids.
 *
 * Every ModalSheet is conditionally mounted (`{open ? <X/> : null}` at the
 * call site), so the Radix root is always `open` and close intents — Escape,
 * backdrop click, the caller's own Close button — funnel through `onClose`.
 */

type Props = {
  /** Accessible dialog name (rendered as a visually-hidden Radix Title). */
  label: string;
  onClose: () => void;
  /** Lands on the panel (Radix `Dialog.Content`). */
  testId?: string;
  /** Lands on the backdrop (Radix `Dialog.Overlay`). */
  backdropTestId?: string;
  /** Backdrop tint — dialogs vary between 0.45 and 0.55 black. */
  backdropStyle?: CSSProperties;
  /** Panel placement, size and skin — everything beyond the fixed overlay. */
  panelStyle: CSSProperties;
  children: ReactNode;
};

export function ModalSheet(props: Props): JSX.Element {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          style={{ ...overlayBaseStyle, ...props.backdropStyle }}
          {...(props.backdropTestId ? { 'data-testid': props.backdropTestId } : {})}
        />
        <Dialog.Content
          aria-label={props.label}
          style={{ ...panelBaseStyle, ...props.panelStyle }}
          {...(props.testId ? { 'data-testid': props.testId } : {})}
        >
          <Dialog.Title style={visuallyHiddenStyle}>{props.label}</Dialog.Title>
          {props.children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const overlayBaseStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  zIndex: 100,
};

const panelBaseStyle: CSSProperties = {
  position: 'fixed',
  zIndex: 101,
};

/** Standard visually-hidden recipe — present for the accessibility tree,
 *  invisible on screen (the dialogs render their own visible headers). */
const visuallyHiddenStyle: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};
