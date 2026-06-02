import type { EngineEntry } from '@ai-lore-companion/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// The leaf bodies pull xterm / ag-grid; stub them so importing the registry is
// light and `renderBody` dispatch is assertable by the stub each kind renders.
vi.mock('../../src/renderer/src/components/AiTab.js', () => ({
  AiTab: () => <div data-testid="body-ai" />,
}));
vi.mock('../../src/renderer/src/components/TerminalTab.js', () => ({
  TerminalTab: () => <div data-testid="body-shell" />,
}));
vi.mock('../../src/renderer/src/components/BrowserTab.js', () => ({
  BrowserTab: () => <div data-testid="body-browser" />,
}));
vi.mock('../../src/renderer/src/components/Pane.js', () => ({
  Pane: (props: { label: string }) => <div data-testid="body-pane">{props.label}</div>,
}));
vi.mock('../../src/renderer/src/components/PublishPane.js', () => ({
  PublishPane: () => <div data-testid="body-publish" />,
}));
vi.mock('../../src/renderer/src/components/AssistantFeed.js', () => ({
  AssistantFeed: () => <div data-testid="body-assistant" />,
}));
vi.mock('../../src/renderer/src/components/AssistantHost.js', () => ({
  AssistantHost: () => <div data-testid="body-assistant-host" />,
}));

import type { WorkspaceTab } from '../../src/renderer/src/components/TabbedPanel.js';
import {
  NEW_TAB_BUTTONS,
  type NewTabContext,
  type PaneSpec,
  TAB_KINDS,
  type TabRenderContext,
  defaultEngineId,
} from '../../src/renderer/src/components/tabKinds.js';

const engines: EngineEntry[] = [
  { id: 'claude', name: 'Claude', binary: 'claude' },
  { id: 'gemini', name: 'Gemini', binary: 'gemini' },
];

/** A WorkspaceTab with only the fields a given test cares about. */
function tab(
  partial: Partial<WorkspaceTab> & { kind: WorkspaceTab['kind']; id: string },
): WorkspaceTab {
  return { title: 't', baseTitle: 't', ...partial } as WorkspaceTab;
}

function newCtx(over: Partial<NewTabContext> = {}): NewTabContext {
  return {
    engines,
    lastEngineId: null,
    onNewShell: vi.fn(),
    onNewAi: vi.fn(),
    onNewBrowser: vi.fn(),
    shortcuts: [],
    onNewShellWithCommand: vi.fn(),
    onNewBrowserWithUrl: vi.fn(),
    onLaunchUrlExternal: vi.fn(),
    ...over,
  };
}

