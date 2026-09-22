/**
 * A session's issue on the Agents board (architecture document, sections 3.6
 * and 5.6; phase M4.7).
 *
 * A session gets an issue the first time it enters Writing. The issue is in
 * the Space repository, carries the label `session`, and is on the Space's
 * Project, where the single-select field `Agents` holds its column: Read only,
 * Writing, Blocked or Done. Its body says which session it is, which item the
 * session is on, and which write targets it holds with their branches, and it
 * carries two hidden lines: the session block that `buildProjectSnapshot`
 * reads, and a marker by which the issue is found again, so that a second
 * Writing in the same session updates the issue and never creates another.
 *
 * Every function here returns the first GitHub failure and does nothing more.
 * Nothing is retried and nothing is queued (the focus's cut line): the caller
 * logs the failure and tells the session.
 */

import { describeWriteTarget } from '../claims/rules.js';
import type { IssueRef, WriteTarget } from '../desk/types.js';
import type { GitHubError } from '../github/errors.js';
import { formatIssueMarker } from '../github/marker.js';
import type { GitHubPort, GitHubResult } from '../github/port.js';
import { formatSessionBlock } from '../github/snapshot.js';
import {
  AGENTS_COLUMNS,
  AGENTS_FIELD,
  type AgentsColumn,
  type FieldInfo,
  type ProjectInfo,
  SESSION_LABEL,
} from '../github/types.js';
import { ISSUE_BODY_MAX, ISSUE_TITLE_MAX, isBranchName } from '../github/validate.js';
import { err, ok } from '../result.js';

/** Where a session's issue lives: the Space repository and the Space's Project. */
export type SessionIssuePlace = {
  github: GitHubPort;
  /** The Space repository, `owner/name`. */
  repository: string;
  project: ProjectInfo;
};

/**
 * What a session's issue says. The session's id is only in the hidden marker:
 * the title and the text name the session by its engine and start time, as
 * the desk's dialogs do.
 */
export type SessionIssueContent = {
  sessionId: string;
  /** The engine's id from the engines registry, for example `claude-code`. */
  engine: string;
  /** When the session started, as the desk recorded it. */
  startedAt: string;
  /** The write targets the session holds now. */
  targets: readonly WriteTarget[];
  /** The item the session is on, when it named one. */
  item?: IssueRef;
  /**
   * Every ticket the session has done substantive work on. `item` is where the
   * session was pointed; these are where it went, and they are what makes
   * traceability run both ways.
   */
  tickets?: readonly IssueRef[];
  attended: boolean;
  /** The GitHub account of the person, or empty. */
  person: string;
  /** The machine's name, or empty. */
  machine: string;
  /**
   * The profile the session ran, named in one line of the body between the
   * item and the write targets (M14.4). Absent: the body names no profile, as
   * it read before M14. The issue's title and marker never carry it.
   */
  profile?: { name: string; id: string; engine: string; model?: string };
};

/** The marker of a session's issue: the hidden line by which it is found again. */
export function sessionIssueMarker(sessionId: string): string {
  return formatIssueMarker('session-issue', sessionId);
}

/** The address of issue `number` of `repository` on github.com. */
export function issueRefFor(repository: string, number: number): IssueRef {
  return { repository, number, url: `https://github.com/${repository}/issues/${number}` };
}

function targetLine(target: WriteTarget): string {
  const branch = target.kind === 'repository' ? ` on the branch "${target.branch}"` : '';
  return `- ${describeWriteTarget(target)}${branch}`;
}

/** The title of a session's issue: its engine and start time. The session's id is not shown. */
export function sessionIssueTitle(session: { engine: string; startedAt: string }): string {
  return `The ${session.engine} session that started at ${session.startedAt}`.slice(
    0,
    ISSUE_TITLE_MAX,
  );
}

/**
 * The one line that names the profile a session ran, in the body between the
 * item and the write targets (M14.4). The model reads as the engine's own
 * default when the profile named none.
 */
function profileLine(profile: NonNullable<SessionIssueContent['profile']>): string {
  const model = profile.model ?? "the engine's default";
  return `Profile: ${profile.name} (${profile.id}), engine ${profile.engine}, model ${model}`;
}

