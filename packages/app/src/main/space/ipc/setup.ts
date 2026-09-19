/**
 * The handlers of creating a Space (`shared/ipc/space/setup.contract.ts`),
 * phase M3.7. They serve core's three flows: create a Space, adopt a plain
 * repository, open a Space by its GitHub address.
 *
 * A setup window has no Space yet, so it has no `SpaceContext` and no Space
 * service. What main holds for a setup window is kept here, by window id: the
 * folder chosen in main's own dialog, the run that goes on, the last report.
 * It is dropped when the window is gone or was told to be something else.
 *
 * The renderer sends no folder. The folder the Space is created in comes from
 * the folder dialog this module opens; the folder of the repository to adopt
 * is the one the host put in the window's `SetupStart`. The form's texts are
 * validated by core, which returns a sentence per field.
 *
 * A run creates a repository and a Project on GitHub, which others can see,
 * so it runs only a plan the Human Lead was shown. `spaceSetupPlan` keeps the
 * input it planned and returns a token with the plan; `spaceSetupRun` takes
 * that token, not a form, and runs the kept input. A run with no plan, with
 * the token of an older plan, or after another folder was chosen is refused.
 *
 * Every command of a run goes through `deps.space.runner`, the app's runner,
 * which carries the answer to whether `gh` may start. The `PATH` of the
 * commands is the `PATH` of the Human Lead's login shell, read as the machine
 * check reads it, because an app started from the Finder has a short `PATH`.
 */

import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  type AdoptRepositoryInput,
  type CommandRunner,
  type CreateSpaceInput,
  type ExistingSpace,
  type GitHubPort,
  type MachineCheck,
  type OpenSpaceByAddressInput,
  type Result,
  SETUP_LABELS,
  SETUP_VIEWS,
  type SetupCheckProgress,
  type SetupDeps,
  type SetupFailure,
  type SetupFlow,
  type SetupInputProblem,
  type SetupPlan,
  type SetupReport,
  type SetupRunOptions,
  adoptRepository,
  createGitPort,
  createSpace,
  folderProblem,
  inspectExistingSpace,
  openSpaceByAddress,
  parseGitHubAddress,
  planAdoptRepository,
  planCreateSpace,
  planOpenSpaceByAddress,
  redactCredentials,
  repositoryNameProblem,
  validateCreateSpaceInput,
  writeFileAtomicSync,
} from '@ai-lore-companion/core';
import { z } from 'zod';
import type {
  SetupStart,
  SpaceSetupChooseFolderResult,
  SpaceSetupChooseSourceResult,
  SpaceSetupFailure,
  SpaceSetupForm,
  SpaceSetupGitHubNames,
  SpaceSetupInterrupted,
  SpaceSetupListSpacesResult,
  SpaceSetupOwners,
  SpaceSetupPlanResult,
  SpaceSetupRunResult,
  SpaceSetupSource,
  SpaceSetupStateResult,
  SpaceSetupStopResult,
  SpaceSetupValidateResult,
  SpaceWindowResult,
  StepProgress,
} from '../../../shared/ipc.js';
import { SPACE_SETUP_CONTRACT } from '../../../shared/ipc/space/setup.contract.js';
import { loadEngines } from '../../engines.js';
import type { Deps, RegisterModule } from '../../ipc/types.js';
import { readJsonFile } from '../../json-file.js';
import { withCommandLog } from '../command-log.js';
import { checkMachineOfApp, readGitHubOwnersOfApp } from '../e2e-machine.js';
import { knownGitHubOwners, rememberGitHubOwners } from '../github-owners.js';
import { createAppGitHubPort } from '../github-service.js';
import type { SpaceIpcEvent } from '../host.js';
import { readSpacesFolder } from '../spaces-folder.js';
import { loreTemplateDir } from '../template-dir.js';
import type { SpaceWindowLike, SpaceWindowRecord } from '../windows.js';
import { readLoginShellPath, validLoginShell } from './machine.js';
import { parseArg } from './validate.js';

/** How long a whole plan may take before it stops with `plan-timeout` (architecture document A.6). */
export const PLAN_TIME_LIMIT_MS = 60_000;

/** `runner` with `PATH` set for every command; `runner` itself when `path` is `null`. */
export function runnerWithPath(runner: CommandRunner, path: string | null): CommandRunner {
  if (path === null) return runner;
  return {
    run: (bin, args, opts) => runner.run(bin, args, { ...opts, env: { PATH: path, ...opts?.env } }),
  };
}

