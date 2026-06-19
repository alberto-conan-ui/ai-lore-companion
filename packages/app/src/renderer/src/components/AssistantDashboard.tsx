import { type JSX, useEffect, useRef, useState } from 'react';
import type { HelperPhase } from '../../../shared/ipc.js';
import { pushActivity } from './activityLog.js';
import { isBusy, isConnected } from './assistantShared.js';
import './StatusPanel.css';

/**
 * The AI-assistant **status dashboard** (AI Helper, CR9 Phase 4) — the left-rail
 * Assistant surface. The v1.0 insight (HL): a read-only assistant that answers
 * in prose just makes new *walls of text*; it should hand back a **designed,
 * glanceable picture of where the project stands**.
 *
 * **Design-first spike (HL): forget the AI, find the dashboard, then hydrate.**
 * The look is a near-verbatim port of the HL's Claude-design exploration
 * ("Direction A — stream rows + scored health"): the JSX mirrors `StatusPanel.jsx`
 * and the styling is the sibling **`StatusPanel.css`** (copied as-is, namespaced
 * under `.status-panel`). Each {@link StatusData} reads as a **portfolio of
 * work-streams** (one row each, verdict-coloured with progress) plus **scored
 * health signals**; the **save-point** is the only real "caught up" anchor.
 *
 * The Assistant pane is **tabbed like the Project pane** — Status / Payload /
 * Memory. **Status** is a {@link FocusBoard}: a slim roll-up line + a stack of
 * **focus widgets**, one per focus in scope — the active focus (ring + derived
 * steps + "you are here"), any hanging-but-unarchived focus (flagged), and a
 * synthetic **headless focus** that collects loose-ends no active focus owns.
 * **Payload / Memory** stay the scored {@link StatusData} dashboard (coverage /
 * quality / lint; sign-off / consistency / tidiness). All **hand-written sample
 * data** for now ({@link TABS}); hydration re-attaches later, the shape
 * unchanged. Type is Geist/Geist Mono with system fallbacks.
 */

type Verdict = 'on-track' | 'in-progress' | 'at-risk' | 'not-started' | 'blocked';
type Tone = 'green' | 'amber' | 'red' | 'muted';
type GlyphKind = 'done' | 'good' | 'active' | 'todo' | 'warn' | 'note';

type Signal = {
  id: string;
  title: string;
  subtitle: string;
  score: number;
  label: string;
  solid?: string[];
  attention: string[];
};
type Stream = { name: string; line: string; verdict: Verdict; progress: number; active?: boolean };

/* ---------- focus board (the Status tab) ---------- */
/** Each focus in scope is one widget; the widget flexes by the focus's state. */
type FocusKind = 'active' | 'paused' | 'hanging' | 'headless';
/** One flagged item the headless focus collects from the project-wide sweep. */
type AttentionItem = { source: string; text: string; since?: string; detail?: string };
type FocusWidget = {
  id: string;
  name: string;
  kind: FocusKind;
  line: string;
  /** Completion estimate (0–100) — active/paused/hanging; omitted for headless. */
  estimate?: number;
  /** Derived steps under an active/paused focus. */
  steps?: Stream[];
  /** Why a hanging focus still needs attention (e.g. shipped but not archived). */
  note?: string;
  /** The headless focus's collected loose-ends. */
  attention?: AttentionItem[];
};
/** Sign-off currency — its own concern, not a loose-end nobody owns. How long
 * since the work was last formally signed off / reviewed as a milestone. */
type Staleness = {
  state: 'current' | 'behind';
  label: string;
  since: string;
  text: string;
  detail?: string;
};
export type FocusBoard = {
  project: string;
  crumb?: string;
  /** The slim roll-up line above the stack. */
  rollup: { inPlay: number; active: number; hanging: number; looseEnds: number };
  /** The staleness banner — sign-off currency, shown above the focus stack. */
  staleness?: Staleness;
  focuses: FocusWidget[];
};

export type StatusData = {
  project: string;
  release: string;
  crumb?: string;
  now: string;
  verdict: Verdict;
  streams: Stream[];
  caughtUp: { date: string; context: string; items: string[] };
  watching: string[];
  /** The domain-specific scored health signals for this tab (2–3 cards). */
  signals: Signal[];
};

const SP_VERDICTS: Record<Verdict, { label: string; tone: Tone; glyph: GlyphKind }> = {
  'on-track': { label: 'On track', tone: 'green', glyph: 'done' },
  'in-progress': { label: 'In progress', tone: 'amber', glyph: 'active' },
  'at-risk': { label: 'At risk', tone: 'amber', glyph: 'warn' },
  'not-started': { label: 'Not started', tone: 'muted', glyph: 'todo' },
  blocked: { label: 'Blocked', tone: 'red', glyph: 'warn' },
};

const spScoreTone = (n: number): Tone => (n >= 70 ? 'green' : n >= 40 ? 'amber' : 'red');

function spRollup(streams: Stream[]): { pct: number; shipped: number; total: number } {
  const pct = Math.round(streams.reduce((a, x) => a + x.progress, 0) / streams.length);
  const shipped = streams.filter((x) => x.progress >= 100).length;
  return { pct, shipped, total: streams.length };
}

/* ---------- hooks ---------- */
function useMounted(delay = 90): boolean {
  const [m, setM] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setM(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return m;
}

function useCountUp(target: number, mounted: boolean, dur = 1100): number {
  const [v, setV] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    if (!mounted) return;
    let start = 0;
    const step = (t: number): void => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / dur);
      setV(target * (1 - (1 - p) ** 3));
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [mounted, target, dur]);
  return v;
}

/* ---------- primitives ---------- */
function ProgressRing({
  value,
  size = 96,
  stroke = 8,
  tone = 'green',
  mounted,
  unit = '%',
}: {
  value: number;
  size?: number;
  stroke?: number;
  tone?: Tone;
  mounted: boolean;
  unit?: string;
}): JSX.Element {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = useCountUp(value, mounted);
  const off = c * (1 - value / 100);
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <title>progress</title>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="ring-track"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className={`ring-fill ${tone !== 'green' ? tone : ''}`}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={mounted ? off : c}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring-label">
        <span className="ring-pct" style={{ fontSize: size * 0.3 }}>
          {Math.round(v)}
          {unit ? <i>{unit}</i> : null}
        </span>
      </div>
    </div>
  );
}

function Glyph({ kind, size = 18 }: { kind: GlyphKind; size?: number }): JSX.Element | null {
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 18 18',
    className: `glyph g-${kind}`,
    fill: 'none' as const,
  };
  switch (kind) {
    case 'done':
    case 'good':
      return (
        <svg {...p} aria-hidden="true">
          <circle cx="9" cy="9" r="8.2" stroke="none" />
          <path
            d="M5.4 9.3 l2.3 2.4 l4.9-5.2"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'active':
      return (
        <svg {...p} aria-hidden="true">
          <circle className="g-ring" cx="9" cy="9" r="7" strokeWidth="1.7" />
          <path className="g-half" d="M9 2.6 a6.4 6.4 0 0 1 0 12.8 z" />
        </svg>
      );
    case 'todo':
      return (
        <svg {...p} aria-hidden="true">
          <circle cx="9" cy="9" r="6.6" strokeWidth="1.6" />
        </svg>
      );
    case 'warn':
      return (
        <svg {...p} aria-hidden="true">
          <path d="M9 2.6 L16 15 L2 15 Z" strokeWidth="1.6" strokeLinejoin="round" />
          <path className="g-bang" d="M9 7 v3.4" strokeWidth="1.6" strokeLinecap="round" />
          <circle className="g-bang" cx="9" cy="12.6" r="0.2" strokeWidth="1.4" />
        </svg>
      );
    case 'note':
      return (
        <svg {...p} aria-hidden="true">
          <path d="M9 2.6 L15.4 9 L9 15.4 L2.6 9 Z" strokeWidth="1.4" />
        </svg>
      );
    default:
      return null;
  }
}

