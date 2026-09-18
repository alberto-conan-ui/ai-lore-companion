/**
 * From the issues of a Project to the snapshot the Dashboard reads, and the
 * two hidden blocks an issue's body can carry.
 *
 * The sorting rules (architecture document, section 3.6): an issue labelled
 * `session` is a session issue; an issue with a parent on the same Project is
 * listed under that focus and not by itself; of the rest, an issue is a focus
 * when it has a Stage, a kind label or sub-issues, and a standalone item
 * otherwise. The gh adapter and `FakeGitHub` both sort with
 * `buildProjectSnapshot`, so they cannot differ.
 */

import { isWriteTarget } from '../desk/guards.js';
import type { WriteTarget } from '../desk/types.js';
import {
  AGENTS_COLUMNS,
  AGENTS_FIELD,
  type AgentsColumn,
  FOCUS_KIND_LABELS,
  type FieldInfo,
  type FocusItem,
  type PlanItem,
  type ProjectInfo,
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
    kind: raw.labels.find((label) => FOCUS_KIND_LABELS.includes(label)) ?? null,
    items: raw.subIssues.map((sub) => {
      const own = onProject.get(issueKey(sub.issue.repository, sub.issue.number));
      if (own !== undefined) return planItem(own);
      return { issue: sub.issue, title: sub.title, state: sub.state, status: null, labels: [] };
    }),
    specUrl: parseSpecLink(raw.body),
  };
}

/** Sort the issues of a Project into the snapshot. `issues` is in the Project's own order. */
export function buildProjectSnapshot(arg: {
  project: ProjectInfo;
  stageField: FieldInfo | null;
  issues: readonly RawProjectIssue[];
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
  for (const raw of arg.issues) {
    if (raw.labels.includes(SESSION_LABEL)) {
      sessions.push(sessionIssue(raw));
      continue;
    }
    const underFocus =
      raw.parentNumber !== null && onProject.has(key(raw.issue.repository, raw.parentNumber));
    if (underFocus) continue;
    const isFocus =
      raw.fieldValues[STAGE_FIELD] !== undefined ||
      raw.subIssues.length > 0 ||
      raw.labels.some((label) => FOCUS_KIND_LABELS.includes(label));
    if (isFocus) focuses.push(focusItem(raw, onProject));
    else standalone.push(planItem(raw));
  }
  const { owner, number, title, url } = arg.project;
  return {
    fetchedAt: arg.fetchedAt,
    project: { owner, number, title, url },
    stageField: { id: arg.stageField?.id ?? '', options: arg.stageField?.options ?? [] },
    focuses,
    standalone,
    sessions,
  };
}