async function pickFolderWithDialog(
  window: SpaceWindowLike,
  title: string,
): Promise<string | null> {
  const { BrowserWindow, dialog } = await import('electron');
  const options = {
    title,
    properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[],
  };
  const owner = BrowserWindow.fromId(window.id);
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options);
  const [folder] = result.filePaths;
  return result.canceled || !folder ? null : folder;
}

/** What the handlers take from their surroundings. A headless test replaces them. */
export type SpaceSetupParts = {
  /** The Lore template. Default: `loreTemplateDir` of `main/space/template-dir.ts`. */
  templateDir: () => Result<string>;
  /** The system's folder dialog; `null` when it was cancelled. Default: Electron's. */
  pickFolder: (window: SpaceWindowLike, title: string) => Promise<string | null>;
  /** The runner of a plan or a run. Default: `deps.space.runner` with the login shell's `PATH`, logging network `git` calls. */
  runner: (deps: Deps) => Promise<CommandRunner>;
  /** The GitHub port on that runner. Default: `createAppGitHubPort`, the one the Space service uses. */
  github: (runner: CommandRunner, deps: Deps) => GitHubPort | Promise<GitHubPort>;
  /** The machine check of the first step. Default: core's, with the app's engines. */
  checkMachine: (deps: Deps, runner: CommandRunner) => Promise<MachineCheck>;
  /** Values for the new repository's own git configuration. Default: none. */
  gitConfig: Readonly<Record<string, string>> | undefined;
  /** The Spaces folder setting. Default: `readSpacesFolder`. */
  spacesFolder: (deps: Deps) => string | null;
  /** The signed-in account and its organisations. Default: the last machine check's, else a fresh read. */
  owners: (
    deps: Deps,
    runner: CommandRunner,
  ) => Promise<{ account: string | null; organisations: string[] }>;
  /** How long a whole plan may take. Default `PLAN_TIME_LIMIT_MS`. */
  planTimeLimitMs: number;
  /** Where the owner of the last finished run is remembered. Default `<userData>/spaces/setup-defaults.json`. */
  defaultsFile: (deps: Deps) => string;
};

const DEFAULT_PARTS: SpaceSetupParts = {
  templateDir: () => loreTemplateDir(),
  pickFolder: pickFolderWithDialog,
  runner: async (deps) => {
    const shell = validLoginShell(process.env.SHELL ?? '/bin/zsh');
    const path = await readLoginShellPath(deps.space.runner, shell, process.platform);
    return withCommandLog(runnerWithPath(deps.space.runner, path), deps.space.log, 'git-network');
  },
  github: (runner, deps) => createAppGitHubPort({ runner, log: deps.space.log }),
  checkMachine: (deps, runner) =>
    checkMachineOfApp(runner, loadEngines(deps.space.userDataDir()), {
      platform: process.platform,
    }),
  gitConfig: undefined,
  spacesFolder: (deps) => readSpacesFolder(deps.space.userDataDir()),
  owners: async (deps, runner) => {
    const known = knownGitHubOwners();
    if (known !== null) return known;
    const fresh = await readGitHubOwnersOfApp(runner, { platform: process.platform });
    rememberGitHubOwners(fresh);
    return fresh;
  },
  planTimeLimitMs: PLAN_TIME_LIMIT_MS,
  defaultsFile: (deps) => join(deps.space.userDataDir(), 'spaces', 'setup-defaults.json'),
};

/** The `owner` field of `setup-defaults.json`, or `null` when the file is absent or unreadable. */
function readSetupDefaults(path: string): { owner: string | null } {
  const raw = readJsonFile(path);
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const owner = (raw as Record<string, unknown>).owner;
    if (typeof owner === 'string') return { owner };
  }
  return { owner: null };
}

/** Remember `owner` as the last one used, keeping any field of an existing file this version does not know. */
function writeSetupDefaults(path: string, owner: string): void {
  const raw = readJsonFile(path);
  const base =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  writeFileAtomicSync(path, JSON.stringify({ ...base, version: 1, owner }, null, 2));
}

