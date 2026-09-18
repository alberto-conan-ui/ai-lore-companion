/**
 * The verification at the end of a migration (step 13, section 5.9 of the
 * architecture document). It asks the real state each time and writes
 * nothing, in the Space, in the source or on GitHub. Five checks:
 *
 * 1. lore-integrity passes over the new Space's Lore (the Space's own check
 *    script, run with `python3` as a child process);
 * 2. every archived file's SHA-256 equals its source file's, read now, and
 *    the archive folder holds no file without a source file;
 * 3. both source repositories are at the head commit and `git status
 *    --porcelain` that step 1 recorded in the ledger;
 * 4. the Space repository is committed and its branch is on `origin` at the
 *    same commit;
 * 5. every planned issue's marker is on exactly one issue on GitHub, and that
 *    issue is on the Project once.
 *
 * A failed check says what was found and what to look at. Nothing is undone.
 */

import { readdir, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { IssueRef } from '../desk/types.js';
import { runGit } from '../exec/git-port.js';
import { runSucceeded } from '../exec/runner.js';
import { sha256File } from '../fs/copy-tree.js';
import { errorMessage } from '../result.js';
import { inSource, inSpace } from './checks.js';
import type { MigrationContext } from './context.js';
import { ledgerRecords } from './ledger.js';
import { isPushedAndClean } from './steps/10-commit-and-push.js';
import type { MigrationRepositoryState } from './types.js';

/** The ids of the checks, in the order they run. */
export const VERIFICATION_CHECK_IDS = [
  'lore-integrity',
  'archive',
  'source-repositories',
  'space-pushed',
  'issues',
] as const;

/** The id of one check of the verification. */
export type VerificationCheckId = (typeof VERIFICATION_CHECK_IDS)[number];

/** One check: whether it passed, a sentence that says what was found, and what to look at when it failed. */
export type VerificationCheck = {
  id: VerificationCheckId;
  title: string;
  passed: boolean;
  /** A sentence that can be shown as it is. */
  sentence: string;
  /** Paths or addresses to look at; empty when the check passed. */
  lookAt: string[];
};

/** What the verification found. */
export type MigrationVerification = {
  passed: boolean;
  checks: VerificationCheck[];
};

/** How long lore-integrity may take over the Space's Lore. */
const LORE_INTEGRITY_TIMEOUT_MS = 120_000;
/** The Space-relative path of the Space's own lore-integrity script. */
export const LORE_INTEGRITY_SCRIPT = 'lore/contracts/core/lore-integrity.py';
/** How many paths a failed check names before it gives only the count of the rest. */
const NAMED = 10;

function named(paths: readonly string[]): string {
  const shown = paths.slice(0, NAMED).join(', ');
  return paths.length > NAMED ? `${shown} and ${paths.length - NAMED} more` : shown;
}

function check(
  id: VerificationCheckId,
  title: string,
  passed: boolean,
  sentence: string,
  lookAt: string[] = [],
): VerificationCheck {
  return { id, title, passed, sentence, lookAt: passed ? [] : lookAt };
}

async function loreIntegrity(ctx: MigrationContext): Promise<VerificationCheck> {
  const title = 'lore-integrity passes over the Space';
  const script = inSpace(ctx, LORE_INTEGRITY_SCRIPT);
  if ((await stat(script).catch(() => null))?.isFile() !== true) {
    return check(
      'lore-integrity',
      title,
      false,
      `The check script ${LORE_INTEGRITY_SCRIPT} is not in the Space, so the Lore could not be checked.`,
      [script],
    );
  }
  const run = await ctx.deps.runner.run(
    'python3',
    [script, '--space', ctx.spaceRoot, '--when', 'after'],
    { cwd: ctx.spaceRoot, timeoutMs: LORE_INTEGRITY_TIMEOUT_MS },
  );
  if (runSucceeded(run)) {
    return check(
      'lore-integrity',
      title,
      true,
      'lore-integrity passed over the Lore of the Space.',
    );
  }
  if (run.failure !== undefined) {
    // python3 missing, refused or timed out: the Lore was not checked.
    const reason = run.stderr.trim().replace(/\.$/, '') || run.failure;
    return check(
      'lore-integrity',
      title,
      false,
      `lore-integrity could not be run with python3, so the Lore of the Space was not checked: ${reason}.`,
      [script],
    );
  }
  const lines = `${run.stderr}\n${run.stdout}`
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const shown = lines.slice(0, NAMED).join(' ');
  const more = lines.length > NAMED ? ` (${lines.length - NAMED} more lines)` : '';
  return check(
    'lore-integrity',
    title,
    false,
    `lore-integrity failed over the Lore of the Space with exit code ${run.code}: ${shown || 'it printed nothing'}${more}`,
    [join(ctx.spaceRoot, 'lore')],
  );
}

async function archive(ctx: MigrationContext): Promise<VerificationCheck> {
  const title = "Every archived file's hash equals its source's";
  const missing: string[] = [];
  const differing: string[] = [];
  const unreadable: string[] = [];
  for (const file of ctx.targets.archived) {
    const from = await sha256File(inSource(ctx, file.from));
    if (!from.ok) {
      unreadable.push(file.from);
      continue;
    }
    const to = await sha256File(inSpace(ctx, file.to));
    if (!to.ok) missing.push(file.to);
    else if (to.value !== from.value) differing.push(file.to);
  }
  const expected = new Set(ctx.targets.archived.map((file) => file.to));
  const extra = (await filesUnder(inSpace(ctx, ctx.targets.archiveDir), ctx.targets.archiveDir))
    .filter((path) => !expected.has(path))
    .sort();
  const count = ctx.targets.archived.length;
  if (missing.length + differing.length + unreadable.length + extra.length === 0) {
    return check(
      'archive',
      title,
      true,
      `All ${count} archived files have the SHA-256 of their source file.`,
    );
  }
  const parts: string[] = [];
  if (differing.length > 0) {
    parts.push(`${differing.length} archived files differ from their source: ${named(differing)}`);
  }
  if (missing.length > 0) {
    parts.push(`${missing.length} archived files are missing: ${named(missing)}`);
  }
  if (unreadable.length > 0) {
    parts.push(`${unreadable.length} source files could not be read: ${named(unreadable)}`);
  }
  if (extra.length > 0) {
    parts.push(`${extra.length} files in the archive have no source file: ${named(extra)}`);
  }
  return check('archive', title, false, `Of ${count} archived files, ${parts.join('; ')}.`, [
    ...differing.map((path) => inSpace(ctx, path)),
    ...missing.map((path) => inSpace(ctx, path)),
    ...unreadable.map((path) => inSource(ctx, path)),
    ...extra.map((path) => inSpace(ctx, path)),
  ]);
}

/**
 * The files and links under `dir`, as paths that begin with `rel` and use
 * `/`; folders are walked, links are not followed. Empty when `dir` is absent.
 */
async function filesUnder(dir: string, rel: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const paths: string[] = [];
  for (const entry of entries) {
    const path = `${rel}/${entry.name}`;
    if (entry.isDirectory()) paths.push(...(await filesUnder(join(dir, entry.name), path)));
    else paths.push(path);
  }
  return paths;
}

/** The head and status of one source repository now, read as the v0.8 reader reads them. */
async function repositoryNow(
  ctx: MigrationContext,
  path: string,
): Promise<{ head: string | null; statusText: string } | { error: string }> {
  const dir = inSource(ctx, path);
  const git = (args: string[]) => runGit(ctx.deps.runner, dir, args, { readOnly: true });
  const top = await git(['rev-parse', '--show-toplevel']);
  const [dirReal, topReal] = await Promise.all([
    realpathOrNull(dir),
    runSucceeded(top) ? realpathOrNull(top.stdout.trim()) : Promise.resolve(null),
  ]);
  // Not the top of a repository of its own: the reader records no head and no status.
  if (dirReal === null || topReal === null || dirReal !== topReal)
    return { head: null, statusText: '' };
  const [head, status] = await Promise.all([
    git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']),
    git(['-c', 'core.quotepath=false', 'status', '--porcelain']),
  ]);
  if (!runSucceeded(status)) {
    return {
      error: `git status could not be read: ${status.stderr.trim() || `exit code ${status.code}`}`,
    };
  }
  return {
    head: runSucceeded(head) ? head.stdout.trim() || null : null,
    statusText: status.stdout.replace(/\n+$/, ''),
  };
}

function realpathOrNull(path: string): Promise<string | null> {
  return realpath(path).catch(() => null);
}

async function sourceRepositories(ctx: MigrationContext): Promise<VerificationCheck> {
  const title = 'Both source repositories are as step 1 recorded them';
  const records = ledgerRecords(ctx, 'source-state');
  const recorded = records[records.length - 1];
  if (recorded === undefined) {
    return check(
      'source-repositories',
      title,
      false,
      "The migration's ledger holds no record of step 1, so the source repositories could not be compared with it.",
      [ctx.source.root],
    );
  }
  const changed: string[] = [];
  const lookAt: string[] = [];
  const labels: [string, MigrationRepositoryState][] = [
    ['payload repository', recorded.payload],
    ['Lore repository', recorded.lore],
  ];
  for (const [label, state] of labels) {
    const now = await repositoryNow(ctx, state.path);
    if ('error' in now) {
      changed.push(`the ${label} ${state.path}: ${now.error}`);
    } else if (now.head !== state.head) {
      changed.push(
        `the ${label} ${state.path} is at ${now.head ?? 'no commit'} and step 1 recorded ${state.head ?? 'no commit'}`,
      );
    } else if (now.statusText !== state.statusText) {
      const before = state.statusText === '' ? 0 : state.statusText.split('\n').length;
      const after = now.statusText === '' ? 0 : now.statusText.split('\n').length;
      changed.push(
        `the git status of the ${label} ${state.path} differs from what step 1 recorded (${after} changed paths now, ${before} then)`,
      );
    } else {
      continue;
    }
    lookAt.push(inSource(ctx, state.path));
  }
  if (changed.length === 0) {
    return check(
      'source-repositories',
      title,
      true,
      `The payload repository and the Lore repository are at the head commit and git status step 1 recorded at ${recorded.at}.`,
    );
  }
  return check(
    'source-repositories',
    title,
    false,
    `The source changed after step 1: ${changed.join('; ')}. The migration does not write to the source, so something else did.`,
    lookAt,
  );
}

async function spacePushed(ctx: MigrationContext): Promise<VerificationCheck> {
  const title = 'The Space repository is pushed';
  let pushed = false;
  try {
    pushed = await isPushedAndClean(ctx);
  } catch (caught) {
    return check(
      'space-pushed',
      title,
      false,
      `Whether the Space repository is pushed could not be read: ${errorMessage(caught)}.`,
      [ctx.spaceRoot],
    );
  }
  if (pushed) {
    return check(
      'space-pushed',
      title,
      true,
      `Everything in the Space is committed and its branch is on ${ctx.repositoryName} at the same commit.`,
    );
  }
  return check(
    'space-pushed',
    title,
    false,
    `The Space folder has changes that are not committed, or its branch is not on ${ctx.repositoryName} at the same commit. Run git status in the Space folder.`,
    [ctx.spaceRoot],
  );
}

function refText(ref: IssueRef): string {
  return `${ref.repository}#${ref.number}`;
}

async function issues(ctx: MigrationContext): Promise<VerificationCheck> {
  const title = 'Every planned issue exists once';
  const fail = (sentence: string, lookAt: string[] = [ctx.repositoryName]) =>
    check('issues', title, false, sentence, lookAt);
  const github = ctx.deps.github;
  const repository = await github.findRepository(ctx.repositoryName);
  if (!repository.ok)
    return fail(`GitHub could not be asked for the issues: ${repository.error.message}`);
  if (repository.value === null)
    return fail(`The repository ${ctx.repositoryName} was not found on GitHub.`);
  const project = await github.findProject({ owner: ctx.settings.owner, title: ctx.settings.name });
  if (!project.ok)
    return fail(`GitHub could not be asked for the Project: ${project.error.message}`);
  if (project.value === null) {
    return fail(
      `The Project "${ctx.settings.name}" of ${ctx.settings.owner} was not found on GitHub.`,
    );
  }
  if (ctx.issues.length === 0) {
    return check('issues', title, true, 'The plan has no issue to create, so none was looked for.');
  }
  const found = await github.findAllIssuesByMarkers({
    repository: repository.value.fullName,
    markers: ctx.issues.map((issue) => issue.marker),
  });
  if (!found.ok) return fail(`GitHub could not be asked for the issues: ${found.error.message}`);
  const snapshot = await github.readProject({ project: project.value });
  if (!snapshot.ok)
    return fail(`GitHub could not be asked for the Project: ${snapshot.error.message}`);
  const onProject = new Map<string, number>();
  const count = (ref: IssueRef) =>
    onProject.set(refText(ref), (onProject.get(refText(ref)) ?? 0) + 1);
  for (const focus of snapshot.value.focuses) {
    count(focus.issue);
    for (const item of focus.items) count(item.issue);
  }
  for (const item of snapshot.value.standalone) count(item.issue);

  const recorded = new Map(ledgerRecords(ctx, 'issue').map((record) => [record.key, record.issue]));
  const seen = new Map<string, string>();
  const problems: string[] = [];
  for (const issue of ctx.issues) {
    const all = found.value[issue.marker] ?? [];
    const ref = all[0];
    if (ref === undefined) {
      problems.push(`no issue has the marker of ${issue.key}`);
      continue;
    }
    if (all.length > 1) {
      problems.push(
        `the marker of ${issue.key} is on ${all.length} issues, ${all.map(refText).join(', ')}, and must be on one`,
      );
    }
    const text = refText(ref);
    const inLedger = recorded.get(issue.key);
    if (inLedger !== undefined && refText(inLedger) !== text) {
      problems.push(
        `the marker of ${issue.key} is on ${text}, and the ledger records ${refText(inLedger)}, so the marker is on two issues`,
      );
    }
    const other = seen.get(text);
    if (other !== undefined) problems.push(`${text} stands for both ${other} and ${issue.key}`);
    seen.set(text, issue.key);
    const times = onProject.get(text) ?? 0;
    if (times !== 1) problems.push(`${text} (${issue.key}) is on the Project ${times} times`);
  }
  if (problems.length === 0) {
    return check(
      'issues',
      title,
      true,
      `All ${ctx.issues.length} planned issues were found on ${ctx.repositoryName} by their marker, each once on the Project.`,
    );
  }
  return fail(
    `Of ${ctx.issues.length} planned issues, ${problems.length} ${problems.length === 1 ? 'problem was' : 'problems were'} found: ${named(problems)}.`,
    [repository.value.url, project.value.url],
  );
}

/**
 * Verify the migration in `ctx`: run every check, whatever an earlier check
 * found, and return each with its sentence. Writes nothing. A check that
 * throws is a failed check with the reason.
 */
export async function verifyMigration(ctx: MigrationContext): Promise<MigrationVerification> {
  const runs: [VerificationCheckId, string, (c: MigrationContext) => Promise<VerificationCheck>][] =
    [
      ['lore-integrity', 'lore-integrity passes over the Space', loreIntegrity],
      ['archive', "Every archived file's hash equals its source's", archive],
      [
        'source-repositories',
        'Both source repositories are as step 1 recorded them',
        sourceRepositories,
      ],
      ['space-pushed', 'The Space repository is pushed', spacePushed],
      ['issues', 'Every planned issue exists once', issues],
    ];
  const checks: VerificationCheck[] = [];
  for (const [id, title, run] of runs) {
    try {
      checks.push(await run(ctx));
    } catch (caught) {
      checks.push(check(id, title, false, `The check could not be run: ${errorMessage(caught)}.`));
    }
  }
  return { passed: checks.every((one) => one.passed), checks };
}

/**
 * The verification as text: one line per check, "passed" or "failed" with
 * its sentence, then what to look at for each failed check.
 */
export function verificationText(verification: MigrationVerification): string {
  const lines = verification.checks.map(
    (one) => `${one.passed ? 'Passed' : 'Failed'}: ${one.title}. ${one.sentence}`,
  );
  const lookAt = verification.checks.flatMap((one) => one.lookAt);
  if (lookAt.length > 0) lines.push(`Look at: ${named(lookAt)}.`);
  return lines.join('\n');
}
