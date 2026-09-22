/**
 * The Agents board on GitHub for the sessions of one Space (phase M4.7).
 *
 * The broker calls `entered` after the claim and the mode are on the desk, and
 * `left` after a session left Writing; the sessions service calls `closed`
 * when a session ended. Each uses core's `project/session-issue.ts`: the
 * session's issue is created the first time the session enters Writing (found
 * by its marker first), moved between the columns, and at close given the
 * handover of the session's journal entry and moved to Done.
 *
 * The board never decides a claim. Each call answers a `BoardNote`: the issue
 * that was updated, or one sentence that says the board was not updated and
 * why. A failure is logged and told; it is not retried and nothing is queued
 * (the focus's cut line). The updates of one Space run one after the other.
 */

import { readFile, readdir } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import {
  type Desk,
  type DeskFailure,
  type GitHubError,
  type GitHubPort,
  type IssueRef,
  type LocalFolder,
  type ProjectInfo,
  type Result,
  type JsonObject,
  type SessionIssueContent,
  type SessionIssuePlace,
  type SessionRecord,
  type SpaceManifest,
  type WriteTarget,
  closeSessionIssue,
  drainPendingWrites,
  formatEntryComment,
  listPendingWrites,
  queuePendingWrite,
  formatSessionBackLink,
  describeGitHubFailure,
  developItemBranch,
  findSpaceProject,
  getSession,
  issueRefFor,
  moveSessionIssue,
  putSessionIssue,
  updateSession,
} from '@ai-lore-companion/core';
import { type SpaceContext, defineSpaceService } from '../context.js';
import { spaceDesk } from '../desk-service.js';
import { spaceGitHub } from '../github-service.js';
import type { SpaceLog } from '../log.js';

/**
 * What the session reads about the Agents board in an answer.
 *
 * `queued` says how many writes are waiting to reach GitHub. A write that did
 * not land is no longer lost, but the session must not read a queued write as
 * a landed one, so the note still says the board was not updated and names the
 * number outstanding. That is what makes the queue visible: the session can
 * tell the Human Lead what has not arrived, which the Lore's `session-close`
 * requires it to do.
 */
export type BoardNote =
  | { updated: true; issue: string; queued?: number }
  | { updated: false; message: string; queued?: number };

export type SessionBoard = {
  /**
   * The session started, in Read only. Its issue is created now, not when it
   * first writes: the Project is writable in Read only, so a reading session
   * can restructure the whole plan and leave no trace of itself — and one did.
   */
  started(sessionId: string): Promise<BoardNote | null>;
  /**
   * The session did substantive work on these tickets. The issue's list is
   * updated, and a ticket named for the first time gets one back-link comment.
   * Tickets it already carries are ignored, so a caller may say the same one
   * twice without putting two comments on it.
   */
  touched(sessionId: string, tickets: readonly number[]): Promise<BoardNote | null>;
  /** The session entered Writing with `targets` (all it holds now), on `item` when it named one. */
  entered(
    sessionId: string,
    arg: { targets: readonly WriteTarget[]; item?: number },
  ): Promise<BoardNote>;
  /** The session left Writing. `null` when it has no issue. */
  left(sessionId: string): Promise<BoardNote | null>;
  /** The session ended. `null` when it has no issue. */
  closed(sessionId: string): Promise<BoardNote | null>;
};

export type SessionBoardOptions = {
  desk: () => Result<Desk, DeskFailure>;
  github: () => Promise<GitHubPort>;
  manifest: () => SpaceManifest;
  /** `workbench/journal/` of the Space. */
  journalDir: string;
  log: SpaceLog;
  machine?: string;
  /** Folders of this machine replaced in a handover before it goes to GitHub: the Space, the desk, the home folder. */
  local?: readonly LocalFolder[];
};

/** The one sentence the session reads when the board was not updated. */
export function boardFailed(reason: string): BoardNote {
  return {
    updated: false,
    message: `The Agents board on GitHub was not updated because ${reason}, and nothing will retry it.`,
  };
}

/**
 * `update`, or after `ms` a note that says the board was not updated in time.
 * The update itself goes on, and the board logs how it ends. Never rejects.
 */
