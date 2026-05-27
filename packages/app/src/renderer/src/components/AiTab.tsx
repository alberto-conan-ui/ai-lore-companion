import type { EngineEntry } from '@ai-lore-companion/core';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import type { PromptEntry, TerminalForegroundStatus } from '../../../shared/ipc.js';

const TERMINAL_THEME = {
  background: '#0a0f17',
  foreground: '#dde3ea',
  cursor: '#5a9bd4',
  selectionBackground: '#1d2c3d',
};

/** Default + clamping for the prompts column width (Phase C). The default is
 *  the initial width on first-open; clamps protect both columns when the user
 *  drags the resize handle past sensible extremes (or imports a corrupt
 *  persisted value). */
const PROMPTS_DEFAULT_WIDTH = 220;
const PROMPTS_MIN_WIDTH = 160;
/** The right column needs at least this much room for xterm to lay out
 *  comfortably; the drag handler enforces it against the parent's width. */
const PTY_MIN_WIDTH = 240;

/**
 * An AI-session tab. Two states:
 *
 *   - **Empty** — a centred Start button + an inline engine dropdown. The
 *     dropdown defaults to this project's last-picked engine, falling back to
 *     the first available. The user picks an engine and clicks Start to spawn
 *     the PTY. If the engine just exited, the empty state also surfaces a
 *     `Restart` button — one-tap relaunch with the same engine.
 *   - **Running** — once Start fires, the tab body becomes a two-column split:
 *     a `PromptsColumn` on the left (placeholder in Phase C; populated in
 *     Phase D), the xterm PTY view on the right, with a draggable resize
 *     handle between them. The split's width persists per project.
 *
 * The tab's engine choice is recorded on the parent `WorkspaceTab.engine` via
 * `onEngineChange`, so the layout persists with the right preselect on
 * restart — and never auto-starts on restore.
 */
export function AiTab({
  active,
  tabId,
  engine,
  engines,
  onEngineChange,
  onStatus,
  onRunningChange,
}: {
  active: boolean;
  tabId: string;
  /** The engine id currently bound to this tab — `''` when none has been picked. */
  engine: string;
  /** All available engines — sourced from the global engines store via `App`. */
  engines: readonly EngineEntry[];
  /** Persist the engine pick on this tab (and write last-picked for the project). */
  onEngineChange: (engineId: string) => void;
  /** Bubble the PTY's foreground status up to the strip — drives the tab title. */
  onStatus: (tabId: string, status: TerminalForegroundStatus, command: string) => void;
  /** Notify the shell when the AI session transitions running ↔ idle (for title). */
  onRunningChange: (tabId: string, running: boolean) => void;
}): JSX.Element {
  const [ptyId, setPtyId] = useState<string | null>(null);
  /** Set when an engine just exited — the empty state shows Restart in
   *  addition to Start, and the engine dropdown stays preselected. */
  const [justExited, setJustExited] = useState(false);
  const selected =
    engines.find((e) => e.id === engine) ??
    // Fallback: the project's last pick may no longer exist (user removed it
    // in Settings); fall back to the first available so Start stays usable.
    engines[0] ??
    null;

  // Adopt the fallback as the active selection so the dropdown isn't out of
  // sync with what Start would actually launch.
  useEffect(() => {
    if (selected && selected.id !== engine) onEngineChange(selected.id);
  }, [selected, engine, onEngineChange]);

  const start = useCallback((): void => {
    if (!selected) return;
    void window.cockpit
      .spawnTerminalEngine({ binary: selected.binary, args: selected.args })
      .then((id) => {
        if (!id) return;
        setPtyId(id);
        setJustExited(false);
        onRunningChange(tabId, true);
      });
  }, [selected, tabId, onRunningChange]);

  // When the PTY exits (the user quits the engine), drop back to empty state
  // with the just-exited badge so the empty body offers Restart.
  useEffect(() => {
    if (!ptyId) return;
    return window.cockpit.onTerminalExit((p) => {
      if (p.id !== ptyId) return;
      setPtyId(null);
      setJustExited(true);
      onRunningChange(tabId, false);
    });
  }, [ptyId, tabId, onRunningChange]);

  if (ptyId === null) {
    return (
      <EmptyState
        engines={engines}
        selected={selected}
        onSelect={onEngineChange}
        onStart={start}
        justExited={justExited}
      />
    );
  }

  return <RunningSplit active={active} tabId={tabId} ptyId={ptyId} onStatus={onStatus} />;
}

