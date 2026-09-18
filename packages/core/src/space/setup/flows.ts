/**
 * The three flows of setup: create a Space, adopt a plain repository, open a
 * Space by its GitHub address. Each has a plan (the dry run, which changes
 * nothing) and a run. Both check the form and the target folder first, so a
 * wrong name or a folder that holds something else is refused before anything
 * is created.
 *
 * Adopting is creating with one repository whose clone address is the origin
 * of the checkout that was opened. That checkout is only read.
 */

import { lstat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { createGitPort } from '../exec/git-port.js';
import { isPathInside } from '../fs/paths.js';
import { spacePaths } from '../layout/space-paths.js';
import { readSpaceManifest } from '../manifest/space-manifest.js';
import { type Result, err, ok } from '../result.js';
import { planSteps, runSteps } from '../steps/run-steps.js';
import type { Step, StepsFailure } from '../steps/types.js';
import { corpusEntryFileName, templateCorpusEntryNamed } from './lore-writes.js';
import {
  folderProblem,
  parseGitHubAddress,
  redactCredentials,
  repositoryNameProblem,
  validateCreateSpaceInput,
} from './names.js';
import { inspectSetupTarget } from './scaffold.js';
import {
  type CreateSpaceContext,
  FOREIGN_MATCH_KINDS,
  type OpenSpaceContext,
  type SetupContext,
  cloneConfirmedStep,
  cloneRepositoryStep,
  cloneSpaceStep,
  corpusEntryStep,
  firstCommitStep,
  firstSeenStep,
  installStep,
  machineCheckStep,
  projectLayoutStep,
  projectStep,
  refuseForeignMatches,
  repositoryMirrorStep,
  scaffoldStep,
  spaceRepositoryStep,
  workbenchStep,
} from './steps.js';
import type {
  AdoptRepositoryInput,
  CreateSpaceInput,
  OpenSpaceByAddressInput,
  SetupDeps,
  SetupFailure,
  SetupFlow,
  SetupInputProblem,
  SetupPlan,
  SetupReport,
  SetupRepositoryState,
  SetupRunOptions,
  SetupTargetState,
} from './types.js';

type Prepared<C extends SetupContext> = { ctx: C; steps: Step<C>[]; target: SetupTargetState };

function precheckFailure(
  flow: SetupFlow,
  kind: 'invalid-input' | 'target-not-empty',
  message: string,
  problems: SetupInputProblem[] = [],
): { ok: false; error: SetupFailure } {
  return err({
    kind,
    message,
    flow,
    stepId: null,
    title: null,
    completed: [],
    skipped: [],
    problems,
    byHand: [],
  });
}

function invalidInput(
  flow: SetupFlow,
  problems: SetupInputProblem[],
): { ok: false; error: SetupFailure } {
  const text = problems.map((problem) => problem.message).join(' ');
  return precheckFailure(flow, 'invalid-input', `Nothing was created. ${text}`, problems);
}

async function isDirectory(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => null))?.isDirectory() === true;
}

/** The steps of "create a Space" and of "adopt a repository", in order. */
export function createSpaceSteps(ctx: CreateSpaceContext): Step<CreateSpaceContext>[] {
  return [
    machineCheckStep(),
    spaceRepositoryStep(),
    projectStep(),
    projectLayoutStep(),
    scaffoldStep(),
    corpusEntryStep(),
    ...ctx.repositories.flatMap((repository) => [
      cloneRepositoryStep(repository),
      repositoryMirrorStep(repository),
    ]),
    firstCommitStep(),
    installStep(),
    firstSeenStep(),
  ];
}

/** The steps of "open a Space by address", in order. */
export function openSpaceSteps(): Step<OpenSpaceContext>[] {
  return [
    machineCheckStep(),
    cloneSpaceStep(),
    workbenchStep(),
    installStep(),
    cloneConfirmedStep(),
    firstSeenStep(),
  ];
}