/** The body of a session's issue: short and literal, then the two hidden lines. */
export function formatSessionIssueBody(content: SessionIssueContent): string {
  const item = content.item === undefined ? 'none' : content.item.url;
  const targets =
    content.targets.length === 0 ? ['- none'] : content.targets.map((target) => targetLine(target));
  return [
    `The issue of the ${content.engine} session that started at ${content.startedAt}, kept by the companion.`,
    '',
    `Item: ${item}`,
    ...(content.profile === undefined ? [] : ['', profileLine(content.profile)]),
    '',
    'Write targets:',
    ...targets,
    '',
    'Tickets this session touched:',
    ...(content.tickets === undefined || content.tickets.length === 0
      ? ['- none yet']
      : content.tickets.map((ticket) => `- ${ticket.url}`)),
    '',
    formatSessionBlock({
      targets: [...content.targets],
      attended: content.attended,
      person: content.person,
      machine: content.machine,
    }),
    sessionIssueMarker(content.sessionId),
    '',
  ].join('\n');
}

/**
 * The Space's Project: the open Project of the Space repository's owner titled
 * with the Space's name. When the manifest gives a number, the Project found
 * must have it. Fails with `not-found` when there is none.
 */
export async function findSpaceProject(
  github: GitHubPort,
  space: { repository: string; name: string; project: number },
): Promise<GitHubResult<ProjectInfo>> {
  const owner = space.repository.split('/')[0] ?? '';
  const found = await github.findProject({ owner, title: space.name });
  if (!found.ok) return found;
  const project = found.value;
  if (project === null || (space.project > 0 && project.number !== space.project)) {
    return err({
      kind: 'not-found',
      message: `the Project "${space.name}" of ${owner}${space.project > 0 ? ` with the number ${space.project}` : ''} was not found`,
    });
  }
  return ok(project);
}

/**
 * The field `Agents` of the Project, with the four columns as setup made it.
 * The same call setup makes, so a Project set up by setup is left as it is.
 */
export function agentsField(
  github: GitHubPort,
  project: ProjectInfo,
): Promise<GitHubResult<FieldInfo>> {
  return github.ensureSingleSelectField({
    project,
    name: AGENTS_FIELD,
    options: [...AGENTS_COLUMNS],
  });
}

/** Put an issue in a column of the Agents board. The issue is added to the Project when it is not there. */
export async function moveSessionIssue(
  place: SessionIssuePlace,
  issue: IssueRef,
  column: AgentsColumn,
): Promise<GitHubResult<void>> {
  const { github, project } = place;
  const item = await github.addIssueToProject({ project, issue });
  if (!item.ok) return item;
  const field = await agentsField(github, project);
  if (!field.ok) return field;
  return github.setSingleSelect({ project, item: item.value, field: field.value, option: column });
}

/**
 * Create or update the session's issue and put it in `column`. `known` is the
 * issue the desk recorded for the session; without it the issue is looked for
 * by its marker first, and created only when none has the marker.
 */
export async function putSessionIssue(
  place: SessionIssuePlace,
  content: SessionIssueContent,
  column: AgentsColumn,
  known?: IssueRef,
): Promise<GitHubResult<{ issue: IssueRef; created: boolean }>> {
  const { github, repository } = place;
  const body = formatSessionIssueBody(content);
  let issue = known ?? null;
  if (issue === null) {
    const found = await github.findIssueByMarker({
      repository,
      marker: sessionIssueMarker(content.sessionId),
    });
    if (!found.ok) return found;
    issue = found.value;
  }
  let created = false;
  if (issue === null) {
    const made = await github.createIssue({
      repository,
      title: sessionIssueTitle(content),
      body,
      labels: [SESSION_LABEL],
    });
    if (!made.ok) return made;
    issue = made.value;
    created = true;
  } else {
    const updated = await github.updateIssue({ issue, body });
    if (!updated.ok) return updated;
  }
  const moved = await moveSessionIssue(place, issue, column);
  if (!moved.ok) return moved;
  return ok({ issue, created });
}

/** A folder of this machine and the text that stands for it on GitHub. */
export type LocalFolder = { path: string; as: string };

const HANDOVER_HEAD = '## Handover\n\n';
const HANDOVER_CUT =
  '\n\n(The handover is longer than GitHub accepts in a comment. The rest is in the journal entry on the desk.)';
const ENTRY_HEAD =
  "## The session's journal entry\n\n_The write-ahead copy. The record of each piece of work is on its own ticket._\n\n";

