/**
 * The Dashboard's model (architecture document, section 5.11). Phase M7.2.
 *
 * A pure function from the Project's snapshot, the desk's sessions, the
 * pending gates and the current time to the three parts of the Dashboard:
 *
 * - the focuses by Stage: one column per option of the Stage field, in the
 *   field's order, with a card per focus, and the standalone items beside the
 *   columns;
 * - the Agents board: one row per session issue, marked stale when it has been
 *   in Writing or Blocked without a change on GitHub for the threshold;
 * - Needs you, in order: the pending gates, the focuses at Review, the stale
 *   sessions. Mirrors out of date are not in the MVP.
 *
 * Everything shown comes from the input. An item is done when its issue is
 * closed or its Status is `Done`. A session issue is never a focus or an item,
 * even when it is linked as a sub-issue. A focus whose Stage is not an option
 * of the field (or that has none) is listed under `unstaged`.
 *
 * The types of this file are plain data; the renderer imports them with
 * `import type` and receives the model through IPC.
 */

import type { IssueRef, SessionRecord } from '../desk/types.js';
import {
  type AgentsColumn,
  type FocusItem,
  PAUSED_LABEL,
  type PlanItem,
  type ProjectSnapshot,
  SESSION_LABEL,
  type SessionIssue,
} from '../github/types.js';

/** The threshold after which a session in Writing or Blocked is stale: one day (product document; a setting). */
export const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** The Stage value whose focuses are listed under Needs you. */
export const REVIEW_STAGE = 'Review';

/** The Status value that marks an item done, as a closed issue does. */
export const DONE_STATUS = 'Done';

/** The columns of the Agents board in which a session can go stale. */
const STALE_COLUMNS: readonly AgentsColumn[] = ['Writing', 'Blocked'];

/** A gate that waits for the Human Lead, as the dialog broker holds it. */
export type DashboardGate = {
  ticket: string;
  sessionId: string;
  /** ISO 8601. */
  askedAt: string;
  process: string;
  step: string;
  question: string;
};

/** What the model is computed from. */
export type DashboardInput = {
  snapshot: ProjectSnapshot;
  /** The desk's sessions, open and closed. */
  sessions: readonly SessionRecord[];
  /** The gates that wait now. */
  gates: readonly DashboardGate[];
  /** ISO 8601. */
  now: string;
  /** Default `DEFAULT_STALE_AFTER_MS`. */
  staleAfterMs?: number;
};

/** An item of a focus, or a standalone item. */
export type ItemCard = {
  issue: IssueRef;
  title: string;
  state: 'open' | 'closed';
  status: string | null;
  labels: string[];
  /** Closed, or Status `Done`. */
  done: boolean;
  /** Labelled `paused` (a paused focus carried over by migration). */
  paused: boolean;
  updatedAt: string | null;
};

/** A focus on its Stage column. */
export type FocusCard = {
  issue: IssueRef;
  title: string;
  state: 'open' | 'closed';
  status: string | null;
  labels: string[];
  stage: string | null;
  stageChangedAt: string | null;
  kind: string | null;
  specUrl: string | null;
  /** Whether the issue's body names acceptance criteria. See `bodyNamesCriteria`. */
  criteriaOnTicket: boolean;
  /** The Goals the focus carries, which are what the Human Lead checks at the gate. */
  goals: string[];
  updatedAt: string | null;
  /** The focus's items, session issues left out. */
  items: ItemCard[];
  itemsDone: number;
  itemsTotal: number;
  /** The question of a pending gate of a session working on this focus or one of its items, or `null`. */
  gateNote: string | null;
  /** Closed, or Status `Done`. */
  done: boolean;
};

/** One column: an option of the Stage field. */
export type StageColumn = { id: string; name: string; focuses: FocusCard[] };

/** One row of the Agents board. */
export type BoardRow = {
  issue: IssueRef;
  /** The issue's title: "The <engine> session that started at <time>". */
  title: string;
  column: AgentsColumn;
  targets: SessionIssue['targets'];
  attended: boolean;
  person: string;
  machine: string;
  updatedAt: string | null;
  /** Milliseconds since `updatedAt`, or `null` when it cannot be read. */
  idleMs: number | null;
  stale: boolean;
  /** The session on this desk whose issue this is, or `null` for a session of another desk. */
  local: {
    sessionId: string;
    engine: string;
    startedAt: string;
    closed: boolean;
    /** The item or focus the session is on, from the desk, or `null`. */
    item: IssueRef | null;
    /** The options that changed the guard when the session started, from the desk; `[]` when none. */
    unguarded: string[];
  } | null;
  /** The ticket of a pending gate of the local session, or `null`. */
  gateTicket: string | null;
};