async function prepareCreate(
  flow: SetupFlow,
  input: CreateSpaceInput,
  deps: SetupDeps,
): Promise<Result<Prepared<CreateSpaceContext>, SetupFailure>> {
  const problems = validateCreateSpaceInput(input);
  if (problems.length > 0) return invalidInput(flow, problems);

  const repositoryName = `${input.owner}/${input.name}`;
  if (!(await isDirectory(input.parentDir))) {
    problems.push({ field: 'parentDir', message: `${input.parentDir} is not a folder.` });
  }
  const taken = await templateCorpusEntryNamed(deps.templateDir, input.name);
  if (taken !== null) {
    problems.push({
      field: 'name',
      message: `The Space's own corpus entry would be the file ${corpusEntryFileName(input.name)}, and AI-Lore already has an entry of that name at ${taken}. Choose another name for the Space.`,
    });
  }
  for (const [index, repository] of (input.repositories ?? []).entries()) {
    if (repository.github.toLowerCase() === repositoryName.toLowerCase()) {
      problems.push({
        field: `repositories[${index}].github`,
        message: `${repository.github} would also be the Space repository. Choose another name for the Space.`,
      });
    }
  }
  if (problems.length > 0) return invalidInput(flow, problems);

  const spaceRoot = resolve(input.parentDir, input.name);
  const target = await inspectSetupTarget(spaceRoot, {
    name: input.name,
    repository: repositoryName,
  });
  if (!target.ok) return precheckFailure(flow, 'target-not-empty', target.error.message);

  const ctx: CreateSpaceContext = {
    flow,
    deps,
    git: createGitPort(deps.runner),
    spaceRoot,
    repositoryName,
    found: { repository: null, project: null },
    byHand: [],
    name: input.name,
    description: input.description,
    owner: input.owner,
    private: input.private ?? true,
    repositories: (input.repositories ?? []).map((repository) => ({ ...repository })),
    foreignChecked: false,
  };
  return ok({ ctx, steps: createSpaceSteps(ctx), target: target.value });
}

/** Turn the form of "adopt" into the form of "create", reading the source checkout and changing nothing. */
async function adoptAsCreate(
  input: AdoptRepositoryInput,
  deps: SetupDeps,
): Promise<Result<CreateSpaceInput, SetupFailure>> {
  const sourceProblem = folderProblem('The folder of the repository', input.sourceDir);
  if (sourceProblem !== null) {
    return invalidInput('adopt', [{ field: 'sourceDir', message: sourceProblem }]);
  }
  const git = createGitPort(deps.runner);
  const top = (await isDirectory(input.sourceDir)) ? await git.topLevel(input.sourceDir) : null;
  if (top === null || !top.ok || top.value === null) {
    return invalidInput('adopt', [
      { field: 'sourceDir', message: `${input.sourceDir} is not a git repository.` },
    ]);
  }
  const origin = await git.originUrl(input.sourceDir);
  if (!origin.ok || origin.value === null) {
    return invalidInput('adopt', [
      {
        field: 'sourceDir',
        message: `${input.sourceDir} has no remote named origin. A repository is adopted by cloning it fresh from its origin, so push it to GitHub first.`,
      },
    ]);
  }
  const github = input.github ?? parseGitHubAddress(origin.value)?.fullName;
  if (github === undefined) {
    return invalidInput('adopt', [
      {
        field: 'github',
        message: `The origin ${redactCredentials(origin.value)} is not a GitHub address. Give the repository as owner/name.`,
      },
    ]);
  }
  const repositoryName = input.repositoryName ?? basename(github);
  const nameProblem = repositoryNameProblem(repositoryName);
  if (nameProblem !== null) {
    return invalidInput('adopt', [{ field: 'repositoryName', message: nameProblem }]);
  }

  const folder = folderProblem('The folder the Space is created in', input.parentDir);
  if (folder === null && input.name !== '') {
    const spaceRoot = resolve(input.parentDir, input.name);
    const inside = isPathInside(input.sourceDir, spaceRoot);
    const holds = isPathInside(spaceRoot, input.sourceDir);
    if ((inside.ok && inside.value) || (holds.ok && holds.value) || !inside.ok || !holds.ok) {
      return invalidInput('adopt', [
        {
          field: 'parentDir',
          message: `The Space's folder ${spaceRoot} and the repository's folder ${input.sourceDir} may not hold one another, because the repository's folder is left as it is.`,
        },
      ]);
    }
  }
  const { sourceDir: _source, github: _github, repositoryName: _name, ...form } = input;
  return ok({
    ...form,
    repositories: [{ name: repositoryName, github, cloneAddress: origin.value }],
  });
}