const text = (max: number) => z.string().max(max);
const repositoryEntrySchema = z.strictObject({
  address: text(500),
  name: text(200).optional(),
});
const formSchema = z.discriminatedUnion('flow', [
  z.strictObject({
    flow: z.literal('create'),
    name: text(300),
    description: text(20_000),
    owner: text(200),
    private: z.boolean(),
    repositories: z.array(repositoryEntrySchema).max(50),
  }),
  z.strictObject({
    flow: z.literal('adopt'),
    name: text(300),
    description: text(20_000),
    owner: text(200),
    private: z.boolean(),
    github: text(500).optional(),
    repositoryName: text(200).optional(),
  }),
  z.strictObject({
    flow: z.literal('open'),
    address: text(500),
    folderName: text(200).optional(),
    repositories: z.array(text(200)).max(50),
  }),
]);
const emptySchema = z.strictObject({});
const runSchema = z.strictObject({
  token: text(100),
  repositories: z.array(text(200)).max(50).optional(),
});
const ownerSchema = z.strictObject({ owner: text(200) });

/** The flow a setup window serves. */
export function flowOfStart(start: SetupStart): SetupFlow {
  if (start.kind === 'new') return 'create';
  return start.kind === 'from-address' ? 'open' : 'adopt';
}

function refusal(kind: string, message: string): { ok: false; error: SpaceSetupFailure } {
  return {
    ok: false,
    error: { kind, message, stepId: null, title: null, problems: [], byHand: [], viewSettings: [] },
  };
}

function fromCore(failure: SetupFailure): { ok: false; error: SpaceSetupFailure } {
  return {
    ok: false,
    error: {
      kind: failure.kind,
      message: failure.message,
      stepId: failure.stepId,
      title: failure.title,
      problems: failure.problems,
      byHand: failure.byHand,
      viewSettings: failure.viewSettings,
    },
  };
}

const optional = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
};

type CoreInput =
  | { flow: 'create'; input: CreateSpaceInput }
  | { flow: 'adopt'; input: AdoptRepositoryInput }
  | { flow: 'open'; input: OpenSpaceByAddressInput };

/** Core's input from the form and the folders main holds. An address that is not GitHub's stays as typed, so that core names it. */
function coreInput(form: SpaceSetupForm, parentDir: string, sourceDir: string | null): CoreInput {
  if (form.flow === 'open') {
    const folderName = optional(form.folderName);
    return {
      flow: 'open',
      input: {
        address: form.address.trim(),
        parentDir,
        ...(folderName === undefined ? {} : { folderName }),
        repositories: form.repositories,
      },
    };
  }
  const shared = {
    name: form.name.trim(),
    description: form.description,
    owner: form.owner.trim(),
    parentDir,
    private: form.private,
  };
  if (form.flow === 'adopt') {
    const github = optional(form.github);
    const repositoryName = optional(form.repositoryName);
    return {
      flow: 'adopt',
      input: {
        ...shared,
        sourceDir: sourceDir ?? '',
        ...(github === undefined ? {} : { github }),
        ...(repositoryName === undefined ? {} : { repositoryName }),
      },
    };
  }
  return {
    flow: 'create',
    input: {
      ...shared,
      repositories: form.repositories.map((entry) => {
        const address = entry.address.trim();
        const parsed = parseGitHubAddress(address);
        return {
          name: optional(entry.name) ?? parsed?.name ?? '',
          github: parsed?.fullName ?? address,
        };
      }),
    },
  };
}

/**
 * The problems of the form that can be told without reading a disk or asking
 * GitHub. Create and adopt use core's `validateCreateSpaceInput`. Core has no
 * such function for the other fields; their checks here use core's own
 * functions, and the sentence for `address` repeats the one of core's
 * `planOpenSpaceByAddress`, which gives it again when the plan is asked.
 */