export async function boardWithin<T extends BoardNote | null>(
  update: Promise<T>,
  ms: number,
): Promise<T | BoardNote> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<BoardNote>((resolve) => {
    timer = setTimeout(
      () =>
        resolve(
          boardFailed(`GitHub did not answer within ${Number((ms / 1000).toFixed(1))} seconds`),
        ),
      ms,
    );
  });
  try {
    return await Promise.race([
      update.catch((caught: unknown) =>
        boardFailed(caught instanceof Error ? caught.message : String(caught)),
      ),
      late,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

class BoardError extends Error {}

export function createSessionBoard(options: SessionBoardOptions): SessionBoard {
  const { log } = options;
  const machine = options.machine ?? hostname();
  let chain: Promise<unknown> = Promise.resolve();
  let project: ProjectInfo | null = null;
  let person: string | null = null;

  /** Run the updates of the Space one after the other. */
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work);
    chain = next.catch(() => undefined);
    return next;
  };

  const gitHubFailed = (error: GitHubError): never => {
    throw new BoardError(describeGitHubFailure(error));
  };

  /**
   * GitHub did not take a write: queue the intent, then fail as before.
   *
   * The session is still told, because it must not read a queued write as a
   * landed one — but the write is no longer gone. Until this, every board
   * write was attempted once and lost on failure: on 2026-09-22 a grant
   * answered "gh was not found on this machine, and nothing will retry it",
   * and several sessions of this Space lost their handovers that way.
   *
   * Queuing must never be what breaks a session, so a desk that cannot be
   * written is logged and the original GitHub failure is the one reported.
   */
  const queueThenFail = (
    sessionId: string,
    write: Parameters<typeof queuePendingWrite>[1],
    error: GitHubError,
  ): never => {
    let waiting = 0;
    try {
      const desk = openDesk();
      const queued = queuePendingWrite(desk, write);
      if (!queued.ok) {
        log.warn('board-write-not-queued', { session: sessionId, kind: queued.error.kind });
      } else {
        log.info('board-write-queued', { session: sessionId, id: write.id });
      }
      const pending = listPendingWrites(desk);
      if (pending.ok) waiting = pending.value.length;
    } catch (caught) {
      log.warn('board-write-not-queued', {
        session: sessionId,
        reason: caught instanceof Error ? caught.message : String(caught),
      });
    }
    throw new BoardError(
      waiting === 0
        ? describeGitHubFailure(error)
        : `${describeGitHubFailure(error)}. It is queued and will be sent again; ${waiting === 1 ? '1 write is' : `${waiting} writes are`} waiting.`,
    );
  };

  /**
   * Replay what is queued, before doing something new.
   *
   * Every board operation is a moment GitHub is known to be reachable, which
   * makes it the natural moment to try again — so a handover queued while the
   * network was down arrives when the next session starts, with nothing to
   * schedule and no daemon to keep alive.
   */
  const drain = async (): Promise<void> => {
    try {
      const desk = openDesk();
      const pending = listPendingWrites(desk);
      if (!pending.ok || pending.value.length === 0) return;
      const report = await drainPendingWrites(await place(), desk);
      if (report.ok) {
        log.info('board-queue-drained', {
          landed: report.value.landed,
          waiting: report.value.waiting,
        });
      }
    } catch (caught) {
      // A drain is best effort: what it could not send is still queued.
      log.info('board-queue-drain-failed', {
        reason: caught instanceof Error ? caught.message : String(caught),
      });
    }
  };

  const openDesk = (): Desk => {
    const desk = options.desk();
    if (!desk.ok)
      throw new BoardError(`the desk's records could not be read (${desk.error.message})`);
    return desk.value;
  };

  const place = async (): Promise<SessionIssuePlace> => {
    const manifest = options.manifest();
    const repository = manifest.github.repository;
    if (repository === '')
      throw new BoardError('the Space has no GitHub repository in its manifest');
    const github = await options.github();
    if (project === null) {
      const found = await findSpaceProject(github, {
        repository,
        name: manifest.name,
        project: manifest.github.project,
      });
      if (!found.ok) gitHubFailed(found.error);
      else project = found.value;
    }
    return { github, repository, project: project as ProjectInfo };
  };

  const account = async (github: GitHubPort): Promise<string> => {
    if (person === null) {
      const auth = await github.auth();
      person = auth.ok ? auth.value.account : '';
    }
    return person;
  };

  /** Log how an update ended and turn it into a note. */
  const run = async (
    event: string,
    sessionId: string,
    work: () => Promise<IssueRef | null>,
  ): Promise<BoardNote | null> => {
    try {
      const issue = await work();
      if (issue === null) return null;
      log.info(event, { session: sessionId, issue: issue.number });
      return { updated: true, issue: issue.url };
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : String(caught);
      log.warn(`${event}-failed`, { session: sessionId, reason });
      return boardFailed(reason);
    }
  };

  const issueOf = (desk: Desk, sessionId: string): IssueRef | undefined => {
    const record = getSession(desk, sessionId);
    if (!record.ok)
      throw new BoardError(`the desk's records could not be read (${record.error.message})`);
    return record.value?.issue;
  };

  /**
   * The issue's content from the desk's record. The three callers that write
   * the issue all go through this, so a body written at start cannot lose the
   * tickets a body written on entering Writing had put there.
   */
  const contentOf = async (
    record: SessionRecord,
    where: SessionIssuePlace,
    extra: { targets?: readonly WriteTarget[]; item?: IssueRef },
  ): Promise<SessionIssueContent> => {
    const item = extra.item ?? record.item;
    return {
      sessionId: record.id,
      engine: record.engine,
      startedAt: record.startedAt,
      targets: extra.targets ?? [],
      ...(item !== undefined ? { item } : {}),
      ...(record.tickets !== undefined ? { tickets: record.tickets } : {}),
      attended: true,
      person: await account(where.github),
      machine,
      ...(record.profile !== undefined ? { profile: record.profile } : {}),
    };
  };

  const started: SessionBoard['started'] = (sessionId) =>
    serial(() =>
      run('board-session-started', sessionId, async () => {
        await drain();
        const desk = openDesk();
        const record = getSession(desk, sessionId);
        if (!record.ok) throw new BoardError(record.error.message);
        if (record.value === null) throw new BoardError('the desk has no record of the session');
        const where = await place();
        const content = await contentOf(record.value, where, {});
        const put = await putSessionIssue(where, content, 'Read only', record.value.issue);
        if (!put.ok) {
          return queueThenFail(
            sessionId,
            { id: `session-issue:${sessionId}`, sessionId, kind: 'session-issue', column: 'Read only', content: content as unknown as JsonObject },
            put.error,
          );
        }
        const recorded = updateSession(desk, sessionId, { issue: put.value.issue });
        if (!recorded.ok) {
          log.warn('board-issue-not-recorded', { session: sessionId, kind: recorded.error.kind });
        }
        return put.value.issue;
      }),
    );

  const touched: SessionBoard['touched'] = (sessionId, tickets) =>
    serial(() =>
      run('board-session-touched', sessionId, async () => {
        const desk = openDesk();
        const record = getSession(desk, sessionId);
        if (!record.ok) throw new BoardError(record.error.message);
        if (record.value === null) return null;
        const where = await place();
        const had = record.value.tickets ?? [];
        const known = new Set(had.map((ticket) => ticket.number));
        const fresh = [...new Set(tickets)]
          .filter((number) => !known.has(number))
          .map((number) => issueRefFor(where.repository, number));
        if (fresh.length === 0) return record.value.issue ?? null;
        const all = [...had, ...fresh];
        const recorded = updateSession(desk, sessionId, { tickets: all });
        if (!recorded.ok) {
          log.warn('board-tickets-not-recorded', { session: sessionId, kind: recorded.error.kind });
        }
        const issue = record.value.issue;
        if (issue === undefined) return null;
        const put = await putSessionIssue(
          where,
          await contentOf({ ...record.value, tickets: all }, where, {}),
          record.value.mode === 'writing' ? 'Writing' : 'Read only',
          issue,
        );
        if (!put.ok) return gitHubFailed(put.error);
        // The back-link, once per ticket. A comment per edit would have put
        // fifty comments on this Space's tickets in one afternoon.
        for (const ticket of fresh) {
          const commented = await where.github.comment({
            issue: ticket,
            body: formatSessionBackLink({
              issue,
              engine: record.value.engine,
              startedAt: record.value.startedAt,
            }),
          });
          if (!commented.ok) return gitHubFailed(commented.error);
        }
        return issue;
      }),
    );

  const entered: SessionBoard['entered'] = (sessionId, arg) =>
    serial(async () => {
      const note = await run('board-session-writing', sessionId, async () => {
        const desk = openDesk();
        const record = getSession(desk, sessionId);
        if (!record.ok) throw new BoardError(record.error.message);
        const where = await place();
        const item =
          arg.item !== undefined ? issueRefFor(where.repository, arg.item) : record.value?.item;
        if (record.value === null) throw new BoardError('the desk has no record of the session');
        const put = await putSessionIssue(
          where,
          await contentOf(record.value, where, {
            targets: arg.targets,
            ...(item !== undefined ? { item } : {}),
          }),
          'Writing',
          record.value?.issue,
        );
        if (!put.ok) return gitHubFailed(put.error);
        const recorded = updateSession(desk, sessionId, {
          issue: put.value.issue,
          ...(item !== undefined ? { item } : {}),
        });
        if (!recorded.ok) {
          log.warn('board-issue-not-recorded', { session: sessionId, kind: recorded.error.kind });
        }
        // The item branch of each repository, before the answer is released.
        if (item !== undefined) {
          for (const target of arg.targets) {
            if (target.kind !== 'repository') continue;
            const repository = options
              .manifest()
              .repositories.find((entry) => entry.name === target.name);
            if (repository === undefined) continue;
            const branch = await developItemBranch(where.github, {
              item,
              branchRepository: repository.github,
              name: target.branch,
            });
            if (!branch.ok) {
              throw new BoardError(
                `the branch "${target.branch}" was not linked to the item: ${describeGitHubFailure(branch.error)}`,
              );
            }
          }
        }
        return put.value.issue;
      });
      return note ?? boardFailed('nothing was updated');
    });

  const left: SessionBoard['left'] = (sessionId) =>
    serial(() =>
      run('board-session-read-only', sessionId, async () => {
        const issue = issueOf(openDesk(), sessionId);
        if (issue === undefined) return null;
        const moved = await moveSessionIssue(await place(), issue, 'Read only');
        if (!moved.ok) gitHubFailed(moved.error);
        return issue;
      }),
    );

  /**
   * The session's whole journal entry: the file whose name ends with the
   * session's id. The whole file, not its `## Handover` section — what the
   * session learned and what it corrected are the parts a later session most
   * needs, and they used never to leave the desk.
   */
  const entryOf = async (sessionId: string): Promise<string | null> => {
    let names: string[];
    try {
      names = await readdir(options.journalDir);
    } catch {
      return null;
    }
    const name = names
      .filter((entry) => entry.endsWith(`-${sessionId}.md`))
      .sort()
      .at(-1);
    if (name === undefined) return null;
    try {
      return await readFile(join(options.journalDir, name), 'utf8');
    } catch {
      return null;
    }
  };

  const closed: SessionBoard['closed'] = (sessionId) =>
    serial(() =>
      run('board-session-done', sessionId, async () => {
        const issue = issueOf(openDesk(), sessionId);
        if (issue === undefined) return null;
        const entry = await entryOf(sessionId);
        if (entry === null) log.info('board-no-journal-entry', { session: sessionId });
        const done = await closeSessionIssue(await place(), issue, entry, options.local ?? []);
        if (!done.ok) {
          // The close is the write this contract exists for: a session that
          // ends with GitHub unreachable must not lose its entry.
          if (entry !== null && entry.trim() !== '') {
            queuePendingWrite(openDesk(), {
              id: `entry:${sessionId}`,
              sessionId,
              kind: 'comment',
              issue,
              body: formatEntryComment(entry, options.local ?? []),
            });
          }
          return queueThenFail(
            sessionId,
            { id: `done:${sessionId}`, sessionId, kind: 'move', issue, column: 'Done' },
            done.error,
          );
        }
        return issue;
      }),
    );

  return { started, entered, touched, left, closed };
}

/** The Agents board of a Space. `context.service(sessionBoard)` builds it on first use. */
export const sessionBoard = defineSpaceService<SessionBoard>({
  id: 'session-board',
  create: (context: SpaceContext) => {
    const desk = context.service(spaceDesk);
    const github = context.service(spaceGitHub);
    return createSessionBoard({
      desk: () => desk.open(),
      github: () => github.port(),
      manifest: () => context.manifest,
      journalDir: context.paths.journal,
      log: context.log,
      local: [
        { path: context.root, as: '<Space>' },
        { path: context.desk.dir, as: '<desk>' },
        { path: homedir(), as: '~' },
      ],
    });
  },
});
