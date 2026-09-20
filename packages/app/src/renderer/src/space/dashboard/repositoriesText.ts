import type {
  RemoteUnknownReason,
  RepositoryRow,
  RepositoryRowChanges,
  RootGitOperation,
  RootHeadState,
  RootRemoteComparison,
} from '@ai-lore-companion/core';
import { formatAge, formatTime } from './dashboardText.js';

/**
 * The sentences of the Repositories section (stage D1, phase D1.4), as pure
 * functions so that the component test and the component say the same thing.
 * Section 6.3 of `dashboard-repositories-architecture.md` gives the exact
 * text; nothing here paraphrases it. This file imports types only from core,
 * never a value, as the renderer rule requires.
 */

/** Before the first answer, for the whole section. */
export function readingSectionText(): string {
  return "Reading the Space's repositories.";
}

/** When the model has no row at all. */
export function noRepositoryText(): string {
  return 'This Space has no repository.';
}

/** A row whose repository read or first change read has not answered. */
export function readingRowText(): string {
  return 'Reading this repository.';
}

/** The branch line. */
export function branchText(head: RootHeadState): string {
  if (head.kind === 'branch') return `On the branch ${head.branch}.`;
  if (head.kind === 'unborn-branch') {
    return `On the branch ${head.branch}, which has no commit yet.`;
  }
  return `Not on a branch. The checked-out commit is ${head.commit.slice(0, 7)}.`;
}

/** The operation line, shown only when `RepositoryRow.operation` is not `null`. */
export function operationText(operation: RootGitOperation, head: RootHeadState | null): string {
  if (operation === 'merge') return 'A merge is in progress.';
  if (operation === 'rebase') {
    const rebasing = head !== null && head.kind === 'detached' ? head.rebasing : null;
    return rebasing === null
      ? 'A rebase is in progress.'
      : `A rebase of ${rebasing} is in progress.`;
  }
  if (operation === 'cherry-pick') return 'A cherry-pick is in progress.';
  if (operation === 'revert') return 'A revert is in progress.';
  return 'A bisect is in progress.';
}

/** The uncommitted line. */
export function uncommittedText(changes: RepositoryRowChanges): string {
  const n = changes.uncommitted;
  if (changes.truncated) return `At least ${n} uncommitted changes.`;
  if (n === 0) return 'No uncommitted change.';
  return n === 1 ? '1 uncommitted change.' : `${n} uncommitted changes.`;
}

/** The remote line when ahead and behind are known. */
export function remoteKnownText(remote: RootRemoteComparison): string {
  const ahead = remote.ahead ?? 0;
  const behind = remote.behind ?? 0;
  const upstream = remote.upstream ?? '';
  if (ahead === 0 && behind === 0) return `Level with ${upstream}.`;
  const aheadPart = `${ahead} ${ahead === 1 ? 'commit' : 'commits'} ahead of`;
  const behindPart = `${behind} ${behind === 1 ? 'commit' : 'commits'} behind`;
  if (ahead > 0 && behind === 0) return `${aheadPart} ${upstream}.`;
  if (behind > 0 && ahead === 0) return `${behindPart} ${upstream}.`;
  return `${aheadPart} and ${behindPart} ${upstream}.`;
}

/** The age of the remote knowledge, following the remote line in the same line. */
export function remoteAgeText(lastFetchAt: string | null, now: number): string {
  if (lastFetchAt === null) {
    return 'Read from what this repository already knows; there is no record of a fetch in it.';
  }
  const at = Date.parse(lastFetchAt);
  const age = Number.isNaN(at) ? lastFetchAt : formatAge(Math.max(0, now - at));
  return `Read from what this repository already knows; it last fetched ${age} ago.`;
}

/** The remote line when ahead and behind are not known. */
export function remoteUnknownText(
  reason: RemoteUnknownReason,
  message: string,
  head: RootHeadState | null,
  upstream: string | null,
): string {
  if (reason === 'no-remote') {
    return 'Ahead and behind are not known: this repository has no remote.';
  }
  if (reason === 'no-upstream') {
    const branch = head !== null && head.kind === 'branch' ? head.branch : '';
    return `Ahead and behind are not known: the branch ${branch} has no tracking branch.`;
  }
  if (reason === 'upstream-missing') {
    return `Ahead and behind are not known: the tracking branch ${upstream ?? ''} is not in this repository. It has not been fetched, or it was deleted on the remote.`;
  }
  if (reason === 'detached-head') {
    return 'Ahead and behind are not known: this repository is not on a branch.';
  }
  if (reason === 'unborn-branch') {
    const branch = head !== null && head.kind === 'unborn-branch' ? head.branch : '';
    return `Ahead and behind are not known: the branch ${branch} has no commit yet.`;
  }
  return `Ahead and behind are not known: ${message}.`;
}

/** The whole remote line: known ahead/behind followed by their age, or the not-known sentence. */
export function remoteText(
  head: RootHeadState | null,
  remote: RootRemoteComparison,
  now: number,
): string {
  if (remote.unknown === null) {
    return `${remoteKnownText(remote)} ${remoteAgeText(remote.lastFetchAt, now)}`;
  }
  return remoteUnknownText(remote.unknown.reason, remote.unknown.message, head, remote.upstream);
}

/**
 * The changes line. `null` when `changes` is `null` and `status` is not
 * `'ready'`, which happens while a row is still reading: there is nothing to
 * say about the changes yet, and the row's own "Reading this repository."
 * line already covers it.
 */
export function changesText(
  changes: RepositoryRowChanges | null,
  status: RepositoryRow['status'],
): string | null {
  if (changes === null) {
    return status === 'ready' ? 'The changes of this repository could not be read.' : null;
  }
  const n = changes.total;
  let sentence: string;
  if (changes.baselineSource === 'reviewed-mark') {
    const time = formatTime(changes.baselineAt ?? '');
    sentence =
      n === 0
        ? `No file has changed since the reviewed mark of ${time}.`
        : n === 1
          ? `${n} file changed since the reviewed mark of ${time}.`
          : `${n} files have changed since the reviewed mark of ${time}.`;
  } else if (changes.baselineSource === 'first-seen') {
    const time = formatTime(changes.baselineAt ?? '');
    const base =
      n === 0
        ? `No file has changed since the companion first saw this repository, on ${time}.`
        : n === 1
          ? `${n} file changed since the companion first saw this repository, on ${time}.`
          : `${n} files have changed since the companion first saw this repository, on ${time}.`;
    sentence = `${base} This repository has no reviewed mark.`;
  } else if (changes.baselineSource === 'head') {
    sentence =
      'This repository has no reviewed mark and no first-seen record, so only what is not committed is counted.';
  } else {
    sentence = `${n} files have changed since the commit picked in the Files window, ${changes.baseline.slice(0, 7)}.`;
  }
  if (changes.truncated) sentence += ' The list was cut, so the count is a lower bound.';
  if (changes.baselineIsAncestor === false) {
    sentence += ' The baseline commit is not on the current branch.';
  }
  return sentence;
}

/** An untracked row's own line: `resolveRoots`'s message, unchanged. */
export function untrackedRowText(notKnown: string): string {
  return notKnown;
}

/** A failed row's line. */
export function failedRowText(message: string): string {
  return `This repository could not be read: ${message}`;
}

/** The ` — <owner>/<name>` that follows a row's name when it names a GitHub repository. */
export function githubSuffix(github: string | null): string {
  return github === null ? '' : ` — ${github}`;
}
