import type { EngineEntry } from '@ai-lore-companion/core';
import { type JSX, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { PromptEntry, TerminalForegroundStatus } from '../../../shared/ipc.js';
import { FindBar } from './FindBar.js';
import { SidebarTab } from './SidebarTab.js';
import { useTerminalFindShortcut, useXtermSession } from './useXtermSession.js';

/** Default + clamping for the prompts column width (Phase C). The default is
 *  the initial width on first-open; clamps protect both columns when the user
 *  drags the resize handle past sensible extremes (or imports a corrupt
 *  persisted value). */
const PROMPTS_DEFAULT_WIDTH = 220;
const PROMPTS_MIN_WIDTH = 160;
/** The right column needs at least this much room for xterm to lay out
 *  comfortably; the drag handler enforces it against the parent's width. */
const PTY_MIN_WIDTH = 240;

/** Sentinel `<option>` value for the "+ Add engine…" item in the engine
 *  dropdown — picking it routes to Settings → Engines, not an engine select. */
const ADD_ENGINE_SENTINEL = '__add-engine__';

/** What starting a guarded session in a Space window answers. `message` is shown as it is. */
export type AiTabSpaceStart =
  | { ok: true; sessionId: string; ptyId: string }
  | { ok: false; message: string };

/**
 * What an AI tab of a Space window (phase M4.6) uses in place of the cockpit's
 * engine start. When it is given, Start never calls `spawnTerminalEngine`:
 * `start` is the guarded start of the Space (`spaceSessionStart`). The header
 * sits above the terminal and the sidebar replaces the prompts catalog.
 * Without it the tab is the cockpit's, unchanged.
 */
export type AiTabSpace = {
  start: (engineId: string) => Promise<AiTabSpaceStart>;
  /** Start once when the tab mounts: a tab made by `+ AI`. A restored tab stays dormant. */
  autoStart: boolean;
  /** The tab's session started (its id) or ended (`null`). */
  onSessionChange: (sessionId: string | null) => void;
  header: (sessionId: string) => ReactNode;
  sidebar: (ptyId: string, focusPty: () => void) => JSX.Element;
  /** The sentence under Start. */
  hint: string;
};

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
  space,
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
  /** Set in a Space window only: the guarded start, the header and the Skills column. */
  space?: AiTabSpace;
}): JSX.Element {
  const [ptyId, setPtyId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  /** Why the guarded start refused, shown in the empty state (Space window only). */
  const [startError, setStartError] = useState<string | null>(null);
  const spaceRef = useRef(space);
  spaceRef.current = space;
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

  const starting = useRef(false);
  const start = useCallback((): void => {
    if (!selected) return;
    const guarded = spaceRef.current;
    if (guarded) {
      // A Space window: the guarded start only, never the cockpit's engine spawn.
      if (starting.current) return;
      starting.current = true;
      setStartError(null);
      void guarded.start(selected.id).then((started) => {
        starting.current = false;
        if (!started.ok) {
          setStartError(started.message);
          return;
        }
        setPtyId(started.ptyId);
        setSessionId(started.sessionId);
        setJustExited(false);
        (spaceRef.current ?? guarded).onSessionChange(started.sessionId);
        onRunningChange(tabId, true);
      });
      return;
    }
    void window.cockpit
      .spawnTerminalEngine({ binary: selected.binary, args: selected.args })
      .then((id) => {
        if (!id) return;
        setPtyId(id);
        setJustExited(false);
        onRunningChange(tabId, true);
      });
  }, [selected, tabId, onRunningChange]);

  // A tab made by `+ AI` in a Space window starts once; a restored one waits for Start.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !spaceRef.current?.autoStart || !selected) return;
    autoStarted.current = true;
    start();
  }, [selected, start]);

  // When the PTY exits (the user quits the engine), drop back to empty state
  // with the just-exited badge so the empty body offers Restart.
  useEffect(() => {
    if (!ptyId) return;
    return window.cockpit.onTerminalExit((p) => {
      if (p.id !== ptyId) return;
      setPtyId(null);
      setJustExited(true);
      if (spaceRef.current) {
        setSessionId(null);
        spaceRef.current.onSessionChange(null);
      }
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
        {...(space ? { hint: space.hint, error: startError } : {})}
      />
    );
  }

  if (space && sessionId !== null) {
    return (
      <RunningSplit
        active={active}
        tabId={tabId}
        ptyId={ptyId}
        onStatus={onStatus}
        header={space.header(sessionId)}
        sidebar={space.sidebar}
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
  hint,
  error,
}: {
  engines: readonly EngineEntry[];
  selected: EngineEntry | null;
  onSelect: (engineId: string) => void;
  onStart: () => void;
  /** True when the engine just exited — surfaces a Restart button on top of
   *  the standard Start affordance. */
  justExited: boolean;
  /** Space window: the sentence under Start, in place of the cockpit's. */
  hint?: string;
  /** Space window: why the last start was refused. */
  error?: string | null;
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
        <div style={titleStyle}>{justExited ? 'Engine exited' : 'Start an AI session'}</div>
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
            onChange={(e) => {
              if (e.target.value === ADD_ENGINE_SENTINEL) {
                // Deep-link Settings → Engines via the renderer-side signal
                // TrackerStrip listens for. The dropdown's value prop snaps
                // back to the previously selected engine on re-render.
                window.dispatchEvent(
                  new CustomEvent('ai-lore:open-settings', {
                    detail: { section: 'engines' },
                  }),
                );
                return;
              }
              onSelect(e.target.value);
            }}
            data-testid="ai-engine-picker"
            aria-label="AI engine"
          >
            {engines.map((eng) => (
              <option key={eng.id} value={eng.id}>
                {eng.name}
              </option>
            ))}
            <option disabled>──────────</option>
            <option value={ADD_ENGINE_SENTINEL} data-testid="ai-engine-picker-add">
              + Add engine…
            </option>
          </select>
        </div>
        <div style={hintStyle}>
          {justExited
            ? 'The engine has stopped. Restart relaunches with the same engine, or pick a different one.'
            : (hint ??
              "The engine launches in this tab's shell, with the project folder as its working directory.")}
        </div>
        {error ? (
          <div style={errorStyle} role="alert" data-testid="ai-start-error">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// --- Running state --------------------------------------------------------

/**
 * The two-column running view: prompts catalog on the left, xterm PTY on the
 * right. Built on the generic `SidebarTab` shell, which provides the
 * resize/collapse/×-close mechanics shared with the Shell tab.
 */
function RunningSplit({
  active,
  tabId,
  ptyId,
  onStatus,
  header,
  sidebar,
}: {
  active: boolean;
  tabId: string;
  ptyId: string;
  onStatus: (tabId: string, status: TerminalForegroundStatus, command: string) => void;
  /** Space window: the session header, one line above the split. */
  header?: ReactNode;
  /** Space window: the Skills column, in place of the prompts catalog. */
  sidebar?: (ptyId: string, focusPty: () => void) => JSX.Element;
}): JSX.Element {
  // The PTY publishes a focus handle so clicking a verb in the prompts
  // column hands focus back to the terminal — no extra trip to type the
  // continuation.
  const focusPtyRef = useRef<() => void>(() => {});
  const focusPty = useCallback((): void => focusPtyRef.current(), []);
  if (sidebar !== undefined) {
    // A Space window saves no width into the v0.8 settings file, so the width is not persisted.
    return (
      <div style={aiSpaceWrapperStyle} data-testid="ai-tab" data-ai-state="running">
        {header}
        <div style={aiRunningWrapperStyle}>
          <SidebarTab
            testIdPrefix="ai-skills"
            icon="✦"
            label="Skills"
            defaultWidth={PROMPTS_DEFAULT_WIDTH}
            expandTitle="Show skills"
            collapseTitle="Hide skills"
            hideTitle="Hide skills"
            sidebar={sidebar(ptyId, focusPty)}
            content={
              <RunningPty
                active={active}
                tabId={tabId}
                ptyId={ptyId}
                onStatus={onStatus}
                focusPtyRef={focusPtyRef}
              />
            }
          />
        </div>
      </div>
    );
  }
  return (
    <div style={aiRunningWrapperStyle} data-testid="ai-tab" data-ai-state="running">
      <SidebarTab
        testIdPrefix="ai-prompts"
        icon="✦"
        label="Prompts"
        defaultWidth={PROMPTS_DEFAULT_WIDTH}
        loadWidth={() => window.cockpit.aiPromptsWidthGet()}
        saveWidth={(w) => window.cockpit.aiPromptsWidthSet(w)}
        expandTitle="Show prompts"
        collapseTitle="Hide prompts"
        hideTitle="Hide prompts"
        sidebar={<PromptsColumn ptyId={ptyId} focusPty={focusPty} />}
        content={
          <RunningPty
            active={active}
            tabId={tabId}
            ptyId={ptyId}
            onStatus={onStatus}
            focusPtyRef={focusPtyRef}
          />
        }
      />
    </div>
  );
}

const aiRunningWrapperStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
};

const aiSpaceWrapperStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
};

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
 *
 * The whole catalog sits behind a `▸ Skills` toggle, collapsed by default: when
 * the AI-Lore skills are installed, `claude` autocompletes the `/ai-lore-<verb>`
 * slash forms natively, so an always-expanded list is redundant chrome. The
 * toggle keeps it one click away without filling the sidebar.
 */
export function PromptsColumn({
  ptyId,
  focusPty,
}: {
  ptyId: string;
  focusPty: () => void;
}): JSX.Element {
  const [prompts, setPrompts] = useState<PromptEntry[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // The catalog is redundant once the skills are installed (the CLI
  // autocompletes the slash forms), so it starts collapsed.
  const [skillsOpen, setSkillsOpen] = useState(false);
  // null = still checking — render the collapsed `▸ Skills` toggle so the full
  // catalog never flashes before the check resolves; false → this project is on
  // the plain-text path, so the `/ai-lore-<verb>` slash forms wouldn't resolve —
  // show the bootstrap hint instead of the catalog.
  const [installed, setInstalled] = useState<boolean | null>(null);

  useEffect(() => {
    void window.cockpit.promptsList().then(setPrompts);
    return window.cockpit.onPromptsChanged(() => {
      void window.cockpit.promptsList().then(setPrompts);
    });
  }, []);

  useEffect(() => {
    void window.cockpit.engineBindingInstalled().then(setInstalled);
  }, []);

  const inject = (slash: string): void => {
    // No `\n` — the user submits when they're ready. Lets them edit the
    // verb in place (e.g. tack on `--challenge` or a free-form note) and
    // catches the case where they clicked the wrong one by accident.
    window.cockpit.sendTerminalInput({ id: ptyId, data: slash });
    // Send focus back to the PTY so the user can keep typing without an
    // extra click on the terminal area.
    focusPty();
  };

  // Plain-text project — the verbs aren't wired as slash commands, so offering
  // the catalog would mislead. Point the user at the one-line bootstrap instead.
  if (installed === false) {
    return (
      <div style={promptsListStyle} data-testid="prompts-column">
        <div data-testid="prompts-bootstrap-hint">
          <div style={promptGroupHeader}>Plain-text project</div>
          <div style={promptsEmptyStyle}>
            AI-Lore isn’t installed as slash commands here. Start the session by loading the
            methodology, then the verbs become available:
          </div>
          <button
            type="button"
            style={promptRowStyle}
            onClick={() => inject('read ai_readme.md')}
            title="Insert “read ai_readme.md” into the engine"
            data-testid="prompt-bootstrap-readme"
          >
            <span style={promptSlashStyle}>read ai_readme.md</span>
            <span style={promptDescStyle}>Loads AI-Lore from the project’s ai_readme.md shim</span>
          </button>
        </div>
      </div>
    );
  }

  const grouped = groupPrompts(prompts);

  const catalog = (
    <>
      {PROMPT_GROUPS.map((group) => {
        const rows = grouped[group.label] ?? [];
        if (rows.length === 0) return null;
        return <PromptGroup key={group.label} label={group.label} rows={rows} onClick={inject} />;
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
        <div style={promptsEmptyStyle}>
          No verbs found under <code>process/verbs/</code>.
        </div>
      ) : null}
    </>
  );

  return (
    <div style={promptsListStyle} data-testid="prompts-column">
      <button
        type="button"
        style={advancedToggleStyle}
        onClick={() => setSkillsOpen((o) => !o)}
        data-testid="prompts-skills-toggle"
      >
        {skillsOpen ? '▾' : '▸'} Skills
      </button>
      {skillsOpen ? catalog : null}
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

/** The xterm host for a running engine. Drives the same shared `useXtermSession`
 *  hook as the Shell tab — the engine PTY is spawned by `AiTab` (so the id is
 *  passed in, not spawned here) and its lifetime is managed there (Restart
 *  re-uses the tab), so this view does not kill the PTY on unmount. Publishes a
 *  focus handle through `focusPtyRef` so siblings (the prompts column) can hand
 *  focus back to the terminal after a click. */
function RunningPty({
  active,
  tabId,
  ptyId,
  onStatus,
  focusPtyRef,
}: {
  active: boolean;
  tabId: string;
  ptyId: string;
  onStatus: (tabId: string, status: TerminalForegroundStatus, command: string) => void;
  focusPtyRef: React.MutableRefObject<() => void>;
}): JSX.Element {
  const [findOpen, setFindOpen] = useState(false);
  const { hostRef, focus, search } = useXtermSession({
    active,
    ptyId,
    killOnUnmount: false,
    exitMessage: '[engine exited]',
    onStatus: (status, command) => onStatus(tabId, status, command),
  });
  useTerminalFindShortcut(
    hostRef,
    useCallback(() => setFindOpen(true), []),
  );

  // Publish the focus handle so siblings (PromptsColumn) can refocus the
  // terminal after a click — caller invokes it via the ref's `.current`.
  useEffect(() => {
    focusPtyRef.current = focus;
    return () => {
      focusPtyRef.current = () => {};
    };
  }, [focus, focusPtyRef]);

  return (
    <div style={runningWrapStyle}>
      <div ref={hostRef} style={runningHostStyle} />
      {findOpen ? (
        <FindBar
          search={search}
          onClose={() => {
            setFindOpen(false);
            focus();
          }}
        />
      ) : null}
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
  background: 'var(--color-shell)',
  color: 'var(--color-text)',
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
  color: 'var(--color-purple)',
};

const titleStyle: React.CSSProperties = {
  fontSize: '0.95rem',
  fontWeight: 600,
};

const hintStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--color-text-muted)',
  lineHeight: 1.5,
};

const errorStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--color-danger, var(--color-text))',
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
  background: 'var(--color-purple-strong)',
  border: '1px solid var(--color-purple-border)',
  borderRadius: '5px',
  color: 'var(--color-purple-fg)',
  fontSize: '0.88rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const enginePickerStyle: React.CSSProperties = {
  padding: '0.4rem 0.65rem',
  background: 'var(--color-inset)',
  border: '1px solid var(--color-border-2)',
  borderRadius: '5px',
  color: 'var(--color-text)',
  fontSize: '0.85rem',
  fontWeight: 500,
  cursor: 'pointer',
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
  color: 'var(--color-text-soft)',
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
  color: 'var(--color-purple)',
};

const promptDescStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: 'var(--color-text-dim)',
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
  color: 'var(--color-text-soft)',
  fontSize: '0.7rem',
  fontWeight: 600,
  textAlign: 'left',
  cursor: 'pointer',
  letterSpacing: '0.04em',
};

const promptsEmptyStyle: React.CSSProperties = {
  padding: '0.85rem 0.85rem',
  fontSize: '0.78rem',
  color: 'var(--color-text-muted)',
  lineHeight: 1.5,
};

const runningWrapStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  background: 'var(--color-shell)',
  padding: '4px 6px',
};

const runningHostStyle: React.CSSProperties = {
  height: '100%',
  width: '100%',
};