async function prepareOpen(
  input: OpenSpaceByAddressInput,
  deps: SetupDeps,
): Promise<Result<Prepared<OpenSpaceContext>, SetupFailure>> {
  const problems: SetupInputProblem[] = [];
  const address = parseGitHubAddress(input.address);
  if (address === null) {
    problems.push({
      field: 'address',
      message: `"${redactCredentials(input.address)}" is not a GitHub repository: write it as owner/name or paste its address, without a user name or a token in it.`,
    });
  }
  const folder = folderProblem('The folder the Space is created in', input.parentDir);
  if (folder !== null) problems.push({ field: 'parentDir', message: folder });
  else if (!(await isDirectory(input.parentDir))) {
    problems.push({ field: 'parentDir', message: `${input.parentDir} is not a folder.` });
  }
  const folderName = input.folderName ?? address?.name ?? '';
  if (address !== null) {
    const nameProblem = repositoryNameProblem(folderName);
    if (nameProblem !== null) {
      problems.push({
        field: 'folderName',
        message: nameProblem.replace("The repository's name", "The name of the Space's folder"),
      });
    }
  }
  for (const [index, name] of (input.repositories ?? []).entries()) {
    const nameProblem = repositoryNameProblem(name);
    if (nameProblem !== null) {
      problems.push({ field: `repositories[${index}]`, message: nameProblem });
    }
  }
  if (address === null || problems.length > 0) return invalidInput('open', problems);

  const spaceRoot = resolve(input.parentDir, folderName);
  const target = await inspectSetupTarget(spaceRoot, { repository: address.fullName });
  if (!target.ok) return precheckFailure('open', 'target-not-empty', target.error.message);

  const ctx: OpenSpaceContext = {
    flow: 'open',
    deps,
    git: createGitPort(deps.runner),
    spaceRoot,
    repositoryName: address.fullName,
    found: { repository: null, project: null },
    byHand: [],
    confirmed: [...(input.repositories ?? [])],
  };
  return ok({ ctx, steps: openSpaceSteps(), target: target.value });
}

function stepsFailure(
  ctx: SetupContext,
  failure: StepsFailure,
): { ok: false; error: SetupFailure } {
  return err({ ...failure, flow: ctx.flow, problems: [], byHand: [...ctx.byHand] });
}

async function repositoryStates(spaceRoot: string): Promise<SetupRepositoryState[]> {
  const manifest = await readSpaceManifest(spaceRoot);
  if (!manifest.ok) return [];
  const states: SetupRepositoryState[] = [];
  for (const repository of manifest.value.repositories) {
    const cloned = await isDirectory(join(spacePaths(spaceRoot).repos, repository.name, '.git'));
    states.push({ name: repository.name, github: repository.github, cloned });
  }
  return states;
}

async function plan<C extends SetupContext>(
  prepared: Prepared<C>,
): Promise<Result<SetupPlan, SetupFailure>> {
  const { ctx, steps, target } = prepared;
  const planned = await planSteps(steps, ctx);
  if (!planned.ok) return stepsFailure(ctx, planned.error);
  return ok({ flow: ctx.flow, spaceRoot: ctx.spaceRoot, target, steps: planned.value });
}

async function run<C extends SetupContext>(
  prepared: Prepared<C>,
  options: SetupRunOptions,
): Promise<Result<SetupReport, SetupFailure>> {
  const { ctx, steps } = prepared;
  const done = await runSteps(steps, ctx, options);
  if (!done.ok) return stepsFailure(ctx, done.error);
  return ok({
    flow: ctx.flow,
    spaceRoot: ctx.spaceRoot,
    completed: done.value.completed,
    skipped: done.value.skipped,
    repository: ctx.found.repository,
    project: ctx.found.project,
    byHand: [...ctx.byHand],
    repositories: await repositoryStates(ctx.spaceRoot),
  });
}