export function setupFormProblems(core: CoreInput, form: SpaceSetupForm): SetupInputProblem[] {
  const problems: SetupInputProblem[] = [];
  if (core.flow === 'open') {
    const { address, parentDir, folderName } = core.input;
    const parsed = parseGitHubAddress(address);
    if (parsed === null) {
      problems.push({
        field: 'address',
        message: `"${redactCredentials(address)}" is not a GitHub repository: write it as owner/name or paste its address, without a user name or a token in it.`,
      });
    }
    const folder = folderProblem('The folder the Space is created in', parentDir);
    if (folder !== null) problems.push({ field: 'parentDir', message: folder });
    const name = folderName ?? parsed?.name;
    const nameProblem = name === undefined ? null : repositoryNameProblem(name);
    if (nameProblem !== null) {
      problems.push({
        field: 'folderName',
        message: nameProblem.replace("The repository's name", "The name of the Space's folder"),
      });
    }
    return problems;
  }
  if (core.flow === 'adopt') {
    const { sourceDir, github, repositoryName, ...create } = core.input;
    problems.push(...validateCreateSpaceInput({ ...create, repositories: [] }));
    if (github !== undefined && parseGitHubAddress(github)?.fullName !== github) {
      problems.push({
        field: 'github',
        message: `"${redactCredentials(github)}" is not a GitHub repository written as owner/name.`,
      });
    }
    const nameProblem = repositoryName === undefined ? null : repositoryNameProblem(repositoryName);
    if (nameProblem !== null) problems.push({ field: 'repositoryName', message: nameProblem });
    return problems;
  }
  const all = validateCreateSpaceInput(core.input);
  if (form.flow !== 'create') return all;
  // A row whose address did not give a name has one problem, the address, not two.
  return all.filter((problem) => {
    const row = /^repositories\[(\d+)\]\.name$/.exec(problem.field);
    if (row === null) return true;
    const index = Number(row[1]);
    const entry = form.repositories[index];
    const given = core.input.repositories?.[index]?.name ?? '';
    return !(entry !== undefined && optional(entry.name) === undefined && given === '');
  });
}

/** The Space's folder a form leads to, or `null` when the form does not give one yet. */
function spaceRootOf(core: CoreInput): string | null {
  if (core.input.parentDir === '') return null;
  if (core.flow === 'open') {
    const name = core.input.folderName ?? parseGitHubAddress(core.input.address)?.name;
    return name === undefined ? null : resolve(core.input.parentDir, name);
  }
  return core.input.name === '' ? null : resolve(core.input.parentDir, core.input.name);
}

function gitHubNames(core: CoreInput, plan: SetupPlan): SpaceSetupGitHubNames | null {
  if (core.flow === 'open') return null;
  const done = (stepId: string): boolean =>
    plan.steps.find((step) => step.stepId === stepId)?.done ?? false;
  return {
    owner: core.input.owner,
    repository: `${core.input.owner}/${core.input.name}`,
    visibility: (core.input.private ?? true) ? 'private' : 'public',
    repositoryExists: done('space-repository'),
    repositoryUrl: plan.repository?.url ?? null,
    project: core.input.name,
    projectExists: done('project'),
    projectUrl: plan.project?.url ?? null,
    labels: SETUP_LABELS.map((label) => label.name),
    views: SETUP_VIEWS.map((view) => view.name),
  };
}

function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** What main holds for one setup window. */
type WindowSetup = {
  /** The payload the window was last told; a new one means the screens were started again. */
  init: SpaceWindowRecord['init'];
  parentDir: string | null;
  /** For `from-repository`: the repository chosen on the form with `spaceSetupChooseSource`. */
  source: SpaceSetupSource | null;
  /** The last local, GitHub-free look at the form's target folder (`spaceSetupValidate`). */
  preview: ExistingSpace | null;
  /**
   * The last plan main made for this window and sent with its token: the
   * input a run uses. A run is accepted only with this token, so it runs
   * exactly what the Human Lead saw on the plan screen. A new request for a
   * plan, or another folder or source, drops it.
   */
  planned: { token: string; core: CoreInput; form: SpaceSetupForm } | null;
  /** Counts the requests for a plan; only the last one may leave its plan. */
  planAsked: number;
  /** Counts the plans of this window, sent with each of their progress events. */
  planId: number;
  running: AbortController | null;
  report: SetupReport | null;
  /** The folder of a plan that answered `complete: true`: nothing to run, only to open. */
  completeRoot: string | null;
};

