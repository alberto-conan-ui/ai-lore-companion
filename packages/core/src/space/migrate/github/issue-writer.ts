/**
 * How step 11 writes to GitHub: one call at a time, paced, with a
 * `rate-limited` answer waited for and asked again, and every other failure
 * turned into a sentence that says where the step stopped. Also the title and
 * body of each migrated issue, and the progress events per issue.
 *
 * The per-issue progress goes to `MigrationDeps.onIssueProgress`, through
 * `issueProgressListener`.
 */

import type { GitHubError } from '../../github/errors.js';
import type { GitHubResult } from '../../github/port.js';
import { ISSUE_TITLE_MAX } from '../../github/validate.js';
import { type Result, err, ok } from '../../result.js';
import type { StepError } from '../../steps/types.js';
import type { MigrationContext } from '../context.js';
import type { MigrationIssueKind, MigrationIssuePlan, MigrationIssueProgress } from '../types.js';

/** The wait between two writes to GitHub, in milliseconds (section 5.3: at least one second between two creations). */
export const ISSUE_PACE_MS = 1000;

/** How many times one call is asked again after a `rate-limited` answer before the step stops. */
export const RATE_LIMIT_RETRIES = 3;

/** The longest wait for one `rate-limited` answer, in seconds. A longer wait stops the step instead. */
export const RATE_LIMIT_WAIT_CAP_SECONDS = 900;

/** The wait when GitHub asks for a pause without saying how long, in seconds. */
export const RATE_LIMIT_DEFAULT_WAIT_SECONDS = 60;