// --- Empty state ----------------------------------------------------------

function EmptyState({
  engines,
  selected,
  onSelect,
  onStart,
  justExited,
}: {
  engines: readonly EngineEntry[];
  selected: EngineEntry | null;
  onSelect: (engineId: string) => void;
  onStart: () => void;
  /** True when the engine just exited — surfaces a Restart button on top of
   *  the standard Start affordance. */
  justExited: boolean;
}): JSX.Element {
  if (engines.length === 0) {
    return (
      <div style={wrapStyle} data-testid="ai-tab" data-ai-state="empty">
        <div style={cardStyle}>
          <div style={glyphStyle}>✦</div>
          <div style={titleStyle}>No engines configured</div>
          <div style={hintStyle}>
            Add an engine in <strong>Settings → Engines</strong> to start an AI session here.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div
      style={wrapStyle}
      data-testid="ai-tab"
      data-ai-state="empty"
      data-ai-engine={selected?.id ?? ''}
    >
      <div style={cardStyle}>
        <div style={glyphStyle}>✦</div>
        <div style={titleStyle}>
          {justExited ? 'Engine exited' : 'Start an AI session'}
        </div>
        <div style={launchRowStyle}>
          <button
            type="button"
            style={startBtnStyle}
            onClick={onStart}
            data-testid={justExited ? 'ai-restart' : 'ai-start'}
            disabled={!selected}
            title={selected ? `Launch ${selected.name}` : 'Pick an engine first'}
          >
            {justExited ? `↻ Restart ${selected?.name ?? ''}` : '▶ Start AI session'}
          </button>
          <select
            style={enginePickerStyle}
            value={selected?.id ?? ''}
            onChange={(e) => onSelect(e.target.value)}
            data-testid="ai-engine-picker"
            aria-label="AI engine"
          >
            {engines.map((eng) => (
              <option key={eng.id} value={eng.id}>
                {eng.name}
              </option>
            ))}
          </select>
        </div>
        <div style={hintStyle}>
          {justExited
            ? 'The engine has stopped. Restart relaunches with the same engine, or pick a different one.'
            : "The engine launches in this tab's shell, with the project folder as its working directory."}
        </div>
      </div>
    </div>
  );
}

// --- Running state --------------------------------------------------------

/**
 * The two-column running view (Phase C): scrollable prompts column + draggable
 * resizer + xterm PTY. The prompts column width is loaded from the per-project
 * store on mount and persisted on drag-end; column splits survive engine
 * restarts because the width lives outside the AI-tab body's lifecycle.
 */
function RunningSplit({
  active,
  tabId,
  ptyId,
  onStatus,
}: {
  active: boolean;
  tabId: string;
  ptyId: string;
  onStatus: (tabId: string, status: TerminalForegroundStatus, command: string) => void;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [columnWidth, setColumnWidth] = useState<number>(PROMPTS_DEFAULT_WIDTH);

  useEffect(() => {
    void window.cockpit.aiPromptsWidthGet().then((w) => {
      if (w !== null && Number.isFinite(w) && w >= PROMPTS_MIN_WIDTH) {
        setColumnWidth(w);
      }
    });
  }, []);

  /** Clamp a candidate width against (a) the prompts-column floor and (b) the
   *  PTY's minimum, computed live from the container's measured width. */
  const clamp = useCallback((candidate: number): number => {
    const container = containerRef.current;
    const max = container ? container.clientWidth - PTY_MIN_WIDTH : candidate;
    return Math.max(PROMPTS_MIN_WIDTH, Math.min(candidate, max));
  }, []);

  const handleResizeStart = (e: React.MouseEvent): void => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const containerLeft = container.getBoundingClientRect().left;
    const onMove = (ev: MouseEvent): void => {
      setColumnWidth(clamp(ev.clientX - containerLeft));
    };
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      // Persist on drag-end — reading the latest state via the setter form so
      // the closure doesn't capture a stale value.
      setColumnWidth((current) => {
        void window.cockpit.aiPromptsWidthSet(current);
        return current;
      });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={containerRef}
      style={splitContainerStyle}
      data-testid="ai-tab"
      data-ai-state="running"
    >
      <div
        style={{ ...promptsColumnStyle, width: columnWidth }}
        data-testid="ai-prompts-column"
        data-prompts-width={columnWidth}
      >
        <PromptsColumn ptyId={ptyId} />
      </div>
      <div
        style={resizerStyle}
        data-testid="ai-prompts-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize prompts column"
        onMouseDown={handleResizeStart}
      />
      <div style={ptyColumnStyle}>
        <RunningPty active={active} tabId={tabId} ptyId={ptyId} onStatus={onStatus} />
      </div>
    </div>
  );
}

/**
 * The verbs catalog (Phase D). Reads the project's vendored verbs via
 * `promptsList`, listens for `PromptsChanged` so a methodology upgrade
 * surfaces new verbs in a live tab. Click a row → write the slash form
 * (no trailing newline) into the engine's stdin so the user can massage
 * the prompt — add a parameter, edit the verb, or abort — before
 * submitting it themselves.
 *
 * Rows are grouped by a hardcoded taxonomy mirroring `verbs.index.md`'s
 * functional split. Any verb not in the taxonomy lands in Advanced, which is
 * collapsed by default so the curated groups stay visible.
 */
function PromptsColumn({ ptyId }: { ptyId: string }): JSX.Element {
  const [prompts, setPrompts] = useState<PromptEntry[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    void window.cockpit.promptsList().then(setPrompts);
    return window.cockpit.onPromptsChanged(() => {
      void window.cockpit.promptsList().then(setPrompts);
    });
  }, []);

  const inject = (slash: string): void => {
    // No `\n` — the user submits when they're ready. Lets them edit the
    // verb in place (e.g. tack on `--challenge` or a free-form note) and
    // catches the case where they clicked the wrong one by accident.
    window.cockpit.sendTerminalInput({ id: ptyId, data: slash });
  };

  const grouped = groupPrompts(prompts);

  return (
    <div style={promptsListStyle} data-testid="prompts-column">
      {PROMPT_GROUPS.map((group) => {
        const rows = grouped[group.label] ?? [];
        if (rows.length === 0) return null;
        return (
          <PromptGroup key={group.label} label={group.label} rows={rows} onClick={inject} />
        );
      })}
      {grouped.Advanced && grouped.Advanced.length > 0 ? (
        <div>
          <button
            type="button"
            style={advancedToggleStyle}
            onClick={() => setAdvancedOpen((o) => !o)}
            data-testid="prompts-advanced-toggle"
          >
            {advancedOpen ? '▾' : '▸'} Advanced
          </button>
          {advancedOpen ? (
            <PromptGroup label="" rows={grouped.Advanced} onClick={inject} hideHeader />
          ) : null}
        </div>
      ) : null}
      {prompts.length === 0 ? (
        <div style={promptsEmptyStyle}>No verbs found under <code>process/verbs/</code>.</div>
      ) : null}
    </div>
  );
}