/**
 * The comment that carries a handover to the ticket of the work it concerns.
 * Each folder of `local` (the Space, the desk, the home folder) is replaced by
 * its stand-in wherever it appears, the longest first, so that no path of this
 * machine reaches GitHub; a handover longer than GitHub accepts is cut and
 * says so.
 */
export function formatHandoverComment(
  handover: string,
  local: readonly LocalFolder[] = [],
): string {
  return withoutLocalPaths(handover, local, HANDOVER_HEAD);
}

/**
 * The comment that carries the whole journal entry to the session's own issue.
 *
 * The whole entry, not only its `## Handover` section. "What it learned that a
 * later session needs" and "Corrections to earlier records" never reached
 * GitHub, and those are the parts a later session most needs — two of them, in
 * this Space, had to be learned twice because they sat in a journal on one
 * desk.
 */
export function formatEntryComment(entry: string, local: readonly LocalFolder[] = []): string {
  return withoutLocalPaths(entry, local, ENTRY_HEAD);
}

function withoutLocalPaths(body: string, local: readonly LocalFolder[], head: string): string {
  let text = body.trim();
  const folders = local
    .filter((folder) => folder.path.length > 1)
    .sort((a, b) => b.path.length - a.path.length);
  for (const folder of folders) text = text.split(folder.path).join(folder.as);
  const room = ISSUE_BODY_MAX - head.length - 1;
  if (text.length > room) text = `${text.slice(0, room - HANDOVER_CUT.length)}${HANDOVER_CUT}`;
  return `${head}${text}\n`;
}

/**
 * The session closed: the whole journal entry is written as a comment on the
 * issue, and the issue moves to Done. The issue stays open.
 *
 * Two things changed here on 2026-09-22, and both come from one defect.
 *
 * **It is the whole entry, not the handover.** Only `## Handover` used to be
 * published, so what the session learned and what it corrected stayed on one
 * desk.
 *
 * **The handover is no longer written here at all.** It used to be copied onto
 * the session's issue — a throwaway that the plan model states is "never a
 * focus or an item" — so the most valuable artefact for continuity landed
 * where nobody looks for a piece of work. The richest handover of 2026-09-21
 * is on session issue #57 and not on the ticket where that work continues. The
 * verb session-close sends a handover to the ticket of each piece of work it
 * concerns; this issue carries the entry as the write-ahead copy.
 *
 * The two do not overlap: different text, in different places, each where it
 * is looked for.
 */
export async function closeSessionIssue(
  place: SessionIssuePlace,
  issue: IssueRef,
  entry: string | null,
  local: readonly LocalFolder[] = [],
): Promise<GitHubResult<void>> {
  if (entry !== null && entry.trim() !== '') {
    const commented = await place.github.comment({
      issue,
      body: formatEntryComment(entry, local),
    });
    if (!commented.ok) return commented;
  }
  return moveSessionIssue(place, issue, 'Done');
}

/**
 * A back-link from a ticket to the session that worked on it.
 *
 * Traceability used to run one way, and only for a session that wrote. Given a
 * ticket, there was no way to learn which sessions had touched it.
 *
 * One comment per ticket, not per edit: a comment on every field change would
 * have put about fifty comments on this Space's tickets in one afternoon and
 * buried the conversation. The session issue is the index; this says where the
 * index is.
 */
export function formatSessionBackLink(session: {
  issue: IssueRef;
  engine: string;
  startedAt: string;
}): string {
  return `Worked on by the ${session.engine} session that started at ${session.startedAt} — ${session.issue.url}\n`;
}

const BRANCH_EXISTS = /already exists/i;

/**
 * The item branch: `name` in `branchRepository`, linked to the item's issue.
 * A branch that exists already is taken as it is: the work process lets the
 * session create the branch itself, and an earlier session may have made it.
 */
export async function developItemBranch(
  github: GitHubPort,
  arg: { item: IssueRef; branchRepository: string; name: string },
): Promise<GitHubResult<{ branch: string; existed: boolean }>> {
  // Refused before GitHub is asked, so that an invalid name is never read as a branch that exists.
  if (!isBranchName(arg.name)) {
    return err({ kind: 'failed', message: `${JSON.stringify(arg.name)} is not a branch name` });
  }
  const made = await github.developBranch({
    issue: arg.item,
    branchRepository: arg.branchRepository,
    name: arg.name,
  });
  if (made.ok) return ok({ branch: made.value.branch, existed: false });
  if (made.error.kind === 'failed' && BRANCH_EXISTS.test(made.error.message)) {
    return ok({ branch: arg.name, existed: true });
  }
  return made;
}

