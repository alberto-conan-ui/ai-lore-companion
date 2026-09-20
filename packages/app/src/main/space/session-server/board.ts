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
  type SessionIssuePlace,
  type SpaceManifest,
  type WriteTarget,
  closeSessionIssue,
  describeGitHubFailure,
  developItemBranch,
  findSpaceProject,
  getSession,
  issueRefFor,
  moveSessionIssue,
  putSessionIssue,
  readHandover,
  updateSession,
} from '@ai-lore-companion/core';
import { type SpaceContext, defineSpaceService } from '../context.js';
import { spaceDesk } from '../desk-service.js';
import { spaceGitHub } from '../github-service.js';
import type { SpaceLog } from '../log.js';

/** What the session reads about the Agents board in an answer. */
export type BoardNote = { updated: true; issue: string } | { updated: false; message: string };

export type SessionBoard = {
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
          {
            sessionId,
            engine: record.value.engine,
            startedAt: record.value.startedAt,
            targets: arg.targets,
            ...(item !== undefined ? { item } : {}),
            attended: true,
            person: await account(where.github),
            machine,
            ...(record.value.profile !== undefined ? { profile: record.value.profile } : {}),
          },
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

  /** The handover of the session's journal entry: the file whose name ends with the session's id. */
  const handoverOf = async (sessionId: string): Promise<string | null> => {
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
      return readHandover(await readFile(join(options.journalDir, name), 'utf8'));
    } catch {
      return null;
    }
  };

  const closed: SessionBoard['closed'] = (sessionId) =>
    serial(() =>
      run('board-session-done', sessionId, async () => {
        const issue = issueOf(openDesk(), sessionId);
        if (issue === undefined) return null;
        const handover = await handoverOf(sessionId);
        if (handover === null) log.info('board-no-handover', { session: sessionId });
        const done = await closeSessionIssue(await place(), issue, handover, options.local ?? []);
        if (!done.ok) gitHubFailed(done.error);
        return issue;
      }),
    );

  return { entered, left, closed };
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