function renderCtx(over: Partial<TabRenderContext> = {}): TabRenderContext {
  return {
    projectRoot: '/proj',
    paneSpecById: new Map<string, PaneSpec>(),
    displayPath: (a) => a,
    revealTarget: null,
    handleTerminalStatus: vi.fn(),
    terminalInitialCommands: {},
    browserInitialUrls: {},
    tabShortcuts: [],
    engines,
    setAiTabEngine: vi.fn(),
    setAiTabRunning: vi.fn(),
    clearLastSession: vi.fn(),
    ...over,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('defaultEngineId', () => {
  test('keeps the last pick when it still exists', () => {
    expect(defaultEngineId(engines, 'gemini')).toBe('gemini');
  });
  test('falls back to the first engine when the last pick is gone', () => {
    expect(defaultEngineId(engines, 'deleted')).toBe('claude');
  });
  test('returns "" when there are no engines', () => {
    expect(defaultEngineId([], 'claude')).toBe('');
  });
});

describe('descriptor flags', () => {
  test('pinned panes are neither draggable nor closable', () => {
    expect(TAB_KINDS.pane.draggable).toBe(false);
    expect(TAB_KINDS.pane.closable).toBe(false);
  });
  test('user tab kinds are draggable and closable', () => {
    for (const kind of ['shell', 'ai', 'browser'] as const) {
      expect(TAB_KINDS[kind].draggable).toBe(true);
      expect(TAB_KINDS[kind].closable).toBe(true);
    }
  });
  test('panes have no makeTab; user kinds do', () => {
    expect(TAB_KINDS.pane.makeTab).toBeUndefined();
    expect(typeof TAB_KINDS.shell.makeTab).toBe('function');
    expect(typeof TAB_KINDS.ai.makeTab).toBe('function');
    expect(typeof TAB_KINDS.browser.makeTab).toBe('function');
  });
});

describe('makeTab', () => {
  test('shell makes an idle tab with an indexed title', () => {
    const t = TAB_KINDS.shell.makeTab?.({ id: 's1', index: 3, engineName: () => '' });
    expect(t).toMatchObject({ id: 's1', kind: 'shell', title: 'Shell 3', status: 'idle' });
  });
  test('ai titles by engine name and records the engine id', () => {
    const t = TAB_KINDS.ai.makeTab?.({
      id: 'a1',
      index: 1,
      engineId: 'claude',
      engineName: (id) => (id === 'claude' ? 'Claude' : id),
    });
    expect(t).toMatchObject({ id: 'a1', kind: 'ai', title: 'AI (Claude)', engine: 'claude' });
  });
  test('browser makes an indexed tab', () => {
    const t = TAB_KINDS.browser.makeTab?.({ id: 'b1', index: 2, engineName: () => '' });
    expect(t).toMatchObject({ id: 'b1', kind: 'browser', title: 'Browser 2' });
  });
});

describe('NEW_TAB_BUTTONS', () => {
  test('are ordered AI, shell, web by their declared order', () => {
    expect(NEW_TAB_BUTTONS.map((b) => b.testId)).toEqual(['new-ai', 'new-shell', 'new-browser']);
    expect(NEW_TAB_BUTTONS.map((b) => b.label)).toEqual(['+ AI', '+ shell', '+ web']);
  });
  test('+ AI is disabled and re-titled when no engines are configured', () => {
    const ai = NEW_TAB_BUTTONS.find((b) => b.testId === 'new-ai');
    expect(ai?.disabled?.(newCtx({ engines: [] }))).toBe(true);
    expect(ai?.title(newCtx({ engines: [] }))).toMatch(/Add an engine/);
  });
  test('+ AI is enabled with engines and clicks through with the default engine', () => {
    const ai = NEW_TAB_BUTTONS.find((b) => b.testId === 'new-ai');
    const onNewAi = vi.fn();
    const ctx = newCtx({ lastEngineId: 'gemini', onNewAi });
    expect(ai?.disabled?.(ctx)).toBe(false);
    ai?.onClick(ctx);
    expect(onNewAi).toHaveBeenCalledWith('gemini');
  });
});

describe('start-with-shortcut dropdowns', () => {
  const shortcuts = [
    { id: 'u1', label: 'Local dev', target: 'url' as const, url: 'localhost:3000' },
    { id: 't1', label: 'Dev server', target: 'terminal' as const, command: 'npm run dev' },
    { id: 'p1', label: 'App folder', target: 'project' as const, app: '/Applications/X.app' },
  ];

  test('+ shell lists only terminal shortcuts and seeds the command on pick', () => {
    const shell = NEW_TAB_BUTTONS.find((b) => b.testId === 'new-shell');
    const onNewShellWithCommand = vi.fn();
    const rows = shell?.dropdown?.(newCtx({ shortcuts, onNewShellWithCommand })) ?? [];
    expect(rows.map((r) => r.id)).toEqual(['t1']);
    expect(rows[0].detail).toBe('npm run dev');
    expect(rows[0].onLaunchExternal).toBeUndefined();
    rows[0].onPick();
    expect(onNewShellWithCommand).toHaveBeenCalledWith('npm run dev', 'Dev server');
  });

  test('+ web lists only url shortcuts and carries the two-icon open pair', () => {
    const web = NEW_TAB_BUTTONS.find((b) => b.testId === 'new-browser');
    const onNewBrowserWithUrl = vi.fn();
    const onLaunchUrlExternal = vi.fn();
    const rows =
      web?.dropdown?.(newCtx({ shortcuts, onNewBrowserWithUrl, onLaunchUrlExternal })) ?? [];
    expect(rows.map((r) => r.id)).toEqual(['u1']);
    rows[0].onPick();
    expect(onNewBrowserWithUrl).toHaveBeenCalledWith('localhost:3000', 'Local dev');
    rows[0].onLaunchExternal?.();
    expect(onLaunchUrlExternal).toHaveBeenCalledWith('localhost:3000');
  });

  test('+ AI has no start-with-shortcut dropdown', () => {
    expect(NEW_TAB_BUTTONS.find((b) => b.testId === 'new-ai')?.dropdown).toBeUndefined();
  });
});

describe('onClose', () => {
  test('an idle shell closes without a prompt', () => {
    const confirm = vi.spyOn(window, 'confirm');
    expect(TAB_KINDS.shell.onClose?.(tab({ id: 's1', kind: 'shell', status: 'idle' }))).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
  test('a running shell defers to the confirm dialog', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(TAB_KINDS.shell.onClose?.(tab({ id: 's1', kind: 'shell', status: 'running' }))).toBe(
      false,
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    expect(TAB_KINDS.shell.onClose?.(tab({ id: 's1', kind: 'shell', status: 'running' }))).toBe(
      true,
    );
  });
  test('closing a browser tab tears down its WebContentsView', () => {
    const browserDestroy = vi.fn();
    (window as unknown as { cockpit: { browserDestroy: (id: string) => void } }).cockpit = {
      browserDestroy,
    };
    expect(TAB_KINDS.browser.onClose?.(tab({ id: 'b1', kind: 'browser' }))).toBe(true);
    expect(browserDestroy).toHaveBeenCalledWith('b1');
  });
});

describe('stripAdornment renders the right glyph', () => {
  test('a running shell shows the running status dot', () => {
    render(TAB_KINDS.shell.stripAdornment?.(tab({ id: 's1', kind: 'shell', status: 'running' })));
    expect(screen.getByLabelText('running')).toBeTruthy();
  });
  test('an idle shell shows the idle status dot', () => {
    render(TAB_KINDS.shell.stripAdornment?.(tab({ id: 's1', kind: 'shell', status: 'idle' })));
    expect(screen.getByLabelText('idle')).toBeTruthy();
  });
  test('an AI tab shows the AI badge', () => {
    render(TAB_KINDS.ai.stripAdornment?.(tab({ id: 'a1', kind: 'ai' })));
    expect(screen.getByLabelText('AI tab')).toBeTruthy();
  });
});

describe('renderBody dispatches to the right body', () => {
  test('the publish pane renders the dedicated PublishPane', () => {
    render(TAB_KINDS.pane.renderBody(tab({ id: 'publish', kind: 'pane' }), true, renderCtx()));
    expect(screen.getByTestId('body-publish')).toBeTruthy();
  });
  test('the assistant pane renders the output feed; the host pane renders the session host', () => {
    render(TAB_KINDS.pane.renderBody(tab({ id: 'assistant', kind: 'pane' }), true, renderCtx()));
    expect(screen.getByTestId('body-assistant')).toBeTruthy();
    cleanup();
    render(
      TAB_KINDS.pane.renderBody(tab({ id: 'assistant-host', kind: 'pane' }), true, renderCtx()),
    );
    expect(screen.getByTestId('body-assistant-host')).toBeTruthy();
  });
  test('a pane with a matching spec renders a Pane labelled by the spec', () => {
    const ctx = renderCtx({
      paneSpecById: new Map<string, PaneSpec>([
        [
          'status',
          {
            id: 'status',
            title: 'Status',
            scope: 'lore',
            subRoot: 'status' as PaneSpec['subRoot'],
          },
        ],
      ]),
    });
    render(TAB_KINDS.pane.renderBody(tab({ id: 'status', kind: 'pane' }), true, ctx));
    expect(screen.getByTestId('body-pane').textContent).toBe('Status');
  });
  test('a pane with no spec renders nothing', () => {
    const body = TAB_KINDS.pane.renderBody(tab({ id: 'unknown', kind: 'pane' }), true, renderCtx());
    expect(body).toBeNull();
  });
  test('shell / ai / browser render their respective bodies', () => {
    render(TAB_KINDS.shell.renderBody(tab({ id: 's1', kind: 'shell' }), true, renderCtx()));
    expect(screen.getByTestId('body-shell')).toBeTruthy();
    cleanup();
    render(TAB_KINDS.ai.renderBody(tab({ id: 'a1', kind: 'ai' }), true, renderCtx()));
    expect(screen.getByTestId('body-ai')).toBeTruthy();
    cleanup();
    render(TAB_KINDS.browser.renderBody(tab({ id: 'b1', kind: 'browser' }), true, renderCtx()));
    expect(screen.getByTestId('body-browser')).toBeTruthy();
  });
});

describe('restored (dormant) tabs', () => {
  test('a restored shell stays dormant — banner, no live terminal', () => {
    render(
      TAB_KINDS.shell.renderBody(
        tab({ id: 's1', kind: 'shell', lastSession: { kind: 'shell', detail: 'npm run dev' } }),
        true,
        renderCtx(),
      ),
    );
    expect(screen.getByTestId('dormant-tab')).toBeTruthy();
    expect(screen.queryByTestId('body-shell')).toBeNull();
    expect(screen.getByTestId('restore-banner').textContent).toContain('npm run dev');
  });

  test('a restored browser stays dormant — banner, no WebContentsView', () => {
    render(
      TAB_KINDS.browser.renderBody(
        tab({
          id: 'b1',
          kind: 'browser',
          lastSession: { kind: 'browser', detail: 'https://example.com/' },
        }),
        true,
        renderCtx(),
      ),
    );
    expect(screen.getByTestId('dormant-tab')).toBeTruthy();
    expect(screen.queryByTestId('body-browser')).toBeNull();
    expect(screen.getByTestId('restore-banner').textContent).toContain('https://example.com/');
  });

  test('resuming a dormant shell clears its lastSession (via banner action)', () => {
    const clearLastSession = vi.fn();
    render(
      TAB_KINDS.shell.renderBody(
        tab({ id: 's1', kind: 'shell', lastSession: { kind: 'shell', detail: 'npm test' } }),
        true,
        renderCtx({ clearLastSession }),
      ),
    );
    screen.getByTestId('restore-banner-action').click();
    expect(clearLastSession).toHaveBeenCalledWith('s1');
  });

  test('the banner ✕ also clears the dormant tab', () => {
    const clearLastSession = vi.fn();
    render(
      TAB_KINDS.browser.renderBody(
        tab({ id: 'b1', kind: 'browser', lastSession: { kind: 'browser', detail: '' } }),
        true,
        renderCtx({ clearLastSession }),
      ),
    );
    screen.getByTestId('restore-banner-dismiss').click();
    expect(clearLastSession).toHaveBeenCalledWith('b1');
  });

  test('a restored AI tab shows the banner but its body stays mounted (already inert)', () => {
    render(
      TAB_KINDS.ai.renderBody(
        tab({
          id: 'a1',
          kind: 'ai',
          engine: 'claude',
          lastSession: { kind: 'ai', detail: 'Claude' },
        }),
        true,
        renderCtx(),
      ),
    );
    expect(screen.getByTestId('restore-banner').textContent).toContain('Claude');
    expect(screen.getByTestId('body-ai')).toBeTruthy();
  });
});