/** One entry of Needs you. */
export type NeedsYouEntry =
  | {
      kind: 'gate';
      ticket: string;
      sessionId: string;
      askedAt: string;
      process: string;
      step: string;
      question: string;
      /** The item or focus the session is on, from the desk, or `null`. */
      item: IssueRef | null;
    }
  | { kind: 'review'; focus: IssueRef; title: string }
  | {
      /**
       * Every item of this focus is closed, so it is waiting for the Human
       * Lead's Done call. Only the prompt is automated: nothing here moves a
       * Stage, which stays the Human Lead's explicit yes under stage-gate.
       */
      kind: 'ready-for-done';
      focus: IssueRef;
      title: string;
      /**
       * `false` when the focus's body names no acceptance criteria, so whether
       * the work is *done* cannot be checked against its own ticket. Such a
       * focus is reported as uncomputable rather than left out of the
       * reckoning: silence reads as "not ready", which is how #1 sat finished
       * and unnoticed for two days.
       */
      criteriaOnTicket: boolean;
      /**
       * The Goals to check at the gate. Empty when the focus names none, and
       * such a focus is reported as uncomputable rather than left out: silence
       * reads as "not ready", which is how #1 sat finished and unnoticed for
       * two days.
       *
       * Nothing here says a Goal is met. A Goal is checkable by reading, and
       * whether it is met is the Human Lead's to say at the gate.
       */
      goals: string[];
    }
  | {
      /**
       * Something about the Project itself that the companion can see and
       * cannot fix: a view whose filter or grouping does not match the default
       * layout, or an issue with no `Level`.
       *
       * These were computed into `ProjectSnapshot.problems` and rendered
       * nowhere. A diagnostic whose only audience cannot see it is the failure
       * this Space's focus on the plan exists to cure — setup said its piece
       * once, to a place nobody looked at again.
       *
       * Every one of them is the Human Lead's to fix, which is why they belong
       * in "Needs you" and not in a log.
       */
      kind: 'project-problem';
      message: string;
    }
  | {
      kind: 'stale-session';
      issue: IssueRef;
      column: AgentsColumn;
      idleMs: number;
      sessionId: string | null;
    };

/** The Dashboard's model. */
export type DashboardModel = {
  columns: StageColumn[];
  /** Focuses whose Stage is not an option of the field, or empty. */
  unstaged: FocusCard[];
  standalone: ItemCard[];
  board: BoardRow[];
  needsYou: NeedsYouEntry[];
};

function sameIssue(a: IssueRef, b: IssueRef): boolean {
  return a.repository === b.repository && a.number === b.number;
}

function isDone(item: PlanItem): boolean {
  return item.state === 'closed' || item.status === DONE_STATUS;
}

function itemCard(item: PlanItem): ItemCard {
  return {
    issue: item.issue,
    title: item.title,
    state: item.state,
    status: item.status,
    labels: item.labels,
    done: isDone(item),
    paused: item.labels.includes(PAUSED_LABEL),
    updatedAt: item.updatedAt,
  };
}

function focusCard(focus: FocusItem, gateNote: string | null): FocusCard {
  const items = focus.items.filter((item) => !item.labels.includes(SESSION_LABEL)).map(itemCard);
  return {
    issue: focus.issue,
    title: focus.title,
    state: focus.state,
    status: focus.status,
    labels: focus.labels,
    stage: focus.stage,
    stageChangedAt: focus.stageChangedAt,
    kind: focus.kind,
    specUrl: focus.specUrl,
    criteriaOnTicket: focus.criteriaOnTicket,
    goals: focus.goals,
    updatedAt: focus.updatedAt,
    items,
    itemsDone: items.filter((item) => item.done).length,
    itemsTotal: items.length,
    gateNote,
    done: isDone(focus),
  };
}

