/**
 * The checks both implementations of `GitHubPort` make on a value before they
 * use it: a repository's `owner/name`, a branch name, the title and body of an
 * issue, and a value that travels on a command line.
 *
 * The gh adapter and `FakeGitHub` share them, so that a value one refuses the
 * other refuses too, with the same sentence.
 */

import { err, ok } from '../result.js';
import { type GitHubError, failed } from './errors.js';
import { isIssueMarker } from './marker.js';
import type { GitHubResult } from './port.js';

/**
 * The most characters GitHub accepts in the body of an issue or a comment.
 * Source: GitHub's own refusal, "Body is too long (maximum is 65536
 * characters)". Counted here in UTF-16 units, which is never less than
 * GitHub's count, so a body this check accepts is not refused for its length.
 */
export const ISSUE_BODY_MAX = 65_536;

/** The most characters GitHub accepts in the title of an issue ("Title is too long (maximum is 256 characters)"). */
export const ISSUE_TITLE_MAX = 256;

const OWNER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REPOSITORY_NAME = /^[A-Za-z0-9._-]+$/;
/** The NUL character, written by its code so that this file holds none. */
const NUL = String.fromCharCode(0);

/** Whether `owner` and `name` can be the two parts of a repository's name. `.` and `..` are not names. */
export function isRepositoryName(owner: string, name: string): boolean {
  return OWNER.test(owner) && REPOSITORY_NAME.test(name) && name !== '.' && name !== '..';
}

/** The two parts of `owner/name`, or `failed` when the text is not one. Nothing is asked of GitHub. */
export function splitRepositoryName(
  fullName: string,
): GitHubResult<{ owner: string; name: string }> {
  const slash = fullName.indexOf('/');
  const owner = fullName.slice(0, slash);
  const name = fullName.slice(slash + 1);
  if (slash < 1 || !isRepositoryName(owner, name)) {
    return err(failed(`${JSON.stringify(fullName)} is not a repository's owner/name`));
  }
  return ok({ owner, name });
}

/**
 * Whether git accepts `name` as a branch name: the rules of
 * `git check-ref-format --branch`, without starting git. A name may not be
 * empty or `@`, begin with `-`, begin or end with `/`, end with `.`, hold `..`,
 * `//`, `@{`, a space, a control character or one of `~ ^ : ? * [ \`, and none
 * of its parts may begin with `.` or end with `.lock`.
 */
export function isBranchName(name: string): boolean {
  if (name === '' || name === '@' || name.startsWith('-')) return false;
  if (name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) return false;
  if (name.includes('..') || name.includes('//') || name.includes('@{')) return false;
  for (const char of name) {
    const code = char.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f || '~^:?*[\\'.includes(char)) return false;
  }
  return name.split('/').every((part) => !part.startsWith('.') && !part.endsWith('.lock'));
}

/**
 * The error for an issue's title or a body GitHub would refuse, or `null`. It
 * is made before GitHub is asked, so that an issue is never half-written: a
 * body over the limit is refused whole, never cut.
 */
export function issueTextError(text: { title?: string; body?: string }): GitHubError | null {
  const { title, body } = text;
  if (title !== undefined) {
    if (title.trim() === '') return failed('The title of an issue cannot be empty');
    if (title.length > ISSUE_TITLE_MAX) {
      return failed(
        `The title has ${title.length} characters, and GitHub accepts at most ${ISSUE_TITLE_MAX}`,
      );
    }
    if (title.includes(NUL)) return failed('The title holds a NUL character, which GitHub refuses');
  }
  if (body !== undefined) {
    if (body.length > ISSUE_BODY_MAX) {
      return failed(
        `The body has ${body.length} characters, and GitHub accepts at most ${ISSUE_BODY_MAX}`,
      );
    }
    if (body.includes(NUL)) return failed('The body holds a NUL character, which GitHub refuses');
  }
  return null;
}

/**
 * The error for a label that cannot be created, or `null`: a colour that is
 * not six hexadecimal digits (a leading `#` is accepted), an empty name, or a
 * NUL character in the name or the description, which travel on gh's command line.
 */
export function labelError(label: {
  name: string;
  color: string;
  description: string;
}): GitHubError | null {
  if (label.name.trim() === '') return failed('The name of a label cannot be empty');
  if (!/^#?[0-9A-Fa-f]{6}$/.test(label.color)) {
    return failed(`The colour of the label ${label.name} is not six hexadecimal digits`);
  }
  return (
    argumentError('The name of a label', label.name) ??
    argumentError(`The description of the label ${label.name}`, label.description)
  );
}

/**
 * The error for the first of `markers` that `formatIssueMarker` could not have
 * made, or `null`. A caller that searched for other text could match an issue
 * that only mentions it, and would then not create the issue it needs.
 */
export function markersError(markers: readonly string[]): GitHubError | null {
  const malformed = markers.find((marker) => !isIssueMarker(marker));
  return malformed === undefined
    ? null
    : failed(
        `${JSON.stringify(malformed)} is not an issue marker. A marker is made by formatIssueMarker`,
      );
}

/**
 * The error for a value that cannot be one argument of a command, or `null`.
 * An argument cannot hold a NUL character; the operating system would refuse
 * to start the command. `what` names the value in the sentence.
 */
export function argumentError(what: string, value: string): GitHubError | null {
  return value.includes(NUL)
    ? failed(`${what} holds a NUL character and cannot be given to gh`)
    : null;
}