function PromptGroup({
  label,
  rows,
  onClick,
  hideHeader,
}: {
  label: string;
  rows: PromptEntry[];
  onClick: (slash: string) => void;
  hideHeader?: boolean;
}): JSX.Element {
  return (
    <div style={promptGroupStyle}>
      {hideHeader ? null : <div style={promptGroupHeader}>{label}</div>}
      {rows.map((p) => (
        <button
          key={p.name}
          type="button"
          style={promptRowStyle}
          onClick={() => onClick(p.slash)}
          title={p.description || p.slash}
          data-testid={`prompt-row-${p.name}`}
        >
          <span style={promptSlashStyle}>{p.slash}</span>
          {p.description ? <span style={promptDescStyle}>{p.description}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Curated taxonomy for the catalog. Any verb not named here falls into
 *  Advanced. Order in the array dictates display order. */
const PROMPT_GROUPS: { label: string; verbs: readonly string[] }[] = [
  { label: 'Orient & talk', verbs: ['orient', 'chat', 'redial'] },
  { label: 'Work', verbs: ['plan', 'execute', 'reshape', 'write-lore'] },
  { label: 'Acknowledge', verbs: ['ack', 'save-point'] },
  { label: 'Close', verbs: ['close-session'] },
];

/** Sort prompts into the curated groups, with everything else in Advanced. */
function groupPrompts(prompts: readonly PromptEntry[]): Record<string, PromptEntry[]> {
  const byName = new Map(prompts.map((p) => [p.name, p]));
  const out: Record<string, PromptEntry[]> = {};
  const claimed = new Set<string>();
  for (const group of PROMPT_GROUPS) {
    const rows: PromptEntry[] = [];
    for (const name of group.verbs) {
      const p = byName.get(name);
      if (!p) continue;
      rows.push(p);
      claimed.add(name);
    }
    if (rows.length > 0) out[group.label] = rows;
  }
  const advanced = prompts.filter((p) => !claimed.has(p.name));
  if (advanced.length > 0) out.Advanced = advanced;
  return out;
}

/** The xterm host. Identical to TerminalTab's surface in shape; mounted only
 *  inside `RunningSplit` so it never has to negotiate its parent layout. */
function RunningPty({
  active,
  tabId,
  ptyId,
  onStatus,
}: {
  active: boolean;
  tabId: string;
  ptyId: string;
  onStatus: (tabId: string, status: TerminalForegroundStatus, command: string) => void;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const doFit = useCallback(() => {
    const host = hostRef.current;
    const term = termRef.current;
    const fit = fitRef.current;
    if (!host || !term || !fit || host.offsetParent === null) return;
    fit.fit();
    window.cockpit.resizeTerminal({ id: ptyId, cols: term.cols, rows: term.rows });
  }, [ptyId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      theme: TERMINAL_THEME,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, "Symbols Nerd Font Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    // Mirror TerminalTab: Shift+Enter sends LF (newline-insert in Claude /
    // Gemini), bare Enter sends submit.
    term.attachCustomKeyEventHandler((e) => {
      if (e.key === 'Enter' && e.shiftKey) {
        if (e.type === 'keydown') {
          window.cockpit.sendTerminalInput({ id: ptyId, data: '\n' });
        }
        return false;
      }
      return true;
    });

    window.cockpit.resizeTerminal({ id: ptyId, cols: term.cols, rows: term.rows });

    const offData = window.cockpit.onTerminalData((p) => {
      if (p.id === ptyId) term.write(p.data);
    });
    const offExit = window.cockpit.onTerminalExit((p) => {
      if (p.id === ptyId) term.write('\r\n\x1b[2m[engine exited]\x1b[0m\r\n');
    });
    const offStatus = window.cockpit.onTerminalStatus((p) => {
      if (p.id === ptyId) onStatus(tabId, p.status, p.command);
    });
    term.onData((data) => window.cockpit.sendTerminalInput({ id: ptyId, data }));
    term.focus();

    const onResize = (): void => doFit();
    window.addEventListener('resize', onResize);
    // Refit on container resize — covers both window resize and the prompts
    // column's drag handle changing the PTY's width.
    const resizeObserver = new ResizeObserver(() => doFit());
    resizeObserver.observe(host);

    return () => {
      window.removeEventListener('resize', onResize);
      resizeObserver.disconnect();
      offData();
      offExit();
      offStatus();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [ptyId, doFit, onStatus, tabId]);

  useEffect(() => {
    if (active) {
      doFit();
      termRef.current?.focus();
    }
  }, [active, doFit]);

  return (
    <div style={runningWrapStyle}>
      <div ref={hostRef} style={runningHostStyle} />
    </div>
  );
}

// --- Styles ---------------------------------------------------------------

const wrapStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  alignItems: 'center',
  justifyContent: 'center',
  background: '#0a0f17',
  color: '#dde3ea',
  padding: '1rem',
};

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.6rem',
  textAlign: 'center',
  maxWidth: '28rem',
};

const glyphStyle: React.CSSProperties = {
  fontSize: '2rem',
  lineHeight: 1,
  color: '#c7b3ff',
};

const titleStyle: React.CSSProperties = {
  fontSize: '0.95rem',
  fontWeight: 600,
};

const hintStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: '#6c7783',
  lineHeight: 1.5,
};

const launchRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  gap: '0.5rem',
  marginTop: '0.4rem',
};

const startBtnStyle: React.CSSProperties = {
  padding: '0.55rem 1.1rem',
  background: '#5a3ec2',
  border: '1px solid #7757d8',
  borderRadius: '5px',
  color: '#f3eeff',
  fontSize: '0.88rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const enginePickerStyle: React.CSSProperties = {
  padding: '0.4rem 0.65rem',
  background: '#101822',
  border: '1px solid #243044',
  borderRadius: '5px',
  color: '#dde3ea',
  fontSize: '0.85rem',
  fontWeight: 500,
  cursor: 'pointer',
};

const splitContainerStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  background: '#0a0f17',
};

const promptsColumnStyle: React.CSSProperties = {
  flexShrink: 0,
  overflowY: 'auto',
  background: '#0c121a',
  borderRight: '1px solid #1a2230',
};

const resizerStyle: React.CSSProperties = {
  flexShrink: 0,
  width: '4px',
  background: '#1a2230',
  cursor: 'col-resize',
};

const ptyColumnStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minWidth: 0,
};

const promptsListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: '0.5rem 0',
  gap: '0.4rem',
};

const promptGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const promptGroupHeader: React.CSSProperties = {
  padding: '0.35rem 0.85rem 0.15rem',
  fontSize: '0.68rem',
  fontWeight: 700,
  color: '#7a8590',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
};

const promptRowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '0.1rem',
  padding: '0.3rem 0.85rem',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  textAlign: 'left',
  width: '100%',
  font: 'inherit',
};

const promptSlashStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  fontSize: '0.78rem',
  fontWeight: 600,
  color: '#c7b3ff',
};

const promptDescStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: '#8a96a2',
  lineHeight: 1.35,
  // Keep descriptions to a single line — the row title attribute carries
  // the full text on hover.
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  width: '100%',
};

const advancedToggleStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '0.35rem 0.85rem',
  background: 'transparent',
  border: 'none',
  color: '#7a8590',
  fontSize: '0.7rem',
  fontWeight: 600,
  textAlign: 'left',
  cursor: 'pointer',
  letterSpacing: '0.04em',
};

const promptsEmptyStyle: React.CSSProperties = {
  padding: '0.85rem 0.85rem',
  fontSize: '0.78rem',
  color: '#6c7783',
  lineHeight: 1.5,
};

const runningWrapStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  background: '#0a0f17',
  padding: '4px 6px',
};

const runningHostStyle: React.CSSProperties = {
  height: '100%',
  width: '100%',
};
