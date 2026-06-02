import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { LeftActivityRail } from '../../src/renderer/src/components/LeftActivityRail.js';

afterEach(() => cleanup());

const pressed = (testId: string): boolean =>
  screen.getByTestId(testId).getAttribute('aria-pressed') === 'true';

test('shows both buttons; the active section is pressed', () => {
  render(<LeftActivityRail section="project" onSelect={() => {}} />);
  expect(screen.getByTestId('left-rail-project')).toBeTruthy();
  expect(screen.getByTestId('left-rail-assistant')).toBeTruthy();
  expect(pressed('left-rail-project')).toBe(true);
  expect(pressed('left-rail-assistant')).toBe(false);
});

test('clicking a button selects its section', () => {
  const onSelect = vi.fn();
  render(<LeftActivityRail section="project" onSelect={onSelect} />);
  fireEvent.click(screen.getByTestId('left-rail-assistant'));
  expect(onSelect).toHaveBeenCalledWith('assistant');
});

test('the Assistant section reads as active when selected', () => {
  render(<LeftActivityRail section="assistant" onSelect={() => {}} />);
  expect(pressed('left-rail-assistant')).toBe(true);
  expect(pressed('left-rail-project')).toBe(false);
});