/** Compute the Dashboard's model. Pure: the same input gives the same model. */
export function dashboardModel(input: DashboardInput): DashboardModel {
  const { snapshot } = input;
  const now = Date.parse(input.now);
  const staleAfter = input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const sessionsById = new Map(input.sessions.map((session) => [session.id, session]));
  const gates = [...input.gates].sort((a, b) => a.askedAt.localeCompare(b.askedAt));

  const gateNoteFor = (focus: FocusItem): string | null => {
    for (const gate of gates) {
      const item = sessionsById.get(gate.sessionId)?.item;
      if (item === undefined) continue;
      if (sameIssue(item, focus.issue) || focus.items.some((sub) => sameIssue(sub.issue, item))) {
        return gate.question;
      }
    }
    return null;
  };

  const focuses = snapshot.focuses
    .filter((focus) => !focus.labels.includes(SESSION_LABEL))
    .map((focus) => focusCard(focus, gateNoteFor(focus)));
  const columns: StageColumn[] = snapshot.stageField.options.map((option) => ({
    id: option.id,
    name: option.name,
    focuses: focuses.filter((card) => card.stage === option.name),
  }));
  const names = new Set(columns.map((column) => column.name));
  const unstaged = focuses.filter((card) => card.stage === null || !names.has(card.stage));
  const standalone = snapshot.standalone
    .filter((item) => !item.labels.includes(SESSION_LABEL))
    .map(itemCard);

  const board: BoardRow[] = snapshot.sessions.map((session) => {
    const updated = Date.parse(session.updatedAt);
    const idleMs = Number.isNaN(updated) || Number.isNaN(now) ? null : Math.max(0, now - updated);
    const record = input.sessions.find(
      (candidate) => candidate.issue !== undefined && sameIssue(candidate.issue, session.issue),
    );
    const gate =
      record === undefined ? undefined : gates.find((entry) => entry.sessionId === record.id);
    return {
      issue: session.issue,
      title: session.title,
      column: session.column,
      targets: session.targets,
      attended: session.attended,
      person: session.person,
      machine: session.machine,
      updatedAt: session.updatedAt,
      idleMs,
      stale: idleMs !== null && STALE_COLUMNS.includes(session.column) && idleMs >= staleAfter,
      local:
        record === undefined
          ? null
          : {
              sessionId: record.id,
              engine: record.engine,
              startedAt: record.startedAt,
              closed: record.closedAt !== undefined,
              item: record.item ?? null,
              unguarded: record.unguarded ?? [],
            },
      gateTicket: gate?.ticket ?? null,
    };
  });

  const needsYou: NeedsYouEntry[] = [
    // What the Project says about itself that is wrong. Computed on every read
    // since the view check landed, and until now rendered nowhere.
    ...snapshot.problems.map((message): NeedsYouEntry => ({ kind: 'project-problem', message })),
    ...gates.map(
      (gate): NeedsYouEntry => ({
        kind: 'gate',
        ticket: gate.ticket,
        sessionId: gate.sessionId,
        askedAt: gate.askedAt,
        process: gate.process,
        step: gate.step,
        question: gate.question,
        item: sessionsById.get(gate.sessionId)?.item ?? null,
      }),
    ),
    ...columns
      .filter((column) => column.name === REVIEW_STAGE)
      .flatMap((column) => column.focuses)
      .filter((card) => card.state === 'open')
      .map((card): NeedsYouEntry => ({ kind: 'review', focus: card.issue, title: card.title })),
    // Every item closed and the focus still open: the work is finished and the
    // record has not moved. Nothing prompted this before — the only prompt in
    // the Lore fires inside the `work` process, when a session happens to run
    // it on the last item, so a focus finished by an earlier session carried
    // nothing forward. A focus already at Review has its own entry above.
    ...columns
      .filter((column) => column.name !== REVIEW_STAGE)
      .flatMap((column) => column.focuses)
      .concat(unstaged)
      .filter(
        (card) =>
          card.state === 'open' && card.itemsTotal > 0 && card.itemsDone === card.itemsTotal,
      )
      .map(
        (card): NeedsYouEntry => ({
          kind: 'ready-for-done',
          focus: card.issue,
          title: card.title,
          criteriaOnTicket: card.criteriaOnTicket,
          goals: card.goals,
        }),
      ),
    ...board
      .filter((row) => row.stale)
      .sort((a, b) => (b.idleMs ?? 0) - (a.idleMs ?? 0))
      .map(
        (row): NeedsYouEntry => ({
          kind: 'stale-session',
          issue: row.issue,
          column: row.column,
          idleMs: row.idleMs ?? 0,
          sessionId: row.local?.sessionId ?? null,
        }),
      ),
  ];

  return { columns, unstaged, standalone, board, needsYou };
}