export type HandoverParts = {
  done: string | null;
  inProgress: string | null;
  nextAction: string | null;
  /** The whole `## Handover` body, or the entry's opening lines when it has none. */
  text: string;
  /** True when no part was recognised and `text` is the fallback. */
  fallback: boolean;
};

type HandoverPart = 'done' | 'inProgress' | 'nextAction';

/** The section labels that a journal handover defines. Text merely styled in bold is content. */
const HANDOVER_PART_BY_LABEL: Readonly<Record<string, HandoverPart>> = {
  done: 'done',
  'what was done': 'done',
  'in progress': 'inProgress',
  'what is in progress': 'inProgress',
  'next action': 'nextAction',
  'what the next session should do': 'nextAction',
};

function handoverPartOf(label: string): HandoverPart | null {
  return HANDOVER_PART_BY_LABEL[label.trim().toLowerCase()] ?? null;
}

export function parseHandover(entry: string): HandoverParts {
  const text = readHandover(entry);
  if (text !== null) {
    const lines = text.split('\n');
    let done: string | null = null;
    let inProgress: string | null = null;
    let nextAction: string | null = null;
    
    let currentPart: HandoverPart | null = null;
    let currentLines: string[] = [];
    
    const savePart = () => {
      if (currentPart && currentLines.length > 0) {
        const joined = currentLines.join('\n').trim();
        if (joined !== '') {
          if (currentPart === 'done') done = joined;
          else if (currentPart === 'inProgress') inProgress = joined;
          else if (currentPart === 'nextAction') nextAction = joined;
        }
      }
      currentLines = [];
    };

    for (const line of lines) {
      const isHeading = /^#{1,6}\s+(.*)$/.exec(line);
      const isBold = /^\*\*([^*]+)\*\*$/.exec(line.trim());
      const part = handoverPartOf(isHeading ? (isHeading[1] ?? '') : (isBold?.[1] ?? ''));
      if (part !== null) {
        savePart();
        currentPart = part;
        continue;
      }
      // A heading or bold sentence that is not one of the defined labels is part content.
      if (currentPart) currentLines.push(line);
    }
    savePart();

    if (done !== null || inProgress !== null || nextAction !== null) {
      return { done, inProgress, nextAction, text, fallback: false };
    }
  }

  // fallback
  const lines = entry.split('\n');
  const fallbackLines: string[] = [];
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) continue; // skip headings
    if (line.trim() === '') continue; // skip empty lines
    fallbackLines.push(line);
    if (fallbackLines.length >= 3) break;
  }
  return {
    done: null,
    inProgress: null,
    nextAction: null,
    text: text ?? fallbackLines.join('\n'),
    fallback: true
  };
}

/**
 * The text under the heading `Handover` of a journal entry, up to the next
 * heading of the same or a higher level, or `null` when the entry has none.
 */
export function readHandover(entry: string): string | null {
  const lines = entry.split('\n');
  const start = lines.findIndex((line) => /^#{1,6}\s+handover\b/i.test(line.trim()));
  if (start < 0) return null;
  const level = /^#+/.exec(lines[start]?.trim() ?? '')?.[0].length ?? 1;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const heading = /^(#{1,6})\s/.exec(line);
    if (heading !== null && (heading[1]?.length ?? 7) <= level) break;
    body.push(line);
  }
  const text = body.join('\n').trim();
  return text === '' ? null : text;
}

/** Why a GitHub operation failed, as the end of a sentence. */
export function describeGitHubFailure(error: GitHubError): string {
  switch (error.kind) {
    case 'unreachable':
      return `GitHub could not be reached (${error.message})`;
    case 'not-signed-in':
      return 'gh is not signed in to GitHub';
    case 'missing-scope':
      return `the gh token lacks the scope "${error.scope}"`;
    case 'rate-limited':
      return error.retryAfterSeconds === null
        ? 'GitHub refused the request because of its rate limit'
        : `GitHub refused the request because of its rate limit; try again in ${error.retryAfterSeconds} seconds`;
    case 'not-found':
      return `GitHub answered that ${error.message}`;
    default:
      return `GitHub answered: ${error.message}`;
  }
}
