/**
 * From the issues of a Project to the snapshot the Dashboard reads, and the
 * two hidden blocks an issue's body can carry.
 *
 * The sorting rules (architecture document, section 3.6): an issue labelled
 * `session` is a session issue; an issue with a parent on the same Project is
 * listed under that focus and not by itself; of the rest, the Project's own
 * `Level` field says whether an issue is a focus or an item.
 *
 * The category used to be derived here — a focus when the issue had a Stage,
 * or a kind label, or sub-issues. No GitHub filter expresses that, so the
 * Dashboard and GitHub could not show the same set. An issue with no `Level`
 * is read as an item and named in `problems`, so a hole in the Project is
 * visible rather than guessed at. The gh adapter and `FakeGitHub` both sort
 * with `buildProjectSnapshot`, so they cannot differ.
 */

import { isWriteTarget } from '../desk/guards.js';
import type { WriteTarget } from '../desk/types.js';
import { viewDrift } from './views.js';
import {
  AGENTS_COLUMNS,
  AGENTS_FIELD,
  DEFAULT_VIEWS,
  type AgentsColumn,
  FOCUS_LEVEL,
  type FieldInfo,
  type FocusItem,
  KIND_LABELS,
  LEVEL_FIELD,
  type PlanItem,
  type ProjectInfo,
  type ProjectViewInfo,
  type ProjectSnapshot,
  type RawProjectIssue,
  SESSION_LABEL,
  STAGE_FIELD,
  STATUS_FIELD,
  type SessionIssue,
} from './types.js';

/** What a session issue's body records about the session, in its hidden block. */
export type SessionBlock = {
  targets: WriteTarget[];
  attended: boolean;
  person: string;
  machine: string;
};

const SESSION_BLOCK = /<!-- ai-lore-session: (.*?) -->/s;
const SPEC_BLOCK = /<!-- ai-lore-spec: (\S+) -->/;

/** `-->` cannot appear inside an HTML comment, so `>` is written as its JSON escape. */
function commentSafe(json: string): string {
  return json.replace(/>/g, '\\u003e');
}

/** The hidden block of a session issue's body. GitHub does not render an HTML comment. */
export function formatSessionBlock(block: SessionBlock): string {
  return `<!-- ai-lore-session: ${commentSafe(JSON.stringify(block))} -->`;
}

/** The session block of a body, or `null` when the body has none or it cannot be read. */
export function parseSessionBlock(body: string): SessionBlock | null {
  const match = SESSION_BLOCK.exec(body);
  if (match === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1] ?? '');
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const block = parsed as Record<string, unknown>;
  return {
    targets: Array.isArray(block.targets) ? block.targets.filter(isWriteTarget) : [],
    attended: block.attended !== false,
    person: typeof block.person === 'string' ? block.person : '',
    machine: typeof block.machine === 'string' ? block.machine : '',
  };
}

/** The hidden line of a focus issue's body that gives the address of its published spec. */
export function formatSpecLink(url: string): string {
  return `<!-- ai-lore-spec: ${url.replace(/\s/g, '%20')} -->`;
}

/** The address of the published spec in a body, or `null`. */
export function parseSpecLink(body: string): string | null {
  return SPEC_BLOCK.exec(body)?.[1] ?? null;
}

/**
 * A markdown heading whose text begins with "Acceptance" — "## Acceptance
 * criteria", "## Acceptance", "### Acceptance Criteria".
 */
const CRITERIA_HEADING = /^\s{0,3}#{1,6}\s+acceptance\b/im;

/**
 * Whether the body names acceptance criteria.
 *
 * This is a heuristic and not a reading of the criteria themselves. It answers
 * one question: could anyone check this work against what its ticket says? A
 * focus whose criteria live somewhere else — an archive, a brief, a spec a
 * reader has to go and find — can never be computed as done, and the honest
 * answer is to say so rather than to leave it out of the reckoning. The Space's
 * own #1 was exactly that: its eight criteria were in a v0.8 archive, so
 * nothing could ever have said it was finished.
 *
 * It does not say the criteria are met. Whether a criterion is met is written
 * in a report, by a session, in prose, and nothing here reads that.
 */
export function bodyNamesCriteria(body: string): boolean {
  return CRITERIA_HEADING.test(body);
}