/** Build the register module of creating a Space. */
export function createSpaceSetupRegister(parts: Partial<SpaceSetupParts> = {}): RegisterModule {
  const all: SpaceSetupParts = { ...DEFAULT_PARTS, ...parts };
  return (reg, deps) => {
    const held = new Map<number, { window: SpaceWindowLike; setup: WindowSetup }>();
    let interrupted: SpaceSetupInterrupted | null = null;

    type Asked = { record: SpaceWindowRecord; start: SetupStart; setup: WindowSetup };

    /** The setup window that asks and what is held for it, or the refusal. */
    function asked(event: SpaceIpcEvent): Asked | { ok: false; error: SpaceSetupFailure } {
      for (const [id, entry] of held) {
        if (entry.window.isDestroyed() && entry.setup.running === null) held.delete(id);
      }
      const record = deps.space.windowFor(event);
      if (!record) {
        return refusal(
          'not-a-space-window',
          'The request did not come from an AI-Lore 1.0 window.',
        );
      }
      if (record.init.mode !== 'setup') {
        return refusal('not-allowed-here', 'Setup runs from the create-a-Space screens.');
      }
      let entry = held.get(record.window.id);
      if (
        entry === undefined ||
        (entry.setup.init !== record.init && entry.setup.running === null)
      ) {
        entry = {
          window: record.window,
          setup: {
            init: record.init,
            parentDir: all.spacesFolder(deps),
            source: null,
            preview: null,
            planned: null,
            planAsked: 0,
            planId: 0,
            running: null,
            report: null,
            completeRoot: null,
          },
        };
        held.set(record.window.id, entry);
      }
      return { record, start: record.init.start, setup: entry.setup };
    }

    function inputOf(
      who: Asked,
      form: SpaceSetupForm,
    ): CoreInput | { ok: false; error: SpaceSetupFailure } {
      const flow = flowOfStart(who.start);
      if (form.flow !== flow) {
        return refusal(
          'not-allowed-here',
          `This window serves the flow ${flow}, not ${form.flow}.`,
        );
      }
      const sourceDir =
        who.start.kind === 'about-repository'
          ? who.start.folder
          : who.start.kind === 'from-repository'
            ? (who.setup.source?.sourceDir ?? null)
            : null;
      return coreInput(form, who.setup.parentDir ?? '', sourceDir);
    }

    /** The signed-in account and its organisations, with the default owner from the last run. */
    async function ownersOf(runner: CommandRunner): Promise<SpaceSetupOwners> {
      const owners = await all.owners(deps, runner);
      const defaults = readSetupDefaults(all.defaultsFile(deps));
      const known = [owners.account, ...owners.organisations].filter(
        (value): value is string => value !== null,
      );
      const defaultOwner =
        defaults.owner !== null && known.includes(defaults.owner) ? defaults.owner : owners.account;
      return { ...owners, defaultOwner };
    }

    /**
     * The local, GitHub-free look at the form's target folder, or `null` when
     * the form does not give a folder yet, or (create, adopt) when the owner
     * or the name is empty, or (open) when the address does not parse.
     */
    async function targetOf(core: CoreInput): Promise<ExistingSpace | null> {
      const spaceRoot = spaceRootOf(core);
      if (spaceRoot === null) return null;
      let name: string | undefined;
      let repository: string;
      if (core.flow === 'open') {
        const parsed = parseGitHubAddress(core.input.address);
        if (parsed === null) return null;
        repository = parsed.fullName;
      } else {
        const { owner, name: spaceName } = core.input;
        if (owner === '' || spaceName === '') return null;
        name = spaceName;
        repository = `${owner}/${spaceName}`;
      }
      const made = await setupDeps();
      if (!made.ok) return null;
      return inspectExistingSpace({ flow: core.flow, spaceRoot, name, repository }, made.value);
    }

    async function setupDeps(): Promise<Result<SetupDeps>> {
      const template = all.templateDir();
      if (!template.ok) return template;
      const runner = await all.runner(deps);
      return {
        ok: true,
        value: {
          runner,
          github: await all.github(runner, deps),
          templateDir: template.value,
          userDataDir: deps.space.userDataDir(),
          checkMachine: () => all.checkMachine(deps, runner),
          ...(all.gitConfig === undefined ? {} : { gitConfig: all.gitConfig }),
        },
      };
    }

    function thrown(caught: unknown): { ok: false; error: SpaceSetupFailure } {
      const message = caught instanceof Error ? caught.message : String(caught);
      deps.space.log.error('setup-threw', { message });
      return refusal('setup-threw', `Setup stopped on an error of the companion: ${message}`);
    }

    reg.handle('spaceSetupState', async (event, arg): Promise<SpaceSetupStateResult> => {
      const who = asked(event);
      if ('ok' in who) return who;
      const parsed = parseArg(emptySchema, arg);
      if (!parsed.ok) return refusal(parsed.error.kind, parsed.error.message);
      const about = who.start.kind === 'about-repository' ? who.start : null;
      try {
        const runner = await all.runner(deps);
        const owners = await ownersOf(runner);
        return {
          ok: true,
          value: {
            flow: flowOfStart(who.start),
            parentDir: who.setup.parentDir,
            sourceDir: about?.folder ?? null,
            originUrl:
              about === null || about.originUrl === null
                ? null
                : redactCredentials(about.originUrl),
            source: who.setup.source,
            owners,
            spacesFolder: all.spacesFolder(deps),
            running: who.setup.running !== null,
            interrupted,
          },
        };
      } catch (caught) {
        return thrown(caught);
      }
    });

    reg.handle(
      'spaceSetupChooseFolder',
      async (event, arg): Promise<SpaceSetupChooseFolderResult> => {
        const who = asked(event);
        if ('ok' in who) return who;
        const parsed = parseArg(emptySchema, arg);
        if (!parsed.ok) return refusal(parsed.error.kind, parsed.error.message);
        if (who.setup.running !== null) {
          return refusal('already-running', 'The folder cannot be changed while a run goes on.');
        }
        try {
          const folder = await all.pickFolder(
            who.record.window,
            'Choose the folder the Space is created in',
          );
          if (folder === null) return refusal('cancelled', 'No folder was chosen.');
          if (!isFolder(folder)) return refusal('not-a-folder', `${folder} is not a folder.`);
          who.setup.parentDir = resolve(folder);
          who.setup.planned = null;
          who.setup.preview = null;
          who.setup.completeRoot = null;
          return { ok: true, value: { parentDir: who.setup.parentDir } };
        } catch (caught) {
          return thrown(caught);
        }
      },
    );

    reg.handle(
      'spaceSetupChooseSource',
      async (event, arg): Promise<SpaceSetupChooseSourceResult> => {
        const who = asked(event);
        if ('ok' in who) return who;
        const parsed = parseArg(emptySchema, arg);
        if (!parsed.ok) return refusal(parsed.error.kind, parsed.error.message);
        if (who.start.kind !== 'from-repository') {
          return refusal(
            'not-allowed-here',
            'Choosing a repository is only for "Space from a repository on this computer".',
          );
        }
        if (who.setup.running !== null) {
          return refusal(
            'already-running',
            'The repository cannot be changed while a run goes on.',
          );
        }
        try {
          const folder = await all.pickFolder(
            who.record.window,
            'Choose the folder of the repository',
          );
          if (folder === null) return refusal('cancelled', 'No folder was chosen.');
          const runner = await all.runner(deps);
          const git = createGitPort(runner);
          const top = await git.topLevel(folder);
          if (!top.ok || top.value === null || resolve(top.value) !== resolve(folder)) {
            return refusal('not-a-repository', `${folder} is not a git repository.`);
          }
          const origin = await git.originUrl(folder);
          if (!origin.ok || origin.value === null) {
            return refusal(
              'no-origin',
              `${folder} has no remote named origin. Push it to GitHub first.`,
            );
          }
          const sourceDir = resolve(folder);
          const source: SpaceSetupSource = {
            sourceDir,
            originUrl: redactCredentials(origin.value),
            github: parseGitHubAddress(origin.value)?.fullName ?? null,
            name: basename(sourceDir),
          };
          who.setup.source = source;
          who.setup.planned = null;
          who.setup.preview = null;
          who.setup.completeRoot = null;
          return { ok: true, value: source };
        } catch (caught) {
          return thrown(caught);
        }
      },
    );

    reg.handle('spaceSetupValidate', async (event, arg): Promise<SpaceSetupValidateResult> => {
      const who = asked(event);
      if ('ok' in who) return who;
      const parsed = parseArg(formSchema, arg);
      if (!parsed.ok) return refusal(parsed.error.kind, parsed.error.message);
      const core = inputOf(who, parsed.value);
      if ('ok' in core) return core;
      try {
        const problems = setupFormProblems(core, parsed.value);
        const target = await targetOf(core);
        who.setup.preview = target;
        return { ok: true, value: { problems, target } };
      } catch (caught) {
        return thrown(caught);
      }
    });

    reg.handle('spaceSetupPlan', async (event, arg): Promise<SpaceSetupPlanResult> => {
      const who = asked(event);
      if ('ok' in who) return who;
      const parsed = parseArg(formSchema, arg);
      if (!parsed.ok) return refusal(parsed.error.kind, parsed.error.message);
      const core = inputOf(who, parsed.value);
      if ('ok' in core) return core;
      who.setup.planned = null;
      who.setup.planAsked += 1;
      const mine = who.setup.planAsked;
      who.setup.planId += 1;
      const { planId } = who.setup;
      const { window } = who.record;
      let lastRunningText: string | null = null;
      const onCheck = (progress: SetupCheckProgress): void => {
        lastRunningText = progress.state === 'running' ? progress.text : null;
        if (!window.isDestroyed()) {
          window.webContents.send(SPACE_SETUP_CONTRACT.onSpaceSetupPlanProgress.channel, {
            planId,
            ...progress,
          });
        }
      };
      try {
        const made = await setupDeps();
        if (!made.ok) return refusal(made.error.kind, made.error.message);
        const planCall =
          core.flow === 'create'
            ? planCreateSpace(core.input, made.value, { onCheck })
            : core.flow === 'adopt'
              ? planAdoptRepository(core.input, made.value, { onCheck })
              : planOpenSpaceByAddress(core.input, made.value, { onCheck });
        const timedOut = Symbol('setup-plan-timeout');
        const timer = new Promise<typeof timedOut>((resolveTimer) => {
          setTimeout(() => resolveTimer(timedOut), all.planTimeLimitMs);
        });
        const raced = await Promise.race([planCall, timer]);
        if (raced === timedOut) {
          deps.space.log.warn('setup-plan-timeout', { flow: core.flow });
          const message =
            lastRunningText === null
              ? 'GitHub did not answer within 60 seconds. Nothing was created.'
              : `The check "${lastRunningText}" did not answer within 60 seconds. Nothing was created.`;
          return refusal('plan-timeout', message);
        }
        const planned = raced;
        if (!planned.ok) {
          deps.space.log.info('setup-plan-refused', { flow: core.flow, kind: planned.error.kind });
          return fromCore(planned.error);
        }
        if (mine !== who.setup.planAsked) {
          return refusal('superseded', 'A newer request for the plan replaced this one.');
        }
        if (planned.value.complete) who.setup.completeRoot = planned.value.spaceRoot;
        const token = randomUUID();
        who.setup.planned = { token, core, form: parsed.value };
        return {
          ok: true,
          value: { plan: planned.value, github: gitHubNames(core, planned.value), token },
        };
      } catch (caught) {
        return thrown(caught);
      }
    });

    reg.handle('spaceSetupRun', async (event, arg): Promise<SpaceSetupRunResult> => {
      const who = asked(event);
      if ('ok' in who) return who;
      const parsed = parseArg(runSchema, arg);
      if (!parsed.ok) return refusal(parsed.error.kind, parsed.error.message);
      const { planned } = who.setup;
      if (planned === null || planned.token !== parsed.value.token) {
        deps.space.log.warn('setup-run-refused', { reason: 'not-planned' });
        return refusal(
          'not-planned',
          "Nothing was run: this is not the plan on this window's screen. Ask for the plan again, read it, and confirm it.",
        );
      }
      const { repositories } = parsed.value;
      if (repositories !== undefined && planned.core.flow !== 'open') {
        return refusal(
          'invalid-argument',
          'Only opening a Space by address takes the repositories to clone when it runs.',
        );
      }
      const core: CoreInput =
        planned.core.flow === 'open' && repositories !== undefined
          ? { flow: 'open', input: { ...planned.core.input, repositories } }
          : planned.core;
      if (who.setup.running !== null) {
        return refusal('already-running', 'A run of this window goes on. Stop it, or wait for it.');
      }
      const controller = new AbortController();
      who.setup.running = controller;
      who.setup.report = null;
      const { window } = who.record;
      const options: SetupRunOptions = {
        signal: controller.signal,
        onProgress: (progress: StepProgress) => {
          deps.space.log.info('setup-step', {
            flow: core.flow,
            step: progress.stepId,
            state: progress.state,
            ...(progress.message === null ? {} : { message: progress.message }),
          });
          // A closed window stops the run before its next step; the step that runs finishes.
          if (window.isDestroyed()) controller.abort();
          else window.webContents.send(SPACE_SETUP_CONTRACT.onSpaceSetupProgress.channel, progress);
        },
      };
      try {
        const made = await setupDeps();
        if (!made.ok) return refusal(made.error.kind, made.error.message);
        deps.space.log.info('setup-run-started', { flow: core.flow });
        const ran =
          core.flow === 'create'
            ? await createSpace(core.input, made.value, options)
            : core.flow === 'adopt'
              ? await adoptRepository(core.input, made.value, options)
              : await openSpaceByAddress(core.input, made.value, options);
        if (!ran.ok) {
          deps.space.log.warn('setup-run-stopped', {
            flow: core.flow,
            kind: ran.error.kind,
            step: ran.error.stepId ?? '',
          });
          const spaceRoot = spaceRootOf(core);
          if (window.isDestroyed() && spaceRoot !== null) {
            interrupted = { flow: core.flow, spaceRoot, form: planned.form };
          }
          return fromCore(ran.error);
        }
        deps.space.log.info('setup-run-finished', { flow: core.flow, root: ran.value.spaceRoot });
        who.setup.report = ran.value;
        if (interrupted?.spaceRoot === ran.value.spaceRoot) interrupted = null;
        if (core.flow === 'create' || core.flow === 'adopt') {
          writeSetupDefaults(all.defaultsFile(deps), core.input.owner);
        }
        return ran;
      } catch (caught) {
        return thrown(caught);
      } finally {
        who.setup.running = null;
      }
    });

    reg.handle('spaceSetupStop', (event, arg): SpaceSetupStopResult => {
      const who = asked(event);
      if ('ok' in who) return who;
      const parsed = parseArg(emptySchema, arg);
      if (!parsed.ok) return refusal(parsed.error.kind, parsed.error.message);
      const { running } = who.setup;
      running?.abort();
      return { ok: true, value: { stopping: running !== null } };
    });

    reg.handle('spaceSetupOpenSpace', async (event, arg): Promise<SpaceWindowResult> => {
      const who = asked(event);
      if ('ok' in who) {
        const kind = who.error.kind === 'not-a-space-window' ? who.error.kind : 'not-allowed-here';
        return { ok: false, error: { kind, message: who.error.message } };
      }
      const parsed = parseArg(emptySchema, arg);
      if (!parsed.ok) return parsed;
      const { report, completeRoot } = who.setup;
      const root = report?.spaceRoot ?? completeRoot;
      if (root === null || root === undefined) {
        return {
          ok: false,
          error: {
            kind: 'not-allowed-here',
            message: 'No run of this window reached its end, so there is no Space to open yet.',
          },
        };
      }
      const opened = await deps.space.openFolder(who.record.window, root, {
        justCreated: report !== null,
      });
      if (opened.ok) held.delete(who.record.window.id);
      return opened;
    });

    reg.handle('spaceSetupOpenExisting', async (event, arg): Promise<SpaceWindowResult> => {
      const who = asked(event);
      if ('ok' in who) {
        const kind = who.error.kind === 'not-a-space-window' ? who.error.kind : 'not-allowed-here';
        return { ok: false, error: { kind, message: who.error.message } };
      }
      const parsed = parseArg(emptySchema, arg);
      if (!parsed.ok) return parsed;
      const { preview } = who.setup;
      if (preview === null || (preview.state !== 'complete' && preview.state !== 'incomplete')) {
        return {
          ok: false,
          error: {
            kind: 'not-allowed-here',
            message: 'No folder was found here to open as a Space.',
          },
        };
      }
      const opened = await deps.space.openFolder(who.record.window, preview.spaceRoot);
      if (opened.ok) held.delete(who.record.window.id);
      return opened;
    });

    reg.handle('spaceSetupListSpaces', async (event, arg): Promise<SpaceSetupListSpacesResult> => {
      const who = asked(event);
      if ('ok' in who) return who;
      const parsed = parseArg(ownerSchema, arg);
      if (!parsed.ok) return refusal(parsed.error.kind, parsed.error.message);
      try {
        const runner = await all.runner(deps);
        const owners = await all.owners(deps, runner);
        const known = [owners.account, ...owners.organisations].filter(
          (value): value is string => value !== null,
        );
        if (!known.includes(parsed.value.owner)) {
          return refusal(
            'unknown-owner',
            `${parsed.value.owner} is not the signed-in account or one of its organisations.`,
          );
        }
        const github = await all.github(runner, deps);
        const listed = await github.listSpaceRepositories(parsed.value.owner);
        if (!listed.ok) return refusal(listed.error.kind, listed.error.message);
        return {
          ok: true,
          value: {
            repositories: listed.value.map((repository) => ({
              fullName: repository.fullName,
              url: repository.url,
              private: repository.private,
            })),
          },
        };
      } catch (caught) {
        return thrown(caught);
      }
    });
  };
}

/** The register module of creating a Space, as the module list holds it. */
export const registerSpaceSetup: RegisterModule = createSpaceSetupRegister();
