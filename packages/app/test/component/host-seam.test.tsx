import { cleanup, fireEvent, render } from '@testing-library/react';
import { type JSX, useRef, useState } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import {
  type HostSeamItem,
  type SlotResolver,
  useHostSeam,
} from '../../src/renderer/src/shell/hostSeam.js';

afterEach(cleanup);

/**
 * Drives the hook the way the real workspace does: it renders an in-document
 * slot `<div>` per id in `slotIds` (a stand-in for the panel content slots or a
 * DockSlotRegistry's panel elements), and resolves each item to its slot. The
 * buttons let a test add a slot late or drop an item and watch the seam react.
 */
function Harness({
  initialItems,
  initialSlotIds,
}: {
  initialItems: HostSeamItem[];
  initialSlotIds: string[];
}): JSX.Element {
  const [items, setItems] = useState(initialItems);
  const [slotIds, setSlotIds] = useState(initialSlotIds);
  const [token, setToken] = useState(0);
  const slotEls = useRef(new Map<string, HTMLElement>());
  const resolveSlot: SlotResolver = (id) => slotEls.current.get(id);
  const portals = useHostSeam(items, resolveSlot, (id) => <span>body-{id}</span>, token);
  return (
    <div>
      {slotIds.map((id) => (
        <div
          key={id}
          data-testid={`slot-${id}`}
          ref={(el) => {
            if (el) slotEls.current.set(id, el);
            else slotEls.current.delete(id);
          }}
        />
      ))}
      <button
        type="button"
        data-testid="add-slot-a"
        onClick={() => {
          setSlotIds((s) => (s.includes('a') ? s : [...s, 'a']));
          setToken((t) => t + 1);
        }}
      />
      <button
        type="button"
        data-testid="drop-first"
        onClick={() => setItems((xs) => xs.slice(1))}
      />
      {portals}
    </div>
  );
}

const inSlot = (slotId: string, hostId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-testid="slot-${slotId}"] [data-tab-host="${hostId}"]`);

describe('useHostSeam', () => {
  test('parks a stable host (data-tab-host) into its slot and portals the body in', () => {
    render(<Harness initialItems={[{ id: 'a', visible: true }]} initialSlotIds={['a']} />);
    const host = inSlot('a', 'a');
    expect(host).not.toBeNull();
    expect(host?.textContent).toBe('body-a');
    expect(host?.style.display).toBe('flex');
  });

  test('toggles display by visibility', () => {
    render(
      <Harness
        initialItems={[
          { id: 'a', visible: true },
          { id: 'b', visible: false },
        ]}
        initialSlotIds={['a', 'b']}
      />,
    );
    expect(inSlot('a', 'a')?.style.display).toBe('flex');
    expect(inSlot('b', 'b')?.style.display).toBe('none');
  });

  test('re-parks into a slot that appears later when the token bumps', () => {
    const { getByTestId } = render(
      <Harness initialItems={[{ id: 'a', visible: true }]} initialSlotIds={[]} />,
    );
    // No slot yet → the host is detached, not under any slot.
    expect(inSlot('a', 'a')).toBeNull();
    fireEvent.click(getByTestId('add-slot-a'));
    // The same host now lives under the freshly-appeared slot.
    expect(inSlot('a', 'a')).not.toBeNull();
    expect(inSlot('a', 'a')?.textContent).toBe('body-a');
  });

  test('drops the host of an item that goes away', () => {
    const { getByTestId } = render(
      <Harness
        initialItems={[
          { id: 'a', visible: true },
          { id: 'b', visible: true },
        ]}
        initialSlotIds={['a', 'b']}
      />,
    );
    expect(inSlot('a', 'a')).not.toBeNull();
    fireEvent.click(getByTestId('drop-first'));
    expect(document.querySelector('[data-tab-host="a"]')).toBeNull();
    expect(inSlot('b', 'b')).not.toBeNull();
  });
});
