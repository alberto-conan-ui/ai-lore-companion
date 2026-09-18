/**
 * The rules for the names setup takes from a form, checked before anything is
 * created: the Space's name, the owner, the repositories, the description and
 * a GitHub address. Nothing here reads the disk or asks GitHub.
 *
 * A Space's name is at once a folder's name, a GitHub repository's name, a
 * Project's title and a file name in the corpus, so the rule is what all four
 * accept. It is narrower than GitHub's own rule, which also takes a name that
 * begins with a hyphen or a full stop.
 */

import { isAbsolute } from 'node:path';
import { isRepositoryName } from '../github/validate.js';
import type { CreateSpaceInput, SetupInputProblem, SetupRepositoryInput } from './types.js';

/** The most characters GitHub accepts in a repository's name. */
export const SPACE_NAME_MAX = 100;

/** The most characters GitHub accepts in the login of a user or an organisation. */
export const OWNER_NAME_MAX = 39;

/** The most characters of a Space's description. */
export const SPACE_DESCRIPTION_MAX = 2000;

/** Payload names that are taken in every Space: the default publish area and the children of `lore/mirrors/`. */
export const RESERVED_PAYLOAD_NAMES: readonly string[] = ['publish', 'index', 'generators'];

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

/** Why `name` cannot be the name of a folder and of a GitHub repository, or `null` when it can. */
function nameProblem(what: string, name: string): string | null {
  if (name === '') return `${what} is empty.`;
  if (name.length > SPACE_NAME_MAX) {
    return `${what} has ${name.length} characters, and GitHub accepts at most ${SPACE_NAME_MAX}.`;
  }
  if (!NAME.test(name)) {
    return `${what} may hold only letters without accents, digits, full stops, hyphens and underscores, and begins with a letter or a digit.`;
  }
  if (name.endsWith('.')) return `${what} may not end with a full stop.`;
  if (name.toLowerCase().endsWith('.git')) {
    return `${what} may not end with ".git", which GitHub removes from a repository's name.`;
  }
  if (WINDOWS_DEVICE.test(name)) {
    return `${what} is a device name on Windows, so a folder cannot have it on every machine.`;
  }
  return null;
}

/** Why `name` cannot be a Space's name, as a sentence, or `null` when it can. */
export function spaceNameProblem(name: string): string | null {
  const problem = nameProblem('The name of the Space', name);
  if (problem !== null) return problem;
  if (name.toLowerCase() === 'index') {
    return 'The name of the Space may not be "index", because its corpus entry would take the name of the corpus index.';
  }
  return null;
}

/** Why `owner` cannot be a GitHub user or organisation, as a sentence, or `null` when it can. */
export function ownerProblem(owner: string): string | null {
  if (owner === '') return 'The owner is empty.';
  if (owner.length > OWNER_NAME_MAX) {
    return `The owner has ${owner.length} characters, and a GitHub login has at most ${OWNER_NAME_MAX}.`;
  }
  if (!OWNER.test(owner) || owner.includes('--')) {
    return 'The owner is a GitHub login: letters without accents, digits and single hyphens, not at the start or the end.';
  }
  return null;
}

/** Why `name` cannot be a repository's name in a Space, as a sentence, or `null` when it can. */
export function repositoryNameProblem(name: string): string | null {
  const problem = nameProblem("The repository's name", name);
  if (problem !== null) return problem;
  if (RESERVED_PAYLOAD_NAMES.includes(name.toLowerCase())) {
    return `The repository's name may not be "${name}", because lore/mirrors/ already has a child of that name.`;
  }
  return null;
}

/** The repository a GitHub address names. */
export type GitHubAddress = { owner: string; name: string; fullName: string };

/**
 * Read `owner/name` from an address: `owner/name` itself, an
 * `https://github.com/owner/name` address, or `git@github.com:owner/name.git`.
 * Returns `null` for anything else. Nothing is asked of GitHub.
 */
export function parseGitHubAddress(text: string): GitHubAddress | null {
  let rest = text.trim();
  const https = /^https?:\/\/(?:www\.)?github\.com\//i.exec(rest);
  const ssh = /^(?:ssh:\/\/)?git@github\.com[:/]/i.exec(rest);
  if (https !== null) rest = rest.slice(https[0].length);
  else if (ssh !== null) rest = rest.slice(ssh[0].length);
  rest = rest.replace(/\/+$/, '').replace(/\.git$/i, '');
  const parts = rest.split('/');
  const [owner, name] = parts;
  if (parts.length !== 2 || owner === undefined || name === undefined) return null;
  if (ownerProblem(owner) !== null || !isRepositoryName(owner, name)) return null;
  if (name.length > SPACE_NAME_MAX) return null;
  return { owner, name, fullName: `${owner}/${name}` };
}

