import { type JSX, useEffect, useRef, useState } from 'react';
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
 * Memory — each its own dashboard with **domain-specific signals**: Status →
 * momentum & readiness; Payload → coverage, code quality, lint; Memory →
 * sign-off, consistency, tidiness. All **hand-written sample data** for now
 * ({@link TABS}); hydration re-attaches later, the shape unchanged. Type is
 * Geist/Geist Mono with system fallbacks.
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

function StreamRow({ s }: { s: Stream }): JSX.Element {
  const v = SP_VERDICTS[s.verdict];
  const tone = v.tone;
  const m = useMounted(160);
  return (
    <div className={`srow ${s.active ? 'active ' : ''}t-${tone}`}>
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

/* Design-spike sample data for this project, grounded in the real lore.
 * Replaced by AI hydration later — the shape stays identical. One data set per
 * Assistant tab (CR9 Phase 5 spike): Status = the whole project; Payload = the
 * codebase; Memory = the lore. The StatusPanel layout is the same for all three;
 * only the content (and the two health-card slots) differ. */
const STATUS_SAMPLE: StatusData = {
  project: 'AI-Lore Companion',
  release: 'v1.0',
  crumb: 'Project · Status',
  now: 'Turning the companion into an AI assistant',
  verdict: 'on-track',
  streams: [
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
      line: 'A tidy home for it in the side rail.',
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
      name: 'Multi-track projects',
      line: 'Make it work with the newer multi-track projects.',
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
  caughtUp: {
    date: 'June 1',
    context: 'when the idea was just proven and the work was planned',
    items: [
      'Built the whole assistant, end to end, on both engines',
      'Locked in the read-only safety guarantee',
      'Fixed the Gemini engine timing out',
      'Reworked the left side into a clean rail',
      'Started this dashboard',
    ],
  },
  watching: [
    'A lot of recent work is saved but not formally signed off',
    'The bigger multi-track rework still needs a plan',
  ],
  signals: [
    {
      id: 'momentum',
      title: 'Momentum',
      subtitle: 'Pace over the last stretch',
      score: 78,
      label: 'Strong',
      solid: ['Four features shipped end to end', 'The assistant works on both engines'],
      attention: ['The dashboard is the live focus right now'],
    },
    {
      id: 'readiness',
      title: 'Readiness',
      subtitle: 'How close to shipping v1.0',
      score: 62,
      label: 'Getting there',
      attention: [
        'Two features still ahead — multi-track support and the model picker',
        'The dashboard needs real data wired in before it ships',
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
  { id: 'status', label: 'Status', data: STATUS_SAMPLE },
  { id: 'payload', label: 'Payload', data: PAYLOAD_SAMPLE },
  { id: 'memory', label: 'Memory', data: MEMORY_SAMPLE },
] as const;

export function AssistantDashboard(): JSX.Element {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('status');
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];
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
      </div>
      <div style={scrollWrapStyle}>
        {/* re-mount the panel per tab so the count-up / bar animations replay */}
        <StatusPanel key={active.id} data={active.data} />
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
  background: '#0a0f17',
};

const tabStripStyle: React.CSSProperties = {
  display: 'flex',
  gap: 2,
  padding: '6px 8px 0',
  borderBottom: '1px solid #161e29',
  flexShrink: 0,
};

const tabStyle: React.CSSProperties = {
  appearance: 'none',
  background: 'transparent',
  border: '1px solid transparent',
  borderBottom: 'none',
  borderRadius: '6px 6px 0 0',
  color: '#8b96a2',
  fontSize: '0.74rem',
  fontWeight: 600,
  padding: '0.35rem 0.7rem',
  cursor: 'pointer',
};

const tabActiveStyle: React.CSSProperties = {
  ...tabStyle,
  background: '#0e141d',
  border: '1px solid #1b2430',
  borderBottom: '1px solid #0e141d',
  color: '#e8edf3',
  marginBottom: -1,
};

const scrollWrapStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  display: 'flex',
  justifyContent: 'center',
  padding: '12px 10px',
};