function Section({
  label,
  count,
  badge,
  defaultOpen = true,
  children,
}: {
  label: string;
  count?: string | number;
  badge?: string;
  defaultOpen?: boolean;
  children: JSX.Element;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`sec${open ? ' open' : ''}`}>
      <button
        type="button"
        className="sec-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="sec-label">{label}</span>
        {count != null ? <span className={`sec-count ${badge || ''}`}>{count}</span> : null}
        <span className="sec-chev" aria-hidden="true">
          ›
        </span>
      </button>
      <div className="sec-wrap">
        <div className="sec-inner">
          <div className="sec-body">{children}</div>
        </div>
      </div>
    </section>
  );
}

function Verdict({ tone, label }: { tone: Tone; label: string }): JSX.Element {
  return (
    <span className={`verdict ${tone}`} data-testid="dashboard-overall">
      <span className="vd" />
      <span className="vw">{label}</span>
    </span>
  );
}

function Gauge({
  score,
  mounted,
  height = 6,
}: { score: number; mounted: boolean; height?: number }): JSX.Element {
  const tone = spScoreTone(score);
  return (
    <div className={`gbar tone-${tone}`} style={{ height }}>
      <i style={{ width: `${mounted ? score : 0}%` }} />
      <em style={{ left: `${mounted ? score : 0}%` }} />
    </div>
  );
}

