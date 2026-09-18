import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { SpaceRail } from '../../../src/renderer/src/space/window/SpaceRail.js';
import { SPACE_RAIL_ENTRIES } from '../../../src/renderer/src/space/window/spaceNavStore.js';

afterEach(() => cleanup());

const entry = (id: string): HTMLElement => screen.getByTestId(`space-rail-${id}`);

test('the rail is a navigation landmark with the four entries, in order, named as they are inside', () => {
  render(<SpaceRail screen="sessions" onSelect={() => {}} />);
  expect(screen.getByRole('navigation', { name: 'Space' })).toBeTruthy();
  const buttons = screen.getAllByRole('button');
  expect(buttons.map((button) => button.textContent?.replace(/^\W+/, ''))).toEqual([
    'Dashboard',
    'Sessions',
    'Files',
    'Search',
  ]);
  // A label is the internal name with a capital, one to one.
  for (const item of SPACE_RAIL_ENTRIES) {
    expect(item.label.toLowerCase()).toBe(item.id);
    expect(screen.getByRole('button', { name: item.label })).toBe(entry(item.id));
  }
});

test('the entry of the screen that is shown is the current one; Files and Search never are', () => {
  const { rerender } = render(<SpaceRail screen="sessions" onSelect={() => {}} />);
  expect(entry('sessions').getAttribute('aria-current')).toBe('page');
  expect(entry('dashboard').getAttribute('aria-current')).toBeNull();
  expect(entry('files').getAttribute('aria-current')).toBeNull();
  expect(entry('search').getAttribute('aria-current')).toBeNull();

  rerender(<SpaceRail screen="dashboard" onSelect={() => {}} />);
  expect(entry('dashboard').getAttribute('aria-current')).toBe('page');
  expect(entry('sessions').getAttribute('aria-current')).toBeNull();
});

test('choosing an entry reports its id', () => {
  const onSelect = vi.fn();
  render(<SpaceRail screen="sessions" onSelect={onSelect} />);
  for (const item of SPACE_RAIL_ENTRIES) fireEvent.click(entry(item.id));
  expect(onSelect.mock.calls.map(([id]) => id)).toEqual([
    'dashboard',
    'sessions',
    'files',
    'search',
  ]);
});

test('keyboard: the arrows, Home and End move the focus between the entries and stop at the ends', () => {
  render(<SpaceRail screen="sessions" onSelect={() => {}} />);
  entry('dashboard').focus();
  fireEvent.keyDown(entry('dashboard'), { key: 'ArrowUp' });
  expect(document.activeElement).toBe(entry('dashboard'));
  fireEvent.keyDown(entry('dashboard'), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(entry('sessions'));
  fireEvent.keyDown(entry('sessions'), { key: 'End' });
  expect(document.activeElement).toBe(entry('search'));
  fireEvent.keyDown(entry('search'), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(entry('search'));
  fireEvent.keyDown(entry('search'), { key: 'Home' });
  expect(document.activeElement).toBe(entry('dashboard'));
});

test('every entry is a real button, so Enter and Space choose it without a handler of the rail', () => {
  render(<SpaceRail screen="sessions" onSelect={() => {}} />);
  for (const item of SPACE_RAIL_ENTRIES) {
    const button = entry(item.id);
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
  }
});
