import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { BranchIndicators } from '../../src/renderer/src/components/BranchIndicators.js';
import { useCockpitStore } from '../../src/renderer/src/store.js';

afterEach(() => {
  cleanup();
  useCockpitStore.setState({ branches: null });
});

test('renders nothing until the first branches push lands', () => {
  useCockpitStore.setState({ branches: null });
  render(<BranchIndicators />);
  expect(screen.queryByTestId('branch-indicators')).toBeNull();
});

test('shows both repos labelled by scope with their branch names', () => {
  useCockpitStore.setState({
    branches: {
      payload: { kind: 'ok', branch: 'main', detached: false },
      lore: { kind: 'ok', branch: 'lore-work', detached: false },
    },
  });
  render(<BranchIndicators />);
  const payload = screen.getByTestId('branch-payload');
  const lore = screen.getByTestId('branch-lore');
  expect(payload.textContent).toContain('payload');
  expect(payload.textContent).toContain('main');
  expect(payload.dataset.state).toBe('ok');
  expect(lore.textContent).toContain('lore');
  expect(lore.textContent).toContain('lore-work');
  expect(lore.dataset.state).toBe('ok');
});

test('renders a detached HEAD as an explicit state, never a fake name', () => {
  useCockpitStore.setState({
    branches: {
      payload: { kind: 'ok', branch: 'main', detached: false },
      lore: { kind: 'ok', branch: '', detached: true },
    },
  });
  render(<BranchIndicators />);
  const lore = screen.getByTestId('branch-lore');
  expect(lore.dataset.state).toBe('detached');
  expect(lore.textContent).toContain('detached');
});

test('renders a failed read as an explicit state with the message in the tooltip', () => {
  useCockpitStore.setState({
    branches: {
      payload: { kind: 'failed', message: 'git rev-parse exited 128: fatal' },
      lore: { kind: 'ok', branch: 'main', detached: false },
    },
  });
  render(<BranchIndicators />);
  const payload = screen.getByTestId('branch-payload');
  expect(payload.dataset.state).toBe('failed');
  expect(payload.textContent).toContain('failed');
  expect(payload.title).toContain('git rev-parse exited 128');
});