function ScoreCard({
  data,
  mounted,
  defaultOpen = true,
}: {
  data: Signal;
  mounted: boolean;
  defaultOpen?: boolean;
}): JSX.Element {
  const tone = spScoreTone(data.score);
  const v = useCountUp(data.score, mounted, 1200);
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`scorecard tone-${tone}`} data-testid="dashboard-signal" data-signal={data.id}>
      <div className="sc-head">
        <div className="sc-id">
          <span className="sc-tick" />
          <div>
            <div className="sc-title">{data.title}</div>
            <div className="sc-sub">{data.subtitle}</div>
          </div>
        </div>
        <div className="sc-score">
          <span className={`sc-num c-${tone}`} data-testid="dashboard-score">
            {Math.round(v)}
          </span>
          <span className="sc-den">/100</span>
        </div>
      </div>

      <Gauge score={data.score} mounted={mounted} />

      <div className="sc-meta">
        <span className={`sc-pill c-${tone}`}>
          <span className="dotk" />
          {data.label}
        </span>
        <button
          type="button"
          className={`sc-toggle${open ? ' open' : ''}`}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          data-testid="dashboard-toggle"
        >
          {data.attention.length} to act on{' '}
          <span className="chv" aria-hidden="true">
            ›
          </span>
        </button>
      </div>

      <div className={`sc-points${open ? ' open' : ''}`}>
        <div className="sc-points-inner">
          {data.solid?.map((t) => (
            <div className="pt good" key={t}>
              <Glyph kind="good" size={15} />
              <span>{t}</span>
            </div>
          ))}
          {data.attention.map((t) => (
            <div className="pt warn" key={t}>
              <Glyph kind="warn" size={15} />
              <span>{t}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- composed blocks ---------- */
function Chrome({ crumb }: { crumb: string }): JSX.Element {
  return (
    <div className="chrome">
      <span className="stoplight" />
      <span className="stoplight" />
      <span className="stoplight" />
      <span className="crumb">{crumb}</span>
    </div>
  );
}

function StreamRow({
  s,
  pick,
}: {
  s: Stream;
  pick?: { checked: boolean; onToggle: () => void };
}): JSX.Element {
  const v = SP_VERDICTS[s.verdict];
  const tone = v.tone;
  const m = useMounted(160);
  return (
    <div className={`srow ${s.active ? 'active ' : ''}t-${tone}${pick?.checked ? ' picked' : ''}`}>
      {pick ? (
        <input
          type="checkbox"
          className="s-check"
          checked={pick.checked}
          onChange={pick.onToggle}
          data-testid="item-check"
          aria-label={`Select: ${s.name}`}
        />
      ) : null}
      <span className="s-glyph">
        <Glyph kind={v.glyph} />
      </span>
      <div className="s-main">
        <div className="s-top">
          <span className="s-name">{s.name}</span>
          {s.active ? (
            <span className="you-here" data-testid="dashboard-here">
              You are here
            </span>
          ) : null}
          <span className={`s-pct c-${tone}`}>
            {s.progress}
            <i>%</i>
          </span>
        </div>
        <div className="s-line">{s.line}</div>
        <div className={`s-bar tone-${tone}`}>
          <i style={{ width: `${m ? s.progress : 0}%` }} />
        </div>
      </div>
    </div>
  );
}

function CaughtUp({ data }: { data: StatusData['caughtUp'] }): JSX.Element {
  return (
    <div data-testid="dashboard-caughtup">
      <div className="caughtup-head">
        <span className="stamp">Signed off · {data.date}</span>
        <span className="ctx">{data.context}</span>
      </div>
      {data.items.map((t) => (
        <div className="bullet" key={t}>
          <span className="tick" />
          <span style={{ flex: 1 }}>{t}</span>
        </div>
      ))}
    </div>
  );
}

function WatchingList({ items }: { items: string[] }): JSX.Element {
  return (
    <div data-testid="dashboard-watch">
      {items.map((t) => (
        <div className="row" key={t}>
          <span className="rt">
            <Glyph kind="warn" />
          </span>
          <span style={{ flex: 1 }}>{t}</span>
        </div>
      ))}
    </div>
  );
}

function StatusPanel({ data }: { data: StatusData }): JSX.Element {
  const mounted = useMounted(120);
  const v = SP_VERDICTS[data.verdict];
  const P = spRollup(data.streams);
  const barRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (mounted && barRef.current) barRef.current.style.width = `${P.pct}%`;
  }, [mounted, P.pct]);

  return (
    <div className="status-panel">
      <Chrome crumb={data.crumb || 'Project · Status'} />
      <div className="panel-scroll">
        <div className="hero-a">
          <ProgressRing value={P.pct} size={98} stroke={8} tone={v.tone} mounted={mounted} />
          <div className="meta">
            <div className="proj-name">
              {data.project} · {data.release}
            </div>
            <Verdict tone={v.tone} label={v.label} />
            <div className="now-line" data-testid="dashboard-headline">
              {data.now}
            </div>
          </div>
        </div>

        <div className="bar-row">
          <div className="bar">
            <i ref={barRef} />
          </div>
          <div className="lbl">
            <b>{P.shipped}</b> of {P.total} streams shipped
          </div>
        </div>

        <div className="sections">
          <Section label="Streams of work" count={`${P.shipped}/${P.total}`}>
            <div className="streams" data-testid="dashboard-streams">
              {data.streams.map((s) => (
                <StreamRow key={s.name} s={s} />
              ))}
            </div>
          </Section>

          <Section label="Health" defaultOpen={true}>
            <div className="scorestack">
              {data.signals.map((sig) => (
                <ScoreCard key={sig.id} data={sig} mounted={mounted} />
              ))}
            </div>
          </Section>

          <Section label="Since you last caught up">
            <CaughtUp data={data.caughtUp} />
          </Section>

          <Section label="Worth watching" count={data.watching.length} badge="amber">
            <WatchingList items={data.watching} />
          </Section>
        </div>
      </div>
    </div>
  );
}

/* ---------- focus board (the Status tab) ---------- */
const FOCUS_STATE: Record<
  Exclude<FocusKind, 'headless'>,
  { label: string; tone: Tone; pill: 'green' | 'amber' | 'muted' }
> = {
  active: { label: 'Active', tone: 'amber', pill: 'amber' },
  paused: { label: 'Paused', tone: 'muted', pill: 'muted' },
  hanging: { label: 'Shipped', tone: 'green', pill: 'green' },
};

/** The focus's **own** select toggle (the parent), independent of its children:
 * picking it selects the focus itself — the gesture that scopes Consolidate to
 * the whole focus — without touching the child checkboxes. */
function FocusParentToggle({
  f,
  selected,
  onToggle,
}: {
  f: FocusWidget;
  selected: Set<string>;
  onToggle: (key: string) => void;
}): JSX.Element {
  const key = focusKey(f);
  return (
    <input
      type="checkbox"
      className="fc-check"
      checked={selected.has(key)}
      onChange={() => onToggle(key)}
      onClick={(e) => e.stopPropagation()}
      data-testid="focus-parent"
      aria-label={`Select the ${f.name} focus`}
    />
  );
}

/** The header **select-all** for a focus's children — ticks every child box, or
 * clears them when all are ticked. Independent of the parent toggle: selecting
 * all children never selects the focus, and vice-versa. Absent for a focus with
 * no selectable lines (e.g. a hanging focus that is only a note). */
function SelectAllChildren({
  f,
  selected,
  onSelectAll,
}: {
  f: FocusWidget;
  selected: Set<string>;
  onSelectAll: (f: FocusWidget) => void;
}): JSX.Element | null {
  const keys = focusItemKeys(f);
  if (keys.length === 0) return null;
  const allPicked = keys.every((k) => selected.has(k));
  return (
    <button
      type="button"
      className="fc-selectall"
      onClick={(e) => {
        e.stopPropagation();
        onSelectAll(f);
      }}
      data-testid="focus-selectall"
    >
      {allPicked ? 'Clear' : 'Select all'}
    </button>
  );
}

/** A focus with a completion estimate + (optionally) its derived steps. The
 * active focus carries the "You are here" step; a hanging focus carries a note.
 * Each step is selectable so it can be batch-asked alongside loose-ends. The
 * header carries a {@link FocusSelectBox} to pick the whole focus at once. */
function FocusCard({
  f,
  mounted,
  selected,
  onToggle,
  onToggleFocus,
}: {
  f: FocusWidget;
  mounted: boolean;
  selected: Set<string>;
  onToggle: (key: string) => void;
  onToggleFocus: (f: FocusWidget) => void;
}): JSX.Element {
  const st = FOCUS_STATE[f.kind as Exclude<FocusKind, 'headless'>];
  return (
    <div className={`fcard tone-${st.tone}`} data-testid="focus-card" data-focus-state={f.kind}>
      <div className="fc-head">
        <FocusParentToggle f={f} selected={selected} onToggle={onToggle} />
        <ProgressRing
          value={f.estimate ?? 0}
          size={54}
          stroke={6}
          tone={st.tone}
          mounted={mounted}
        />
        <div className="fc-id">
          <div className="fc-top">
            <span className="fc-name">{f.name}</span>
            <span className={`fstate c-${st.pill}`}>
              <span className="dotk" />
              {st.label}
            </span>
          </div>
          <div className="fc-line">{f.line}</div>
        </div>
        <SelectAllChildren f={f} selected={selected} onSelectAll={onToggleFocus} />
      </div>
      {f.steps ? (
        <div className="fc-steps" data-testid="focus-steps">
          {f.steps.map((s) => {
            const key = `${f.id}:${s.name}`;
            return (
              <StreamRow
                key={s.name}
                s={s}
                pick={{ checked: selected.has(key), onToggle: () => onToggle(key) }}
              />
            );
          })}
        </div>
      ) : null}
      {f.note ? (
        <div className="fhang" data-testid="focus-hanging">
          <Glyph kind="warn" size={15} />
          <span>{f.note}</span>
        </div>
      ) : null}
    </div>
  );
}

/** An askable item — a focus step or a loose-end — flattened so any of them can
 * be selected and batch-asked together. `key` is unique across the whole board;
 * `focusId` groups items by their parent focus (scopes Consolidate). */
type Askable = { key: string; focusId: string; source: string; text: string; since?: string };

/** Flatten every selectable line on the board into one askable list (focus
 * steps + headless loose-ends), in render order. */
function collectAskables(board: FocusBoard): Askable[] {
  const out: Askable[] = [];
  for (const f of board.focuses) {
    for (const s of f.steps ?? [])
      out.push({ key: `${f.id}:${s.name}`, focusId: f.id, source: f.name, text: s.name });
    for (const a of f.attention ?? [])
      out.push({
        key: `loose:${a.text}`,
        focusId: f.id,
        source: a.source,
        text: a.text,
        since: a.since,
      });
  }
  return out;
}

/** The selection key for a focus *itself* (the parent toggle) — distinct from
 * its child item keys, so picking the focus and picking its children are
 * independent gestures. */
function focusKey(f: FocusWidget): string {
  return `focus:${f.id}`;
}

/** Every selectable key under one focus — its steps and/or its loose-ends. The
 * unit a focus-header checkbox selects/clears, and the membership test that
 * scopes Consolidate to a single focus. */
function focusItemKeys(f: FocusWidget): string[] {
  return [
    ...(f.steps ?? []).map((s) => `${f.id}:${s.name}`),
    ...(f.attention ?? []).map((a) => `loose:${a.text}`),
  ];
}

/** The staleness banner — sign-off currency. Its own concern (not a loose-end),
 * shown above the focus stack; click anywhere to read why. */
function StalenessCard({ s }: { s: Staleness }): JSX.Element {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(s.detail);
  const tone = s.state === 'behind' ? 'amber' : 'green';
  return (
    <div className={`stale-wrap${open ? ' open' : ''}`} data-testid="staleness">
      <div
        className={`stale tone-${tone}${expandable ? ' can-exp' : ''}`}
        onClick={() => expandable && setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (expandable && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? open : undefined}
      >
        <span className="stale-glyph">
          <Glyph kind={s.state === 'behind' ? 'warn' : 'good'} size={16} />
        </span>
        <div className="stale-main">
          <div className="stale-top">
            <span className="stale-label">Sign-off</span>
            <span className={`stale-state c-${tone}`}>{s.label}</span>
            <span className="since">since {s.since}</span>
          </div>
          <div className="stale-text">{s.text}</div>
        </div>
        {expandable ? (
          <span className="chv" aria-hidden="true">
            ›
          </span>
        ) : null}
      </div>
      {expandable ? (
        <div className="att-detail">
          <div className="att-detail-inner">
            <p>{s.detail}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** One loose-end row: a selection checkbox + the flagged item, expandable to its
 * deeper note — but only when it *has* one (`detail`). Click anywhere on the row
 * to expand; the checkbox stops propagation, so ticking it only selects. */
function LooseEndRow({
  a,
  selected,
  onToggle,
}: {
  a: AttentionItem;
  selected: Set<string>;
  onToggle: (key: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const key = `loose:${a.text}`;
  const expandable = Boolean(a.detail);
  return (
    <div className={`att-wrap${open ? ' open' : ''}`} data-testid="loose-row">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the checkbox is the keyboard path; row-click is a pointer convenience */}
      <div
        className={`att${selected.has(key) ? ' picked' : ''}${expandable ? ' can-exp' : ''}`}
        onClick={() => expandable && setOpen((o) => !o)}
        aria-expanded={expandable ? open : undefined}
      >
        <input
          type="checkbox"
          className="att-check"
          checked={selected.has(key)}
          onChange={() => onToggle(key)}
          onClick={(e) => e.stopPropagation()}
          data-testid="item-check"
          aria-label={`Select: ${a.text}`}
        />
        <span className="src">{a.source}</span>
        <span style={{ flex: 1 }}>{a.text}</span>
        {a.since ? <span className="since">buried {a.since}</span> : null}
        {expandable ? (
          <span className="chv" data-testid="loose-expand" aria-hidden="true">
            ›
          </span>
        ) : null}
      </div>
      {expandable ? (
        <div className="att-detail">
          <div className="att-detail-inner">
            <p>{a.detail}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The synthetic focus: things flagged across the project that no active focus
 * owns (the Backlog + an annotation sweep). No ring — a count of loose-ends.
 * Every row is selectable so it can be batch-asked from the top toolbar; rows
 * that carry a deeper note expand to show it. */
function HeadlessCard({
  f,
  selected,
  onToggle,
  onToggleFocus,
}: {
  f: FocusWidget;
  selected: Set<string>;
  onToggle: (key: string) => void;
  onToggleFocus: (f: FocusWidget) => void;
}): JSX.Element {
  const items = f.attention ?? [];
  return (
    <div className="fcard tone-info" data-testid="focus-card" data-focus-state="headless">
      <div className="fc-head">
        <FocusParentToggle f={f} selected={selected} onToggle={onToggle} />
        <span className="fc-badge">
          <Glyph kind="note" size={30} />
        </span>
        <div className="fc-id">
          <div className="fc-top">
            <span className="fc-name">{f.name}</span>
            <span className="fcount" data-testid="headless-count">
              {items.length} loose ends
            </span>
          </div>
          <div className="fc-line">{f.line}</div>
        </div>
        <SelectAllChildren f={f} selected={selected} onSelectAll={onToggleFocus} />
      </div>
      <div className="fc-steps" data-testid="headless-list">
        {items.map((a) => (
          <LooseEndRow key={a.text} a={a} selected={selected} onToggle={onToggle} />
        ))}
      </div>
    </div>
  );
}

/** Where a drill-down answer loads: a drawer docked at the bottom of the
 * Assistant pane (the left pane is the read-only *output* surface). Static for
 * now — the body is where the assistant's deeper read will render once wired. */
function DetailDrawer({
  items,
  onClose,
}: {
  items: Askable[];
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="detail" data-testid="detail-drawer">
      <div className="detail-head">
        <span className="detail-title">
          {items.length === 1 ? 'More on this' : `More on ${items.length} items`}
        </span>
        <button type="button" className="detail-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="detail-body">
        {items.map((it) => (
          <div className="detail-item" key={it.key}>
            <div className="detail-q">
              <span className="src">{it.source}</span>
              <span>{it.text}</span>
            </div>
            <div className="detail-a">The assistant’s deeper read on this loads here.</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A pending consolidate suggestion: the assistant's merged shape for the rows
 * the user picked, awaiting accept/reject. */
type Proposal = { title: string; text: string; keys: string[] };

/** The Status tab: a slim roll-up line + a stack of focus widgets. Every line is
 * selectable; the top toolbar turns a selection into the three actions —
 * **Humanize** (reword in place), **Consolidate** (merge the picked rows), and
 * **Ask** (load a deeper read). Humanize/Consolidate fire real turns (handled by
 * the parent); Ask opens the docked drawer. */
function FocusPanel({
  board,
  opBusy,
  onHumanize,
  onConsolidate,
  proposal,
  onAcceptProposal,
  onRejectProposal,
}: {
  board: FocusBoard;
  opBusy: boolean;
  onHumanize: (items: Askable[]) => void;
  onConsolidate: (items: Askable[]) => void;
  proposal: Proposal | null;
  onAcceptProposal: () => void;
  onRejectProposal: () => void;
}): JSX.Element {
  const mounted = useMounted(120);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [asked, setAsked] = useState<Askable[] | null>(null);
  const r = board.rollup;

  const askables = collectAskables(board);
  const picked = askables.filter((a) => selected.has(a.key)); // selected children
  const selectedParents = board.focuses.filter((f) => selected.has(focusKey(f)));
  // Consolidate is scoped to ONE focus. It offers when the focus *itself* is
  // picked (its parent toggle → merge the whole focus) or 2+ of its children are
  // (→ merge just those). A selection that spans two focuses is ambiguous, so it
  // doesn't offer (CR10 / the HL's parent-vs-children split, 2026-06-03).
  const involvedFocuses = board.focuses.filter(
    (f) => selected.has(focusKey(f)) || focusItemKeys(f).some((k) => selected.has(k)),
  );
  const consolidateFocus = involvedFocuses.length === 1 ? (involvedFocuses[0] ?? null) : null;
  const consolidateItems =
    consolidateFocus && selected.has(focusKey(consolidateFocus))
      ? askables.filter((a) => a.focusId === consolidateFocus.id) // whole focus
      : consolidateFocus
        ? picked.filter((a) => a.focusId === consolidateFocus.id)
        : []; // just the picked children
  const canConsolidate = consolidateItems.length >= 2;
  const countLabel =
    picked.length > 0
      ? `${picked.length} selected`
      : selectedParents.length === 1
        ? `${selectedParents[0]?.name} focus`
        : `${selectedParents.length} focuses`;
  const clear = (): void => setSelected(new Set());
  const toggle = (key: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // The header "select all": tick every *child* box under a focus (never the
  // focus's own toggle), or clear them when all are already ticked.
  const toggleFocus = (f: FocusWidget): void =>
    setSelected((prev) => {
      const keys = focusItemKeys(f);
      const next = new Set(prev);
      const allPicked = keys.length > 0 && keys.every((k) => next.has(k));
      for (const k of keys) {
        if (allPicked) next.delete(k);
        else next.add(k);
      }
      return next;
    });

  return (
    <div className="status-panel">
      <Chrome crumb={board.crumb || 'Project · Status'} />
      <div className="asktoolbar" data-testid="ask-toolbar">
        {selected.size > 0 ? (
          <>
            <span className="selbar-count">{countLabel}</span>
            {picked.length > 0 ? (
              <button
                type="button"
                className="op-btn"
                disabled={opBusy}
                onClick={() => {
                  onHumanize(picked);
                  clear();
                }}
                data-testid="op-humanize"
                title="Reword the selected items in plain language"
              >
                ✦ Humanize
              </button>
            ) : null}
            {canConsolidate ? (
              <button
                type="button"
                className="op-btn"
                disabled={opBusy}
                onClick={() => {
                  onConsolidate(consolidateItems);
                  clear();
                }}
                data-testid="op-consolidate"
                title={`Merge the selected items in ${consolidateFocus?.name} into one`}
              >
                ⊞ Consolidate
              </button>
            ) : null}
            {picked.length > 0 ? (
              <button
                type="button"
                className="ask-batch"
                onClick={() => setAsked(picked)}
                data-testid="ask-batch"
              >
                Ask ›
              </button>
            ) : null}
            <button type="button" className="selbar-clear" onClick={clear} data-testid="ask-clear">
              Clear
            </button>
          </>
        ) : (
          <span className="ask-hint">
            {opBusy ? 'Working…' : 'Tick items, then Humanize, Consolidate, or Ask.'}
          </span>
        )}
      </div>
      <div className="panel-scroll">
        <div className="frollup" data-testid="focus-rollup">
          <span>
            <b>{r.inPlay}</b> focuses in play
          </span>
          <span className="dot">·</span>
          <span>
            <b className="c-amber">{r.active}</b> active
          </span>
          <span className="dot">·</span>
          <span>
            <b className="c-green">{r.hanging}</b> hanging
          </span>
          <span className="dot">·</span>
          <span>
            <b className="c-amber">{r.looseEnds}</b> loose ends
          </span>
        </div>
        {board.staleness ? <StalenessCard s={board.staleness} /> : null}
        <div className="fstack" data-testid="focus-board">
          {board.focuses.map((f) =>
            f.kind === 'headless' ? (
              <HeadlessCard
                key={f.id}
                f={f}
                selected={selected}
                onToggle={toggle}
                onToggleFocus={toggleFocus}
              />
            ) : (
              <FocusCard
                key={f.id}
                f={f}
                mounted={mounted}
                selected={selected}
                onToggle={toggle}
                onToggleFocus={toggleFocus}
              />
            ),
          )}
        </div>
      </div>
      {proposal ? (
        <div className="proposal" data-testid="consolidate-proposal">
          <div className="proposal-head">Combine {proposal.keys.length} items into one?</div>
          <div className="proposal-title">{proposal.title}</div>
          <div className="proposal-text">{proposal.text}</div>
          <div className="proposal-actions">
            <button type="button" className="op-btn primary" onClick={onAcceptProposal}>
              Combine
            </button>
            <button type="button" className="selbar-clear" onClick={onRejectProposal}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {asked ? <DetailDrawer items={asked} onClose={() => setAsked(null)} /> : null}
    </div>
  );
}

/* Design-spike sample data for this project, grounded in the real lore.
 * Replaced by AI hydration later — the shape stays identical. One data set per
 * Assistant tab (CR9 Phase 5 spike): Status = the whole project; Payload = the
 * codebase; Memory = the lore. The StatusPanel layout is the same for all three;
 * only the content (and the two health-card slots) differ. */
const STATUS_FOCUSES: FocusBoard = {
  project: 'AI-Lore Companion',
  crumb: 'Project · Status',
  rollup: { inPlay: 3, active: 1, hanging: 1, looseEnds: 8 },
  staleness: {
    state: 'behind',
    label: 'Behind',
    since: 'June 1',
    text: 'Nothing has been formally signed off since June 1.',
    detail:
      'A lot has landed since you last drew a line and called the work reviewed and done — an entire session of finished features that are saved but never formally signed off. This is the project’s own “are we caught up?” marker, and right now it’s behind.',
  },
  focuses: [
    {
      id: 'ai-helper',
      name: 'AI Helper',
      kind: 'active',
      line: 'The v1.0 arc — a read-only assistant that reads your project and answers.',
      estimate: 62,
      steps: [
        {
          name: 'Core assistant',
          line: 'Reads your project and answers — on Claude or Gemini.',
          verdict: 'on-track',
          progress: 100,
        },
        {
          name: 'Safety & trust',
          line: 'Strictly read-only. Never edits your work.',
          verdict: 'on-track',
          progress: 100,
        },
        {
          name: 'In-app home',
          line: 'A tidy home in the side rail, driven by clicking.',
          verdict: 'on-track',
          progress: 100,
        },
        {
          name: 'Status dashboard',
          line: 'This at-a-glance view of where things stand.',
          verdict: 'in-progress',
          progress: 60,
          active: true,
        },
        {
          name: 'Multi-track support',
          line: 'Work with the newer multi-track projects.',
          verdict: 'at-risk',
          progress: 15,
        },
        {
          name: 'Per-assistant models',
          line: 'Choose which model each assistant uses.',
          verdict: 'not-started',
          progress: 0,
        },
      ],
    },
    {
      id: 'companion-v0.9.4',
      name: 'Companion v0.9.4',
      kind: 'hanging',
      line: 'The last UX-polish release — both Mac builds shipped.',
      estimate: 100,
      note: 'Shipped June 1 — finished, but still not tidied into the archive (owed for four sessions now).',
    },
    {
      id: 'headless',
      name: 'No focus owns these',
      kind: 'headless',
      line: 'Flagged across the project, but no active focus is driving them. Found by a deep crawl of the lore.',
      attention: [
        {
          source: 'Bug',
          since: 'June 1',
          text: 'Resizing the Changes panel is forgotten when you quit and reopen the app.',
          detail:
            'A small day-to-day annoyance: when you set that panel to the height you like, the app forgets it after a restart — even though the rest of your layout comes back just fine.',
        },
        {
          source: 'Bug',
          since: 'June 1',
          text: 'A terminal with an adaptive prompt stacks duplicate lines when you drag-resize the window.',
          detail:
            'A cosmetic glitch: dragging the window to resize can leave a terminal’s prompt repeated and stacked on top of itself. It looks untidy, but nothing is actually broken.',
        },
        {
          source: 'Backlog',
          since: 'May 30',
          text: 'Content search still needs ripgrep installed on your PATH.',
          detail:
            'Project-wide search leans on a small search tool that isn’t yet bundled inside the app. It works on your machine because that tool happens to be installed — but on a clean install, search would quietly come up empty.',
        },
        {
          source: 'Drift',
          since: 'June 2',
          text: 'Dead assistant code is left over since the dashboard replaced the text feed — owes a prune.',
          detail:
            'When this dashboard replaced the old plain-text answer panel, the parts that powered the old way were left behind, unused. Nothing’s broken — it’s just clutter worth clearing once the dashboard design settles.',
        },
        {
          source: 'Idea',
          since: 'June 2',
          text: 'Remember the shortcuts a terminal ran, and offer them as click-to-reopen on restore.',
          detail:
            'Something you wanted: when a terminal reopens after a restart, show the handy shortcuts you’d been running in it — as buttons you can click to carry on right where you left off.',
        },
        {
          source: 'Idea',
          since: 'June 1',
          text: 'Richer browser history and an address bar with autocomplete.',
          detail:
            'Something you wanted: give the built-in browser a real memory — keep your history between sessions and let the address bar suggest places as you type, the way an ordinary browser does.',
        },
        {
          source: 'Idea',
          since: 'May 29',
          text: 'The “lean & fast boot” slimming work was scoped but never opened.',
          detail:
            'A bigger piece never started: trimming the app so it launches faster and ships smaller. It was parked as low-value for a local tool, but it’s still sitting there, unscoped.',
        },
        {
          source: 'Idea',
          since: 'May 31',
          text: 'The next big goal — multi-track awareness — is scoped but unopened, with open questions.',
          detail:
            'The likely next big goal: supporting the newer projects that run several streams of work at once. It’s been sketched but never properly opened, and a few decisions are still waiting on you.',
        },
      ],
    },
  ],
};

const PAYLOAD_SAMPLE: StatusData = {
  project: 'AI-Lore Companion',
  release: 'the code',
  crumb: 'Project · Payload',
  now: 'The Cockpit app — Electron + React + a TypeScript core',
  verdict: 'on-track',
  streams: [
    {
      name: 'Assistant engine',
      line: 'The read-only helper seam — Claude (PTY) and Gemini (headless).',
      verdict: 'on-track',
      progress: 100,
    },
    {
      name: 'Tabs & panes',
      line: 'The tab registry, the three-pane layout, the activity rail.',
      verdict: 'on-track',
      progress: 100,
    },
    {
      name: 'Changes & search',
      line: 'Baseline-aware diff view and content search.',
      verdict: 'on-track',
      progress: 100,
    },
    {
      name: 'The dashboard',
      line: 'This status surface — still on sample data.',
      verdict: 'in-progress',
      progress: 60,
      active: true,
    },
    {
      name: 'Lean boot & bundle',
      line: 'Trim the ~5.7 MB bundle and speed up startup.',
      verdict: 'at-risk',
      progress: 15,
    },
  ],
  caughtUp: {
    date: 'June 1',
    context: 'the last formal sign-off, before the whole assistant landed',
    items: [
      'Engine-adapter seam added — a second engine was config, not a rewrite',
      'Two-pane assistant + the activity rail',
      'Gemini read-path fixed (anchored in the lore repo)',
      'Skills catalog collapsed behind a toggle',
    ],
  },
  watching: [
    'A few assistant actions are built but not yet wired to a UI',
    'The bundle is a single ~5.7 MB chunk — no code-splitting yet',
  ],
  signals: [
    {
      id: 'coverage',
      title: 'Test coverage',
      subtitle: 'Headless + component suites',
      score: 80,
      label: 'Solid',
      solid: [
        '128 headless + 58 component — one suite per surface',
        'Suites stay green on every change',
      ],
      attention: [
        'No end-to-end test of the dashboard yet',
        'A few tests cover the dormant AI path',
      ],
    },
    {
      id: 'quality',
      title: 'Code quality',
      subtitle: 'Architecture & maintainability',
      score: 84,
      label: 'Holding up',
      solid: [
        'Clean single-entry seams — engine, IPC contract, tab registry',
        'Absorbed Gemini, the rail, and the dashboard without rewrites',
      ],
      attention: ['The assistant surface churned three times — some debris to prune'],
    },
    {
      id: 'lint',
      title: 'Lint & types',
      subtitle: 'Biome + TypeScript',
      score: 72,
      label: 'Mostly clean',
      solid: ['Typecheck passes; changed files are Biome-clean'],
      attention: ['~25 pre-existing Biome findings repo-wide (older-component a11y)'],
    },
  ],
};

const MEMORY_SAMPLE: StatusData = {
  project: 'AI-Lore Companion',
  release: 'the lore',
  crumb: 'Project · Memory',
  now: 'The project’s memory — focus, blueprint, journal, save-points',
  verdict: 'at-risk',
  streams: [
    {
      name: 'Active focus — AI Helper',
      line: 'The v1.0 arc; the dashboard work sits here.',
      verdict: 'in-progress',
      progress: 70,
      active: true,
    },
    {
      name: 'Blueprint & contracts',
      line: 'The read-only guarantee and the runtime↔session protocol.',
      verdict: 'on-track',
      progress: 100,
    },
    {
      name: 'Journal trail',
      line: 'Session records and handovers — current.',
      verdict: 'on-track',
      progress: 100,
    },
    {
      name: 'Save-point ledger',
      line: 'Formal milestones — none since June 1.',
      verdict: 'at-risk',
      progress: 20,
    },
    {
      name: 'Archive backlog',
      line: 'Old finished focuses awaiting an archive pass.',
      verdict: 'not-started',
      progress: 0,
    },
  ],
  caughtUp: {
    date: 'June 1',
    context: 'the last save-point — everything since is only lightly ack’d',
    items: [
      'Several change-requests scoped, built, and ack’d',
      'The runtime↔session protocol written down',
      'The read-only contract made engine-agnostic',
    ],
  },
  watching: [
    'No formal sign-off since June 1 — a lot of unreviewed ground',
    'A few notes still describe superseded designs',
  ],
  signals: [
    {
      id: 'signoff',
      title: 'Sign-off currency',
      subtitle: 'How current the formal review is',
      score: 42,
      label: 'Behind',
      attention: [
        'The last save-point predates the entire assistant build',
        'Acks have kept drift low, but nothing is milestone-signed',
      ],
    },
    {
      id: 'consistency',
      title: 'Consistency',
      subtitle: 'Do the notes still match the work',
      score: 68,
      label: 'Mostly aligned',
      solid: ['Status, focus, and indexes are kept in sync each pass'],
      attention: [
        'Some v1.0 notes describe the retired text-feed idea',
        'The previous release’s goal is still marked not-yet-archived',
      ],
    },
    {
      id: 'tidiness',
      title: 'Tidiness',
      subtitle: 'Archive & structure',
      score: 60,
      label: 'Some clutter',
      attention: ['Old finished focuses are waiting on an archive pass'],
    },
  ],
};

const TABS = [
  { id: 'status', label: 'Status', kind: 'focus', board: STATUS_FOCUSES },
  { id: 'payload', label: 'Payload', kind: 'panel', data: PAYLOAD_SAMPLE },
  { id: 'memory', label: 'Memory', kind: 'panel', data: MEMORY_SAMPLE },
] as const;

/** Pull a {@link FocusBoard} out of a helper answer — the `dashboard` turn
 * returns the board as JSON (Claude may fence it, Gemini wraps it). Tolerant:
 * extract the outermost object, require a `focuses` array. Returns null for any
 * non-board answer (e.g. an orient confirmation) so those are simply ignored. */
function parseLiveBoard(answer: string): FocusBoard | null {
  const match = answer.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const d = JSON.parse(match[0]) as Partial<FocusBoard>;
    if (!Array.isArray(d.focuses) || d.focuses.length === 0) return null;
    if (!d.rollup || typeof d.rollup !== 'object') return null;
    return d as FocusBoard;
  } catch {
    return null;
  }
}

/** Validate a structured `report_dashboard` payload (CR10) into a {@link FocusBoard}.
 * The board now arrives as a typed MCP tool argument — not scraped out of free
 * text — so this is a light shape-guard (a focuses array + a rollup), not a
 * parse of the model's stdout. The brittle string extraction is gone. */
function validateBoard(payload: unknown): FocusBoard | null {
  if (!payload || typeof payload !== 'object') return null;
  const d = payload as Partial<FocusBoard>;
  if (!Array.isArray(d.focuses) || d.focuses.length === 0) return null;
  if (!d.rollup || typeof d.rollup !== 'object') return null;
  return d as FocusBoard;
}

/* ---------- the curation micro-turns (cheap, content-only) ----------
 * The prompts now live in main ({@link hooks.ts} `humanizePrompt` /
 * `consolidatePrompt`) so the same builder picks the delivery — call the MCP
 * report tool (Claude, CR10) or print JSON (Gemini). The renderer fires the op
 * over `helperHumanize` / `helperConsolidate` and consumes the result either as
 * a structured report (`onHelperReport`) or, for a print-JSON engine, by parsing
 * the `answered` text below. */

/** Validate a structured `report_consolidation` payload (CR10) into a merge —
 *  the typed-MCP successor to {@link parseMerged}'s text scrape. */
function validateMerged(payload: unknown): { title: string; text: string } | null {
  if (!payload || typeof payload !== 'object') return null;
  const d = payload as { title?: unknown; text?: unknown };
  if (typeof d.title === 'string' && typeof d.text === 'string')
    return { title: d.title, text: d.text };
  return null;
}

function parseStringArray(answer: string): string[] | null {
  const m = answer.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    const arr: unknown = JSON.parse(m[0]);
    if (Array.isArray(arr) && arr.every((x) => typeof x === 'string')) return arr as string[];
  } catch {
    /* not an array */
  }
  return null;
}

function parseMerged(answer: string): { title: string; text: string } | null {
  const m = answer.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[0]) as { title?: unknown; text?: unknown };
    if (typeof d.title === 'string' && typeof d.text === 'string') {
      return { title: d.title, text: d.text };
    }
  } catch {
    /* not an object */
  }
  return null;
}

/** Apply reworded text to the board in place (by key — a step name or a
 *  loose-end's text). Returns a new board. */
function applyHumanize(board: FocusBoard, rewrites: Map<string, string>): FocusBoard {
  return {
    ...board,
    focuses: board.focuses.map((f) => ({
      ...f,
      steps: f.steps?.map((s) => {
        const v = rewrites.get(`${f.id}:${s.name}`);
        return v ? { ...s, name: v } : s;
      }),
      attention: f.attention?.map((a) => {
        const v = rewrites.get(`loose:${a.text}`);
        return v ? { ...a, text: v } : a;
      }),
    })),
  };
}

/** Replace the picked items in their focus with one merged item — loose-ends in
 *  the headless focus, or steps in any other focus (CR10; the HL's "any focus's
 *  items", 2026-06-03). The picks always resolve to a single focus (Consolidate
 *  only offers then), so the merge stays scoped to that focus. Returns a new
 *  board; the merged item lands where the first picked item was. */
function applyConsolidate(
  board: FocusBoard,
  keys: Set<string>,
  merged: { title: string; text: string },
): FocusBoard {
  const target = board.focuses.find((f) => focusItemKeys(f).some((k) => keys.has(k)));
  if (!target) return board;

  // Loose-ends (the headless focus): collapse to one loose-end, the sentence as
  // its expandable detail. Drops the merged count off the loose-ends rollup.
  if (target.kind === 'headless') {
    const first = (target.attention ?? []).find((a) => keys.has(`loose:${a.text}`));
    const newItem: AttentionItem = {
      source: first?.source ?? 'Backlog',
      text: merged.title,
      detail: merged.text,
      since: first?.since,
    };
    return {
      ...board,
      focuses: board.focuses.map((f) =>
        f.id === target.id && f.attention
          ? {
              ...f,
              attention: [newItem, ...f.attention.filter((a) => !keys.has(`loose:${a.text}`))],
            }
          : f,
      ),
      rollup: { ...board.rollup, looseEnds: Math.max(0, board.rollup.looseEnds - keys.size + 1) },
    };
  }

  // Steps (an active/paused focus): collapse the picked steps to one, carrying
  // forward "active" and the average progress so the ring stays honest.
  const steps = target.steps ?? [];
  const isPicked = (s: Stream): boolean => keys.has(`${target.id}:${s.name}`);
  const pickedSteps = steps.filter(isPicked);
  if (pickedSteps.length === 0) return board;
  const mergedStep: Stream = {
    name: merged.title,
    line: merged.text,
    verdict: 'in-progress',
    progress: Math.round(pickedSteps.reduce((a, s) => a + s.progress, 0) / pickedSteps.length),
    active: pickedSteps.some((s) => s.active),
  };
  const firstIdx = steps.findIndex(isPicked);
  const newSteps = steps.flatMap((s, i) =>
    i === firstIdx ? [mergedStep] : isPicked(s) ? [] : [s],
  );
  return {
    ...board,
    focuses: board.focuses.map((f) => (f.id === target.id ? { ...f, steps: newSteps } : f)),
  };
}

export function AssistantDashboard(): JSX.Element {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('status');
  const [phase, setPhase] = useState<HelperPhase | null>(null);
  const [ptyId, setPtyId] = useState<string | null>(null);
  const [board, setBoard] = useState<FocusBoard>(STATUS_FOCUSES);
  const [isLive, setIsLive] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [opActive, setOpActive] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [error, setError] = useState('');
  // waiting for connect→orient to finish before firing the crawl:
  const pendingRef = useRef(false);
  // which turn we're awaiting an answer for:
  const opRef = useRef<{ kind: 'crawl' | 'humanize' | 'consolidate'; keys?: string[] } | null>(
    null,
  );

  // Ride the same Channel-C stream as the host: dispatch each answer by the turn
  // we fired. (Guarded so component tests — no window.cockpit — show the sample.)
  useEffect(() => {
    if (!window.cockpit?.onHelperEvent) return;
    return window.cockpit.onHelperEvent((e) => {
      setPhase(e.phase);
      if (e.ptyId) setPtyId(e.ptyId);
      // Mirror every event into the in-app console (both engines, uniformly) so
      // the HL can see what's happening and copy a raw answer or error.
      if (e.phase === 'answered') {
        pushActivity('answer', `answer received (${(e.answer ?? '').length} chars)`, e.answer);
      } else if (e.phase === 'error') {
        pushActivity('error', e.error ?? 'The assistant returned an error.', e.error);
      } else {
        pushActivity('status', e.phase);
      }
      // The dashboard owns the first turn: the host fires no orient (it would race
      // ours), so once the session is ready we fire the crawl ourselves.
      if (e.phase === 'ready' && pendingRef.current) {
        pendingRef.current = false;
        opRef.current = { kind: 'crawl' };
        setRefreshing(true);
        pushActivity('turn', 'Reading the project (dashboard crawl)…');
        void window.cockpit.helperAsk('dashboard');
        return;
      }
      if (e.phase === 'answered') {
        const op = opRef.current;
        const ans = e.answer ?? '';
        if (op?.kind === 'humanize') {
          opRef.current = null;
          setOpActive(false);
          const arr = parseStringArray(ans);
          const keys = op.keys ?? [];
          if (arr) {
            const rw = new Map<string, string>();
            keys.forEach((k, i) => arr[i] && rw.set(k, arr[i]));
            setBoard((b) => applyHumanize(b, rw));
          } else if (keys.length === 1 && ans.trim()) {
            setBoard((b) => applyHumanize(b, new Map([[keys[0], ans.trim()]])));
          } else {
            setError('Could not read the reworded text.');
          }
          return;
        }
        if (op?.kind === 'consolidate') {
          opRef.current = null;
          setOpActive(false);
          const merged = parseMerged(ans);
          if (merged && op.keys) setProposal({ ...merged, keys: op.keys });
          else setError('Could not read the merge suggestion.');
          return;
        }
        if (op?.kind === 'crawl') {
          opRef.current = null;
          setRefreshing(false);
          const b = parseLiveBoard(ans);
          if (b) {
            setBoard(b);
            setIsLive(true);
            setError('');
          } else {
            setError('The assistant replied, but the dashboard data could not be read.');
          }
          return;
        }
        // op null → a stray/host answer we didn't initiate; ignore it.
      } else if (e.phase === 'error') {
        if (opRef.current || pendingRef.current) {
          opRef.current = null;
          pendingRef.current = false;
          setRefreshing(false);
          setOpActive(false);
          setError(e.error ?? 'The assistant could not finish.');
        }
      }
    });
  }, []);

  // CR10 — the structured egress. The dashboard board AND the curation results
  // (Humanize / Consolidate) now arrive as typed MCP tool calls on their own
  // channel, not scraped from the `answer` text. On a structured engine (Claude)
  // we clear the in-flight op when its report lands so the turn's trailing
  // `answered` confirmation is ignored rather than mis-parsed. (Engines still on
  // the print-JSON path keep hydrating through the `answered` handler above.)
  useEffect(() => {
    if (!window.cockpit?.onHelperReport) return;
    return window.cockpit.onHelperReport((r) => {
      if (r.tool === 'report_dashboard') {
        const b = validateBoard(r.payload);
        pushActivity(
          'answer',
          `dashboard reported via MCP (${b ? `${b.focuses.length} focuses` : 'invalid shape'})`,
        );
        if (!b) {
          setError('The assistant reported a dashboard, but its shape could not be read.');
          return;
        }
        if (opRef.current?.kind === 'crawl') opRef.current = null;
        setBoard(b);
        setIsLive(true);
        setRefreshing(false);
        setError('');
        return;
      }
      if (r.tool === 'report_humanized') {
        const arr =
          Array.isArray(r.payload) && r.payload.every((x) => typeof x === 'string')
            ? (r.payload as string[])
            : null;
        const keys = opRef.current?.kind === 'humanize' ? (opRef.current.keys ?? []) : [];
        pushActivity(
          'answer',
          `humanize reported via MCP (${arr ? `${arr.length} rewrites` : 'invalid shape'})`,
        );
        opRef.current = null;
        setOpActive(false);
        if (arr && keys.length) {
          const rw = new Map<string, string>();
          keys.forEach((k, i) => arr[i] && rw.set(k, arr[i]));
          setBoard((b) => applyHumanize(b, rw));
          setError('');
        } else {
          setError('The assistant reported rewrites, but their shape could not be read.');
        }
        return;
      }
      if (r.tool === 'report_consolidation') {
        const m = validateMerged(r.payload);
        const keys = opRef.current?.kind === 'consolidate' ? opRef.current.keys : undefined;
        pushActivity('answer', `consolidation reported via MCP (${m ? 'ok' : 'invalid shape'})`);
        opRef.current = null;
        setOpActive(false);
        if (m && keys) {
          setProposal({ ...m, keys });
          setError('');
        } else {
          setError('The assistant reported a merge, but its shape could not be read.');
        }
        return;
      }
    });
  }, []);

  const connected = isConnected(phase, ptyId);
  const busy = isBusy(phase) || refreshing || opActive;

  const refresh = (): void => {
    if (busy || !window.cockpit?.helperAsk) return;
    setError('');
    if (connected) {
      opRef.current = { kind: 'crawl' };
      setRefreshing(true);
      pushActivity('turn', 'Reading the project (dashboard crawl)…');
      void window.cockpit.helperAsk('dashboard');
    } else {
      // not connected — start the session; the crawl fires once it's ready
      pendingRef.current = true;
      setRefreshing(true);
      pushActivity('turn', 'Connecting the assistant…');
      void window.cockpit.helperConnect();
    }
  };

  const onHumanize = (items: Askable[]): void => {
    if (busy || items.length === 0) return;
    if (!connected || !window.cockpit?.helperHumanize) {
      setError('Connect the assistant first — hit Refresh.');
      pushActivity('error', 'Humanize skipped — connect the assistant first (hit Refresh).');
      return;
    }
    setError('');
    opRef.current = { kind: 'humanize', keys: items.map((i) => i.key) };
    setOpActive(true);
    pushActivity('turn', `Humanize ${items.length} item${items.length === 1 ? '' : 's'}`);
    void window.cockpit.helperHumanize(items.map((i) => i.text));
  };

  const onConsolidate = (items: Askable[]): void => {
    if (busy || items.length < 2) return;
    if (!connected || !window.cockpit?.helperConsolidate) {
      setError('Connect the assistant first — hit Refresh.');
      pushActivity('error', 'Consolidate skipped — connect the assistant first (hit Refresh).');
      return;
    }
    setError('');
    opRef.current = { kind: 'consolidate', keys: items.map((i) => i.key) };
    setOpActive(true);
    pushActivity('turn', `Consolidate ${items.length} items`);
    void window.cockpit.helperConsolidate(items.map((i) => i.text));
  };

  const acceptProposal = (): void => {
    if (!proposal) return;
    setBoard((b) =>
      applyConsolidate(b, new Set(proposal.keys), { title: proposal.title, text: proposal.text }),
    );
    setProposal(null);
  };

  const active = TABS.find((t) => t.id === tab) ?? TABS[0];
  const source = refreshing
    ? 'Reading your project…'
    : opActive
      ? 'Working…'
      : error
        ? '⚠ couldn’t finish'
        : isLive
          ? 'Live from your project'
          : 'Sample data';

  return (
    <div style={paneWrapStyle} data-testid="pane-assistant" data-pane="assistant">
      <div style={tabStripStyle} data-testid="assistant-tabs">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.id}
            style={t.id === tab ? tabActiveStyle : tabStyle}
            onClick={() => setTab(t.id)}
            data-testid={`assistant-tab-${t.id}`}
            aria-pressed={t.id === tab}
          >
            {t.label}
          </button>
        ))}
        <div style={refreshWrapStyle}>
          <span
            style={error ? refreshErrStyle : refreshStatusStyle}
            title={error || undefined}
            data-testid="dashboard-source"
          >
            {source}
          </span>
          <button
            type="button"
            style={{ ...refreshBtnStyle, ...(busy ? refreshBtnBusyStyle : null) }}
            onClick={refresh}
            disabled={busy}
            data-testid="dashboard-refresh"
            title={connected ? 'Re-read the project' : 'Connect the assistant and read the project'}
          >
            {refreshing ? '…' : '⟳'} Refresh
          </button>
        </div>
      </div>
      <div style={scrollWrapStyle}>
        {/* re-mount per tab (and on a live swap) so the animations replay. Status
            is the focus-board — live from the crawl when available, else sample. */}
        {active.kind === 'focus' ? (
          <FocusPanel
            key={isLive ? 'status-live' : 'status'}
            board={board}
            opBusy={busy}
            onHumanize={onHumanize}
            onConsolidate={onConsolidate}
            proposal={proposal}
            onAcceptProposal={acceptProposal}
            onRejectProposal={() => setProposal(null)}
          />
        ) : (
          <StatusPanel key={active.id} data={active.data} />
        )}
      </div>
    </div>
  );
}

const paneWrapStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--color-shell)',
};

const tabStripStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: '6px 8px 0',
  borderBottom: '1px solid var(--color-border-faint)',
  flexShrink: 0,
};

const refreshWrapStyle: React.CSSProperties = {
  marginLeft: 'auto',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  paddingBottom: 4,
};

const refreshStatusStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  fontSize: '0.62rem',
  letterSpacing: '0.02em',
  color: 'var(--color-text-muted)',
  whiteSpace: 'nowrap',
};

const refreshErrStyle: React.CSSProperties = { ...refreshStatusStyle, color: 'var(--color-orange)' };

const refreshBtnStyle: React.CSSProperties = {
  appearance: 'none',
  background: 'var(--color-info-bg)',
  border: '1px solid var(--color-info-border)',
  borderRadius: 6,
  color: 'var(--color-info)',
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  fontSize: '0.66rem',
  fontWeight: 600,
  padding: '0.28rem 0.6rem',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const refreshBtnBusyStyle: React.CSSProperties = { opacity: 0.55, cursor: 'default' };

const tabStyle: React.CSSProperties = {
  appearance: 'none',
  background: 'transparent',
  border: '1px solid transparent',
  borderBottom: 'none',
  borderRadius: '6px 6px 0 0',
  color: 'var(--color-text-dim)',
  fontSize: '0.74rem',
  fontWeight: 600,
  padding: '0.35rem 0.7rem',
  cursor: 'pointer',
};

const tabActiveStyle: React.CSSProperties = {
  ...tabStyle,
  background: 'var(--color-code-bg)',
  border: '1px solid var(--color-border-rail)',
  borderBottom: '1px solid var(--color-code-bg)',
  color: 'var(--color-text-bright)',
  marginBottom: -1,
};

const scrollWrapStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  // the panel itself fills this height and scrolls internally (.panel-scroll),
  // so the selection bar / detail drawer can dock to its bottom
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'stretch',
  justifyContent: 'center',
  padding: '12px 10px',
};