function isAgentsColumn(value: string | undefined): value is AgentsColumn {
  return AGENTS_COLUMNS.some((column) => column === value);
}

function planItem(raw: RawProjectIssue): PlanItem {
  return {
    issue: raw.issue,
    title: raw.title,
    state: raw.state,
    status: raw.fieldValues[STATUS_FIELD] ?? null,
    labels: raw.labels,
    updatedAt: raw.updatedAt,
  };
}

function sessionIssue(raw: RawProjectIssue): SessionIssue {
  const block = parseSessionBlock(raw.body);
  const value = raw.fieldValues[AGENTS_FIELD];
  const column: AgentsColumn = isAgentsColumn(value)
    ? value
    : raw.state === 'closed'
      ? 'Done'
      : 'Read only';
  return {
    issue: raw.issue,
    title: raw.title,
    column,
    targets: block?.targets ?? [],
    attended: block?.attended ?? true,
    person: block?.person ?? '',
    machine: block?.machine ?? '',
    updatedAt: raw.updatedAt,
  };
}

function issueKey(repository: string, number: number): string {
  return `${repository}#${number}`;
}

/**
 * A focus with its items. An item that is on the Project takes its labels and
 * Status from its own entry; one that is not has no labels and no Status.
 */
function focusItem(raw: RawProjectIssue, onProject: Map<string, RawProjectIssue>): FocusItem {
  return {
    ...planItem(raw),
    stage: raw.fieldValues[STAGE_FIELD] ?? null,
    stageChangedAt: raw.fieldValuesAt[STAGE_FIELD] ?? null,
    kind: raw.labels.find((label) => KIND_LABELS.includes(label)) ?? null,
    items: raw.subIssues.map((sub) => {
      const own = onProject.get(issueKey(sub.issue.repository, sub.issue.number));
      if (own !== undefined) return planItem(own);
      return {
        issue: sub.issue,
        title: sub.title,
        state: sub.state,
        status: null,
        labels: [],
        updatedAt: null,
      };
    }),
    specUrl: parseSpecLink(raw.body),
    criteriaOnTicket: bodyNamesCriteria(raw.body),
  };
}

/** Sort the issues of a Project into the snapshot. `issues` is in the Project's own order. */
export function buildProjectSnapshot(arg: {
  project: ProjectInfo;
  stageField: FieldInfo | null;
  issues: readonly RawProjectIssue[];
  /**
   * The Project's views, checked against the default layout. Setup announced
   * its by-hand grouping steps once and nothing looked again, so this Space's
   * Project sat ungrouped and mis-filtered from creation until 2026-09-22
   * without anything saying so. Every read reports it now.
   */
  views?: readonly ProjectViewInfo[];
  /** ISO 8601. */
  fetchedAt: string;
}): ProjectSnapshot {
  const key = issueKey;
  const onProject = new Map(
    arg.issues.map((raw) => [key(raw.issue.repository, raw.issue.number), raw]),
  );
  const focuses: FocusItem[] = [];
  const standalone: PlanItem[] = [];
  const sessions: SessionIssue[] = [];
  const problems: string[] = [];
  for (const raw of arg.issues) {
    if (raw.labels.includes(SESSION_LABEL)) {
      sessions.push(sessionIssue(raw));
      continue;
    }
    const underFocus =
      raw.parentNumber !== null && onProject.has(key(raw.issue.repository, raw.parentNumber));
    if (underFocus) continue;
    const level = raw.fieldValues[LEVEL_FIELD];
    if (level === undefined) {
      problems.push(
        `${key(raw.issue.repository, raw.issue.number)} has no value for the field ${LEVEL_FIELD}, so it is read as an item.`,
      );
    }
    if (level === FOCUS_LEVEL) focuses.push(focusItem(raw, onProject));
    else standalone.push(planItem(raw));
  }
  if (arg.views !== undefined) problems.push(...viewDrift(DEFAULT_VIEWS, arg.views));
  const { owner, number, title, url } = arg.project;
  return {
    fetchedAt: arg.fetchedAt,
    project: { owner, number, title, url },
    stageField: { id: arg.stageField?.id ?? '', options: arg.stageField?.options ?? [] },
    focuses,
    standalone,
    sessions,
    problems,
  };
}
