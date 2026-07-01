import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModalSheet } from '../../src/renderer/src/components/overlay/ModalSheet.js';

/**
 * The shared modal shell (Radix Dialog wrapper). These pin the dismissal and
 * a11y behaviours every dialog now inherits — before ModalSheet each overlay
 * hand-rolled its own subset (AppPickerModal famously had no Escape at all).
 */
describe('ModalSheet', () => {
  afterEach(cleanup);

  function mount(onClose = vi.fn()) {
    render(
      <ModalSheet label="Test sheet" onClose={onClose} testId="test-sheet" panelStyle={{}}>
        <button type="button">inside</button>
      </ModalSheet>,
    );
    return onClose;
  }

  it('renders the panel with role=dialog, the accessible name, and the content', () => {
    mount();
    const panel = screen.getByTestId('test-sheet');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(screen.getByRole('dialog', { name: 'Test sheet' })).toBe(panel);
    expect(screen.getByText('inside')).toBeTruthy();
  });

  it('closes on Escape', () => {
    const onClose = mount();
    fireEvent.keyDown(screen.getByTestId('test-sheet'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps focus inside the dialog (first focusable gets focus)', () => {
    mount();
    expect(document.activeElement?.textContent).toBe('inside');
  });
});