/**
 * `text` with the user name and the password of any address in it replaced, so
 * that a token pasted with an address is never shown or logged.
 */
export function redactCredentials(text: string): string {
  return text.replace(/([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/\s]*@/g, '$1***@');
}

/**
 * Why `address` cannot be cloned from, as a sentence, or `null` when it can.
 * Accepted: an `https://` address without a user name or a password, an
 * `ssh://` address or `user@host:path` without a password, and an absolute
 * path, which is what `FakeGitHub` gives. Refused: an address git would read
 * as an option, a remote helper (`ext::…`, any `name::`), `file://`, `git://`
 * and `http://`. The sentence never repeats the address, which may hold a token.
 */
export function cloneAddressProblem(address: string): string | null {
  if (address === '' || address.startsWith('-')) {
    return 'The clone address is empty or begins with a hyphen.';
  }
  for (const char of address) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) {
      return 'The clone address holds a space or a control character.';
    }
  }
  if (/^[A-Za-z0-9+.-]+::/.test(address)) {
    return 'The clone address names a remote helper of git, which can run a program, so it is refused.';
  }
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/]*)/.exec(address);
  if (scheme !== null) {
    const protocol = (scheme[1] ?? '').toLowerCase();
    const authority = scheme[2] ?? '';
    if (protocol !== 'https' && protocol !== 'ssh') {
      return `The clone address uses ${protocol}://, and only https:// and ssh:// addresses are cloned.`;
    }
    const userInfo = authority.includes('@') ? authority.slice(0, authority.lastIndexOf('@')) : '';
    if (userInfo !== '' && (protocol === 'https' || userInfo.includes(':'))) {
      return 'The clone address holds a user name or a password. Remove it: git asks the credential helper of the machine.';
    }
    return null;
  }
  if (isAbsolute(address)) return null;
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^:]/.test(address)) return null;
  return 'The clone address is not an https:// or ssh:// address, user@host:path, or an absolute path.';
}

/** The problems of a description. Line breaks and tabs are accepted; other control characters are not. */
function descriptionProblem(description: string): string | null {
  if (description.length > SPACE_DESCRIPTION_MAX) {
    return `The description has ${description.length} characters, and at most ${SPACE_DESCRIPTION_MAX} are kept.`;
  }
  for (const char of description) {
    const code = char.codePointAt(0) ?? 0;
    if ((code < 0x20 && char !== '\n' && char !== '\r' && char !== '\t') || code === 0x7f) {
      return 'The description holds a control character.';
    }
  }
  return null;
}

/** The problems of a folder the form names: it must be an absolute path. Whether it exists is asked later. */
export function folderProblem(what: string, dir: string): string | null {
  if (dir === '') return `${what} is empty.`;
  if (!isAbsolute(dir)) return `${what} must be an absolute path.`;
  if (dir.includes('\0')) return `${what} holds a character a path cannot have.`;
  return null;
}

/** The problems of the list of repositories: each name and address, and no name twice. */
export function repositoryProblems(
  repositories: readonly SetupRepositoryInput[],
): SetupInputProblem[] {
  const problems: SetupInputProblem[] = [];
  const seen = new Set<string>();
  for (const [index, repository] of repositories.entries()) {
    const field = `repositories[${index}]`;
    const name = repositoryNameProblem(repository.name);
    if (name !== null) problems.push({ field: `${field}.name`, message: name });
    // Compared without regard to case, because some file systems take `App` and `app` for one folder.
    const key = repository.name.toLowerCase();
    if (seen.has(key)) {
      problems.push({
        field: `${field}.name`,
        message: `Two repositories have the name "${repository.name}".`,
      });
    }
    seen.add(key);
    if (parseGitHubAddress(repository.github)?.fullName !== repository.github) {
      problems.push({
        field: `${field}.github`,
        message: `"${repository.github}" is not a GitHub repository written as owner/name.`,
      });
    }
    const address =
      repository.cloneAddress === undefined ? null : cloneAddressProblem(repository.cloneAddress);
    if (address !== null) problems.push({ field: `${field}.cloneAddress`, message: address });
  }
  return problems;
}

/** Every problem of the form of "create a Space". An empty list means setup may start. */
export function validateCreateSpaceInput(input: CreateSpaceInput): SetupInputProblem[] {
  const problems: SetupInputProblem[] = [];
  const add = (field: string, message: string | null): void => {
    if (message !== null) problems.push({ field, message });
  };
  add('name', spaceNameProblem(input.name));
  add('owner', ownerProblem(input.owner));
  add('description', descriptionProblem(input.description));
  add('parentDir', folderProblem('The folder the Space is created in', input.parentDir));
  problems.push(...repositoryProblems(input.repositories ?? []));
  return problems;
}
