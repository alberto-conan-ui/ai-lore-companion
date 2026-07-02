import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextMenuShell } from '../../src/renderer/src/components/overlay/ContextMenuShell.js';

/**
 * The shared context-menu shell (Radix Popover on a virtual anchor). These pin
 * what the hand-rolled fixed-position menu + swallowing backdrop provided —
 * plus the Escape dismiss it never had.
 */
describe('ContextMenuShell', () => {
  afterEach(cleanup);

  function mount(onClose = vi.fn()) {
    render(
      <ContextMenuShell x={40} y={60} onClose={onClose} label="Row actions" testId="test-menu">
        <button type="button">Open in Finder</button>
      </ContextMenuShell>,
    );
    return onClose;
  }

  it('renders the panel with the accessible name and the content', () => {
    mount();
    const panel = screen.getByTestId('test-menu');
    expect(panel.getAttribute('aria-label')).toBe('Row actions');
    expect(screen.getByText('Open in Finder')).toBeTruthy();
  });

  it('closes on Escape', () => {
    const onClose = mount();
    fireEvent.keyDown(screen.getByTestId('test-menu'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('anchors at the given viewport point', () => {
    mount();
    // The virtual anchor is the fixed-position zero-size element at (x, y);
    // Radix positions the panel against it. jsdom has no layout, so the
    // anchor's own inline style is the observable contract.
    const anchor = document.querySelector('[style*="left: 40px"]');
    expect(anchor).toBeTruthy();
    expect((anchor as HTMLElement).style.top).toBe('60px');
    expect((anchor as HTMLElement).style.position).toBe('fixed');
  });
});
