import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { DockSlotRegistry, makeDockSlotPanel } from '../../src/renderer/src/shell/dockSlots.js';

afterEach(cleanup);

/** A minimal stand-in for the Dockview panel props the slot component reads —
 *  only `params` is touched by the seam. */
function slotProps(slotId: string): { params: { slotId: string } } {
  return { params: { slotId } };
}

describe('DockSlotRegistry', () => {
  test('set / get / remove round-trip and live id list', () => {
    const reg = new DockSlotRegistry();
    const a = document.createElement('div');
    const b = document.createElement('div');
    reg.set('a', a);
    reg.set('b', b);
    expect(reg.get('a')).toBe(a);
    expect(reg.ids().sort()).toEqual(['a', 'b']);
    reg.remove('a');
    expect(reg.get('a')).toBeUndefined();
    expect(reg.ids()).toEqual(['b']);
  });

  test('subscribers fire only on a real change', () => {
    const reg = new DockSlotRegistry();
    const fn = vi.fn();
    const off = reg.subscribe(fn);
    const el = document.createElement('div');
    reg.set('x', el);
    expect(fn).toHaveBeenCalledTimes(1);
    // Re-setting the same element is a no-op — no spurious re-park.
    reg.set('x', el);
    expect(fn).toHaveBeenCalledTimes(1);
    // Removing a missing id does not notify.
    reg.remove('missing');
    expect(fn).toHaveBeenCalledTimes(1);
    reg.remove('x');
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    reg.set('y', el);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('makeDockSlotPanel', () => {
  test('registers its content element on mount and drops it on unmount', () => {
    const reg = new DockSlotRegistry();
    const Slot = makeDockSlotPanel(reg);
    // biome-ignore lint/suspicious/noExplicitAny: minimal panel-props stand-in
    const { unmount } = render(<Slot {...(slotProps('term-1') as any)} />);
    const el = reg.get('term-1');
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el?.dataset.dockSlot).toBe('term-1');
    unmount();
    expect(reg.get('term-1')).toBeUndefined();
  });

  test('two panels register distinct elements under their own ids', () => {
    const reg = new DockSlotRegistry();
    const Slot = makeDockSlotPanel(reg);
    // biome-ignore lint/suspicious/noExplicitAny: minimal panel-props stand-in
    render(<Slot {...(slotProps('one') as any)} />);
    // biome-ignore lint/suspicious/noExplicitAny: minimal panel-props stand-in
    render(<Slot {...(slotProps('two') as any)} />);
    expect(reg.get('one')).not.toBe(reg.get('two'));
    expect(reg.ids().sort()).toEqual(['one', 'two']);
  });
});