/**
 * The plan of "create" and of "adopt". A repository or a Project of the
 * Space's name that belongs to something else stops the plan as it stops the
 * run, so the screen never offers a run that is known to be refused. When
 * GitHub cannot be asked, the plan is given and the run reports why.
 */
async function planCreate(
  prepared: Prepared<CreateSpaceContext>,
): Promise<Result<SetupPlan, SetupFailure>> {
  const { ctx, steps } = prepared;
  const foreign = await refuseForeignMatches(ctx);
  if (!foreign.ok && FOREIGN_MATCH_KINDS.includes(foreign.error.kind)) {
    const stepId = foreign.error.kind === 'project-taken' ? 'project' : 'space-repository';
    const step = steps.find((candidate) => candidate.id === stepId);
    return stepsFailure(ctx, {
      ...foreign.error,
      stepId,
      title: step?.title ?? stepId,
      completed: [],
      skipped: [],
    });
  }
  return plan(prepared);
}

/** The dry run of "create a Space": every step with what it will do. Nothing is created, on disk or on GitHub. */
export async function planCreateSpace(
  input: CreateSpaceInput,
  deps: SetupDeps,
): Promise<Result<SetupPlan, SetupFailure>> {
  const prepared = await prepareCreate('create', input, deps);
  return prepared.ok ? planCreate(prepared.value) : prepared;
}

/**
 * Create a Space: the repository and the Project on GitHub, the folder from
 * the template, the Space's corpus entry, the repositories under `repos/` with
 * their mirrors, the first commit and push, the install and the first-seen
 * records. A run that stopped is finished by calling this again with the same form.
 */
export async function createSpace(
  input: CreateSpaceInput,
  deps: SetupDeps,
  options: SetupRunOptions = {},
): Promise<Result<SetupReport, SetupFailure>> {
  const prepared = await prepareCreate('create', input, deps);
  return prepared.ok ? run(prepared.value, options) : prepared;
}

/** The dry run of "adopt a repository". The source checkout is read; nothing is created. */
export async function planAdoptRepository(
  input: AdoptRepositoryInput,
  deps: SetupDeps,
): Promise<Result<SetupPlan, SetupFailure>> {
  const form = await adoptAsCreate(input, deps);
  if (!form.ok) return form;
  const prepared = await prepareCreate('adopt', form.value, deps);
  return prepared.ok ? planCreate(prepared.value) : prepared;
}

/**
 * Create a Space about a plain repository. The repository is cloned fresh from
 * the origin of `sourceDir` into `repos/<name>`; `sourceDir` itself is only read.
 */
export async function adoptRepository(
  input: AdoptRepositoryInput,
  deps: SetupDeps,
  options: SetupRunOptions = {},
): Promise<Result<SetupReport, SetupFailure>> {
  const form = await adoptAsCreate(input, deps);
  if (!form.ok) return form;
  const prepared = await prepareCreate('adopt', form.value, deps);
  return prepared.ok ? run(prepared.value, options) : prepared;
}

/** The dry run of "open a Space by address". Nothing is cloned. */
export async function planOpenSpaceByAddress(
  input: OpenSpaceByAddressInput,
  deps: SetupDeps,
): Promise<Result<SetupPlan, SetupFailure>> {
  const prepared = await prepareOpen(input, deps);
  return prepared.ok ? plan(prepared.value) : prepared;
}

/**
 * Open a Space from its GitHub address: clone the Space repository, create the
 * Workbench, install, clone the confirmed repositories and record the
 * first-seen commits. The report lists the manifest's repositories; those not
 * yet cloned are cloned by calling this again with their names in `repositories`.
 */
export async function openSpaceByAddress(
  input: OpenSpaceByAddressInput,
  deps: SetupDeps,
  options: SetupRunOptions = {},
): Promise<Result<SetupReport, SetupFailure>> {
  const prepared = await prepareOpen(input, deps);
  return prepared.ok ? run(prepared.value, options) : prepared;
}
