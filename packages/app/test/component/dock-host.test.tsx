import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

// Dockview measures the DOM (ResizeObserver, getBoundingClientRect) which jsdom
// does not provide; mounting the real component here would be a brittle DOM
// test, not a test of the shell wrapper. Stub `dockview` with a recorder so we
// can assert the contract the shell guarantees: the token-bridge theme is
// applied by default, the panel render mode defaults to `always` (keeps inactive
// panes mounted — load-bearing for live PTYs), and every other prop is
// forwarded untouched.
const received: { props: Record<string, unknown> | null } = { props: null };
vi.mock('dockview', () => ({
  DockviewReact: (props: Record<string, unknown>) => {
    received.props = props;
    return <div data-testid="dockview-react" />;
  },
}));

import { AILORE_DOCKVIEW_THEME, DockHost } from '../../src/renderer/src/shell/DockHost.js';

afterEach(() => {
  received.props = null;
  cleanup();
});

const noopReady = (): void => {};

describe('DockHost', () => {
  test('applies the cockpit token-bridge theme by default', () => {
    render(<DockHost components={{}} onReady={noopReady} />);
    expect(received.props?.theme).toBe(AILORE_DOCKVIEW_THEME);
  });

  test('the bridge theme targets the dockview-theme.css class', () => {
    // The class name is the contract with the CSS token map — if this drifts,
    // the docking surface silently loses the app's theme.
    expect(AILORE_DOCKVIEW_THEME.className).toBe('dockview-theme-ailore');
  });

  test('defaults the panel render mode to "always"', () => {
    render(<DockHost components={{}} onReady={noopReady} />);
    expect(received.props?.defaultRenderer).toBe('always');
  });

  test('forwards consumer props and lets them override the defaults', () => {
    const components = { pane: () => null };
    const customTheme = { name: 'x', className: 'dockview-theme-x' };
    render(
      <DockHost
        components={components}
        onReady={noopReady}
        theme={customTheme}
        defaultRenderer="onlyWhenVisible"
        singleTabMode="fullwidth"
      />,
    );
    expect(received.props?.components).toBe(components);
    expect(received.props?.theme).toBe(customTheme);
    expect(received.props?.defaultRenderer).toBe('onlyWhenVisible');
    expect(received.props?.singleTabMode).toBe('fullwidth');
  });
});