/** The listener the caller passed on the deps, or one that does nothing. An exception it raises is ignored. */
export function issueProgressListener(
  deps: MigrationContext['deps'],
): (progress: MigrationIssueProgress) => void {
  const listener = deps.onIssueProgress;
  return (progress) => {
    if (listener === undefined) return;
    try {
      listener(progress);
    } catch {
      // A listener's failure does not stop the step.
    }
  };
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** The place of the issue a failure stopped at, for the sentences below. */
export type IssuePlace = { index: number; total: number; title: string };

/**
 * The failure of step 11 for a GitHub error met at `place`. The kind is
 * `github-<kind of the GitHub error>`, as setup's GitHub failures.
 */
export function issueStepError(error: GitHubError, place: IssuePlace | null): StepError {
  const where =
    place === null
      ? 'The issues step stopped before its first issue.'
      : `The issues step stopped at issue ${place.index + 1} of ${place.total}, "${place.title}".`;
  const kept =
    'The issues created so far stay on GitHub and are found again by their markers, so running the migration again creates none of them twice.';
  let guidance: string;
  switch (error.kind) {
    case 'unreachable':
      guidance = 'Run the migration again when GitHub can be reached.';
      break;
    case 'rate-limited':
      guidance =
        error.retryAfterSeconds === null
          ? 'GitHub still asks for a pause. Run the migration again in a few minutes.'
          : `GitHub still asks for a pause. Run the migration again after ${error.retryAfterSeconds} seconds.`;
      break;
    default:
      guidance = 'Run the migration again when the cause is removed.';
  }
  return {
    kind: `github-${error.kind}`,
    message: `${sentence(error.message)} ${where} ${kept} ${guidance}`,
  };
}

/** The writer of one run of step 11: the pace, the waits, and where it is. */
export type IssueWriter = {
  ctx: MigrationContext;
  /** The issue being written, for the failure's sentence and the waiting events. */
  place: IssuePlace | null;
  /** Called with a sentence when GitHub asked for a pause and the writer waits. */
  onWait: (message: string) => void;
  /** Every wait asked of `ctx.deps.pause`, in milliseconds, in order. */
  waits: number[];
  wroteBefore: boolean;
};

/** A writer for one run. */
export function issueWriter(ctx: MigrationContext, onWait: (message: string) => void): IssueWriter {
  return { ctx, place: null, onWait, waits: [], wroteBefore: false };
}

async function pause(writer: IssueWriter, ms: number): Promise<void> {
  writer.waits.push(ms);
  const wait =
    writer.ctx.deps.pause ??
    ((delay: number) => new Promise<void>((resolve) => setTimeout(resolve, delay)));
  await wait(ms);
}

/**
 * Ask GitHub once, and again after each `rate-limited` answer (at most
 * `RATE_LIMIT_RETRIES` times, each wait at most `RATE_LIMIT_WAIT_CAP_SECONDS`).
 * A write waits `ISSUE_PACE_MS` after the writer's previous write.
 *
 * `recover` is asked after a wait and before asking again: a write whose
 * answer was lost may have been done, and `recover` finds it (an issue by its
 * marker). When it gives a value, that value is the result and the write is
 * not asked again.
 */
export async function askGitHub<T>(
  writer: IssueWriter,
  call: () => Promise<GitHubResult<T>>,
  options: { write: boolean; recover?: () => Promise<Result<T | null, StepError>> },
): Promise<Result<T, StepError>> {
  for (let attempt = 0; ; attempt += 1) {
    if (options.write) {
      if (writer.wroteBefore) await pause(writer, ISSUE_PACE_MS);
      writer.wroteBefore = true;
    }
    const answer = await call();
    if (answer.ok) return ok(answer.value);
    const error = answer.error;
    const seconds =
      error.kind === 'rate-limited'
        ? (error.retryAfterSeconds ?? RATE_LIMIT_DEFAULT_WAIT_SECONDS)
        : null;
    if (
      seconds === null ||
      attempt >= RATE_LIMIT_RETRIES ||
      seconds > RATE_LIMIT_WAIT_CAP_SECONDS
    ) {
      return err(issueStepError(error, writer.place));
    }
    const wait = Math.max(0, seconds);
    writer.onWait(
      `GitHub asked for a pause, so the migration waits ${wait} seconds and asks again (${attempt + 1} of ${RATE_LIMIT_RETRIES}).`,
    );
    await pause(writer, wait * 1000);
    if (options.recover !== undefined) {
      const recovered = await options.recover();
      if (!recovered.ok) return recovered;
      if (recovered.value !== null) return ok(recovered.value);
    }
  }
}

/** A title GitHub accepts: one line, not empty, at most `ISSUE_TITLE_MAX` characters. */
export function issueTitle(issue: MigrationIssuePlan): string {
  const oneLine = issue.title.replace(/\s+/g, ' ').trim();
  const fallback = issue.key.split('/').pop() ?? issue.key;
  const title = oneLine === '' ? fallback.replace(/\.md$/, '') || issue.key : oneLine;
  if (title.length <= ISSUE_TITLE_MAX) return title;
  // Counted in UTF-16 units, as the port's check counts; cut on a whole character.
  let cut = '';
  for (const character of Array.from(title)) {
    if (cut.length + character.length > ISSUE_TITLE_MAX - 1) break;
    cut += character;
  }
  return `${cut}…`;
}

/** The address on GitHub of a Space-relative file or folder of the repository at `repositoryUrl`, on its default branch. */
export function archiveAddress(repositoryUrl: string, archived: string): string {
  const path = archived.split('/').map(encodeURIComponent).join('/');
  const kind = isFilePath(archived) ? 'blob' : 'tree';
  return `${repositoryUrl.replace(/\/+$/, '')}/${kind}/HEAD/${path}`;
}

/** Whether a path names a file: its last part has an extension. The archive's folders have none. */
function isFilePath(path: string): boolean {
  return /\.[A-Za-z0-9]+$/.test(path.split('/').pop() ?? '');
}

const FIRST_LINES: Record<MigrationIssueKind, string> = {
  focus: 'The focus that was in progress in AI-Lore v0.8, carried over by the migration.',
  stage: 'A stage of that focus in AI-Lore v0.8, carried over by the migration.',
  'paused-focus': 'A focus that was paused in AI-Lore v0.8, carried over by the migration.',
  backlog: 'A backlog item of AI-Lore v0.8, carried over by the migration.',
};

/** The body of a migrated issue: what it was, the link to its archived copy, and its marker as a whole line. */
export function issueBody(issue: MigrationIssuePlan, repositoryUrl: string): string {
  const address = archiveAddress(repositoryUrl, issue.archived);
  const words = isFilePath(issue.archived) ? 'Archived file' : 'Archived folder';
  const text = issue.text?.trim() ?? '';
  return [
    FIRST_LINES[issue.kind],
    '',
    ...(text === '' ? [] : [cutText(text), '']),
    `${words}: [${issue.archived}](${address})`,
    '',
    issue.marker,
    '',
  ].join('\n');
}

/** The most of an item's text an issue body carries; GitHub refuses a body over 65,536 characters. */
export const ISSUE_TEXT_MAX = 60_000;

/** An item's text, cut on a whole character to at most `ISSUE_TEXT_MAX`, with a line saying so. */
function cutText(text: string): string {
  if (text.length <= ISSUE_TEXT_MAX) return text;
  let cut = '';
  for (const character of Array.from(text)) {
    if (cut.length + character.length > ISSUE_TEXT_MAX) break;
    cut += character;
  }
  return `${cut}\n\n(Cut here; the whole text is in the archived file.)`;
}
