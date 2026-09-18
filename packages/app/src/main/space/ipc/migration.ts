/**
 * The handlers of migration from v0.8 (`shared/ipc/space/migration.contract.ts`),
 * phase M6.5. They serve core's `planMigration` and `runMigration`.
 *
 * A migration window has no Space yet, so it has no `SpaceContext`. What main
 * holds for it is kept here, by window id: the folder chosen in main's own
 * dialog, the last plan and its token, the run that goes on, the last report.
 *
 * The renderer sends no folder. The v0.8 project is the folder main recorded
 * for the window (`deps.space.windowFor(event).folder`); the folder the Space
 * is made in comes from the dialog this module opens, or is core's proposal.
 *
 * A run creates a repository, a Project and issues on GitHub, so it runs only
 * a plan the Human Lead was shown. `spaceMigrationPlan` keeps the values the
 * plan was made with, the proposed ones included, and returns a token when the
 * plan is ready; `spaceMigrationRun` takes that token, not a form, and runs the
 * kept values. A run with no plan, with the token of an older plan or of
 * another window, after another folder was chosen, or while a run of this
 * window, of this folder or into the same new Space folder goes on, is refused.
 *
 * The source is only read: core reads it with read functions and git read
 * commands, and step 13 checks that both source repositories are unchanged.
 */

import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type CommandRunner,
  type GitHubPort,
  type MachineCheck,
  type MigrationDeps,
  type MigrationFailure,
  type MigrationForm,
  type MigrationPlan,
  type Result,
  planMigration,
  redactCredentials,
  runMigration,
} from '@ai-lore-companion/core';
import { z } from 'zod';
import type {
  MigrationIssueProgress,
  SpaceMigrationChooseFolderResult,
  SpaceMigrationFailure,
  SpaceMigrationForm,
  SpaceMigrationInterrupted,
  SpaceMigrationPlanResult,
  SpaceMigrationRunResult,
  SpaceMigrationStateResult,
  SpaceMigrationStopResult,
  SpaceWindowResult,
  StepProgress,
} from '../../../shared/ipc.js';
import { SPACE_MIGRATION_CONTRACT } from '../../../shared/ipc/space/migration.contract.js';
import { loadEngines } from '../../engines.js';
import type { Deps, RegisterModule } from '../../ipc/types.js';
import { checkMachineOfApp } from '../e2e-machine.js';
import { createAppGitHubPort } from '../github-service.js';
import type { SpaceIpcEvent } from '../host.js';
import { loreTemplateDir } from '../template-dir.js';
import type { SpaceWindowLike, SpaceWindowRecord } from '../windows.js';
import { readLoginShellPath, validLoginShell } from './machine.js';
import { runnerWithPath } from './setup.js';
import { parseArg } from './validate.js';

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
export type SpaceMigrationParts = {
  /** The Lore template. Default: `loreTemplateDir` of `main/space/template-dir.ts`. */
  templateDir: () => Result<string>;
  /** The system's folder dialog; `null` when it was cancelled. Default: Electron's. */
  pickFolder: (window: SpaceWindowLike, title: string) => Promise<string | null>;
  /** The runner of a plan or a run. Default: `deps.space.runner` with the login shell's `PATH`. */
  runner: (deps: Deps) => Promise<CommandRunner>;
  /** The GitHub port on that runner. Default: `createAppGitHubPort`, the one setup uses. */
  github: (runner: CommandRunner, deps: Deps) => GitHubPort | Promise<GitHubPort>;
  /** The machine check of step 2. Default: core's, with the app's engines. */
  checkMachine: (deps: Deps, runner: CommandRunner) => Promise<MachineCheck>;
  /** Values for the new repository's own git configuration. Default: none. */
  gitConfig: Readonly<Record<string, string>> | undefined;
  /** The pause between two GitHub writes of step 11. Default: core's timer. */
  pause: ((ms: number) => Promise<void>) | undefined;
};

const DEFAULT_PARTS: SpaceMigrationParts = {
  templateDir: () => loreTemplateDir(),
  pickFolder: pickFolderWithDialog,
  runner: async (deps) => {
    const shell = validLoginShell(process.env.SHELL ?? '/bin/zsh');
    const path = await readLoginShellPath(deps.space.runner, shell, process.platform);
    return runnerWithPath(deps.space.runner, path);
  },
  github: (runner, deps) => createAppGitHubPort({ runner, log: deps.space.log }),
  checkMachine: (deps, runner) =>
    checkMachineOfApp(runner, loadEngines(deps.space.userDataDir()), {
      platform: process.platform,
    }),
  gitConfig: undefined,
  pause: undefined,
};

const text = (max: number) => z.string().max(max);
const formSchema = z.strictObject({
  name: text(300).optional(),
  owner: text(200).optional(),
  description: text(20_000).optional(),
  focusStage: z.enum(['Spec', 'Plan', 'Build', 'Review', 'Done']).optional(),
  payloadGitHub: text(500).optional(),
  private: z.boolean(),
});
const emptySchema = z.strictObject({});
const runSchema = z.strictObject({ token: text(100) });

function refusal(kind: string, message: string): { ok: false; error: SpaceMigrationFailure } {
  return { ok: false, error: { kind, message, stepId: null, refusal: null, problems: [] } };
}

function fromCore(failure: MigrationFailure): { ok: false; error: SpaceMigrationFailure } {
  return {
    ok: false,
    error: {
      kind: failure.kind,
      message: failure.message,
      stepId: failure.stepId,
      refusal: failure.refusal,
      problems: failure.problems,
    },
  };
}

/** A text the Human Lead left blank is left out, so that core proposes it. */
function given(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/** Core's form from the screen's form and the folder main holds. */
function coreForm(form: SpaceMigrationForm, parentDir: string | null): MigrationForm {
  const out: MigrationForm = { private: form.private };
  if (parentDir !== null) out.parentDir = parentDir;
  const name = given(form.name);
  const owner = given(form.owner);
  const payloadGitHub = given(form.payloadGitHub);
  if (name !== undefined) out.name = name;
  if (owner !== undefined) out.owner = owner;
  if (payloadGitHub !== undefined) out.payloadGitHub = payloadGitHub;
  if (form.description !== undefined && form.description.trim() !== '') {
    out.description = form.description;
  }
  if (form.focusStage !== undefined) out.focusStage = form.focusStage;
  return out;
}

/**
 * The values a ready plan was made with, the proposed ones included, as the
 * form a run is given. A run then uses what the Human Lead saw, even when a
 * proposal (the signed-in account, the folder) would come out differently later.
 */
function boundForm(plan: MigrationPlan, form: MigrationForm): MigrationForm {
  const value = (id: string): string | undefined => {
    const field = plan.fields.find((candidate) => candidate.id === id);
    return field === undefined || field.value === '' ? undefined : field.value;
  };
  const bound: MigrationForm = { ...form };
  const parentDir = value('parentDir');
  const name = value('name');
  const owner = value('owner');
  const description = value('description');
  const payloadGitHub = value('payloadGitHub');
  const focusStage = value('focusStage');
  if (parentDir !== undefined) bound.parentDir = parentDir;
  if (name !== undefined) bound.name = name;
  if (owner !== undefined) bound.owner = owner;
  if (description !== undefined) bound.description = description;
  if (payloadGitHub !== undefined) bound.payloadGitHub = payloadGitHub;
  if (
    focusStage === 'Spec' ||
    focusStage === 'Plan' ||
    focusStage === 'Build' ||
    focusStage === 'Review' ||
    focusStage === 'Done'
  ) {
    bound.focusStage = focusStage;
  }
  return bound;
}

/** The plan as the screen gets it: the origin addresses without credentials. */
function shown(plan: MigrationPlan): MigrationPlan {
  const clean = (url: string | null): string | null =>
    url === null ? null : redactCredentials(url);
  return {
    ...plan,
    source: {
      ...plan.source,
      payloadRepository: {
        ...plan.source.payloadRepository,
        originUrl: clean(plan.source.payloadRepository.originUrl),
      },
      loreRepository: {
        ...plan.source.loreRepository,
        originUrl: clean(plan.source.loreRepository.originUrl),
      },
    },
  };
}

function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** What main holds for one migration window. */
type WindowMigration = {
  /** The payload the window was last told; a new one means the screen was started again. */
  init: SpaceWindowRecord['init'];
  parentDir: string | null;
  /**
   * The last ready plan main made for this window and sent with its token:
   * the values a run uses. A new request for a plan, or another folder, drops it.
   */
  planned: { token: string; form: MigrationForm; spaceRoot: string } | null;
  /** Counts the requests for a plan; only the last one may leave its plan. */
  planAsked: number;
  running: AbortController | null;
  report: { spaceRoot: string } | null;
};

/** Build the register module of migration. */
export function createSpaceMigrationRegister(
  parts: Partial<SpaceMigrationParts> = {},
): RegisterModule {
  const all: SpaceMigrationParts = { ...DEFAULT_PARTS, ...parts };
  return (reg, deps) => {
    const held = new Map<number, { window: SpaceWindowLike; migration: WindowMigration }>();
    /** The source folders whose migration runs, with the id of the window that runs it. */
    const runningSources = new Map<string, number>();
    /** The new Space folders a run makes: two sources may not be migrated into one folder at once. */
    const runningTargets = new Set<string>();
    /** By source folder: the last run that ended because its window was closed. */
    const interrupted = new Map<string, SpaceMigrationInterrupted>();

    type Asked = { record: SpaceWindowRecord; sourceRoot: string; migration: WindowMigration };

    /** The migration window that asks and what is held for it, or the refusal. */
    function asked(event: SpaceIpcEvent): Asked | { ok: false; error: SpaceMigrationFailure } {
      for (const [id, entry] of held) {
        if (entry.window.isDestroyed() && entry.migration.running === null) held.delete(id);
      }
      const record = deps.space.windowFor(event);
      if (!record) {
        return refusal(
          'not-a-space-window',
          'The request did not come from an AI-Lore 1.0 window.',
        );
      }
      if (record.init.mode !== 'migration' || record.folder === null) {
        return refusal('not-allowed-here', 'Migration runs from the migration screen.');
      }
      let entry = held.get(record.window.id);
      if (
        entry === undefined ||
        (entry.migration.init !== record.init && entry.migration.running === null)
      ) {
        entry = {
          window: record.window,
          migration: {
            init: record.init,
            parentDir: null,
            planned: null,
            planAsked: 0,
            running: null,
            report: null,
          },
        };
        held.set(record.window.id, entry);
      }
      return { record, sourceRoot: record.folder, migration: entry.migration };
    }

    async function migrationDeps(window: SpaceWindowLike | null): Promise<Result<MigrationDeps>> {
      const template = all.templateDir();
      if (!template.ok) return template;
      const runner = await all.runner(deps);
      const made: MigrationDeps = {
        runner,
        github: await all.github(runner, deps),
        templateDir: template.value,
        userDataDir: deps.space.userDataDir(),
        checkMachine: () => all.checkMachine(deps, runner),
        ...(all.gitConfig === undefined ? {} : { gitConfig: all.gitConfig }),
        ...(all.pause === undefined ? {} : { pause: all.pause }),
      };
      // Step 11 gives each issue's progress to `MigrationDeps.onIssueProgress`; a plan has no window.
      if (window !== null) {
        made.onIssueProgress = (progress: MigrationIssueProgress) => {
          if (!window.isDestroyed()) {
            window.webContents.send(
              SPACE_MIGRATION_CONTRACT.onSpaceMigrationIssueProgress.channel,
              progress,
            );
          }
        };
      }
      return { ok: true, value: made };
    }

    function thrown(caught: unknown): { ok: false; error: SpaceMigrationFailure } {
      const message = caught instanceof Error ? caught.message : String(caught);
      deps.space.log.error('migration-threw', { message });
      return refusal(
        'migration-threw',
        `Migration stopped on an error of the companion: ${message}`,
      );
    }

    reg.handle('spaceMigrationState', (event, arg): SpaceMigrationStateResult => {
      const who = asked(event);
      if ('ok' in who) return who;
      const parsed = parseArg(emptySchema, arg);
      if (!parsed.ok) return refusal(parsed.error.kind, parsed.error.message);
      const runner = runningSources.get(who.sourceRoot);
      return {
        ok: true,
        value: {
          sourceRoot: who.sourceRoot,
          parentDir: who.migration.parentDir,
          running: who.migration.running !== null,
          runningElsewhere: runner !== undefined && runner !== who.record.window.id,
          interrupted: interrupted.get(who.sourceRoot) ?? null,
        },
      };
    });

    reg.handle(
      'spaceMigrationChooseFolder',
      async (event, arg): Promise<SpaceMigrationChooseFolderResult> => {
        const who = asked(event);
        if ('ok' in who) return who;
        const parsed = parseArg(emptySchema, arg);
        if (!parsed.ok) return refusal(parsed.error.kind, parsed.error.message);
        if (who.migration.running !== null) {
          return refusal('already-running', 'The folder cannot be changed while a run goes on.');
        }
        try {
          const folder = await all.pickFolder(
            who.record.window,
            "Choose the folder the new Space's folder is made in",
          );
          if (folder === null) return refusal('cancelled', 'No folder was chosen.');
          if (!isFolder(folder)) return refusal('not-a-folder', `${folder} is not a folder.`);
          who.migration.parentDir = resolve(folder);
          who.migration.planned = null;
          // A plan still being made was made with the folder before: it may not leave a token.
          who.migration.planAsked += 1;
          return { ok: true, value: { parentDir: who.migration.parentDir } };
        } catch (caught) {
          return thrown(caught);
        }
      },
    );

    reg.handle('spaceMigrationPlan', async (event, arg): Promise<SpaceMigrationPlanResult> => {
      const who = asked(event);
      if ('ok' in who) return who;
      const parsed = parseArg(formSchema, arg);
      if (!parsed.ok) return refusal(parsed.error.kind, parsed.error.message);
      if (who.migration.running !== null) {
        return refusal('already-running', 'A run of this window goes on. Stop it, or wait for it.');
      }
      who.migration.planned = null;
      who.migration.planAsked += 1;
      const mine = who.migration.planAsked;
      const form = coreForm(parsed.value, who.migration.parentDir);
      try {
        const made = await migrationDeps(null);
        if (!made.ok) return refusal(made.error.kind, made.error.message);
        const planned = await planMigration({ sourceRoot: who.sourceRoot, form }, made.value);
        if (!planned.ok) {
          deps.space.log.info('migration-plan-refused', { kind: planned.error.kind });
          return fromCore(planned.error);
        }
        if (mine !== who.migration.planAsked) {
          return refusal('superseded', 'A newer request for the plan replaced this one.');
        }
        const plan = planned.value;
        let token: string | null = null;
        if (plan.ready && plan.spaceRoot !== null) {
          token = randomUUID();
          who.migration.planned = {
            token,
            form: boundForm(plan, form),
            spaceRoot: plan.spaceRoot,
          };
        }
        return { ok: true, value: { plan: shown(plan), token } };
      } catch (caught) {
        return thrown(caught);
      }
    });

    reg.handle('spaceMigrationRun', async (event, arg): Promise<SpaceMigrationRunResult> => {
      const who = asked(event);
      if ('ok' in who) return who;
      const parsed = parseArg(runSchema, arg);
      if (!parsed.ok) return refusal(parsed.error.kind, parsed.error.message);
      const { planned } = who.migration;
      if (planned === null || planned.token !== parsed.value.token) {
        deps.space.log.warn('migration-run-refused', { reason: 'not-planned' });
        return refusal(
          'not-planned',
          "Nothing was run: this is not the plan on this window's screen. Ask for the plan again, read it, and confirm it.",
        );
      }
      if (who.migration.running !== null) {
        return refusal('already-running', 'A run of this window goes on. Stop it, or wait for it.');
      }
      if (runningSources.has(who.sourceRoot)) {
        return refusal(
          'already-running',
          'A migration of this folder runs in another window. Wait for it to end.',
        );
      }
      const target = resolve(planned.spaceRoot);
      if (runningTargets.has(target)) {
        return refusal(
          'already-running',
          `Another migration makes ${planned.spaceRoot} in another window. Wait for it to end, or choose another name or folder.`,
        );
      }
      const controller = new AbortController();
      who.migration.running = controller;
      who.migration.report = null;
      const { window } = who.record;
      runningSources.set(who.sourceRoot, window.id);
      runningTargets.add(target);
      let lastStep: string | null = null;
      const onProgress = (progress: StepProgress) => {
        lastStep = progress.stepId;
        deps.space.log.info('migration-step', {
          step: progress.stepId,
          state: progress.state,
          ...(progress.message === null ? {} : { message: progress.message }),
        });
        // A closed window stops the run before its next step; the step that runs finishes.
        if (window.isDestroyed()) controller.abort();
        else
          window.webContents.send(
            SPACE_MIGRATION_CONTRACT.onSpaceMigrationProgress.channel,
            progress,
          );
      };
      try {
        const made = await migrationDeps(window);
        if (!made.ok) return refusal(made.error.kind, made.error.message);
        deps.space.log.info('migration-run-started', { root: planned.spaceRoot });
        const ran = await runMigration(
          { sourceRoot: who.sourceRoot, form: planned.form },
          made.value,
          { signal: controller.signal, onProgress },
        );
        if (!ran.ok) {
          deps.space.log.warn('migration-run-stopped', {
            kind: ran.error.kind,
            step: ran.error.stepId ?? '',
          });
          if (window.isDestroyed()) {
            interrupted.set(who.sourceRoot, {
              spaceRoot: planned.spaceRoot,
              stepId: ran.error.stepId ?? lastStep,
            });
          }
          return fromCore(ran.error);
        }
        deps.space.log.info('migration-run-finished', { root: ran.value.spaceRoot });
        who.migration.report = { spaceRoot: ran.value.spaceRoot };
        interrupted.delete(who.sourceRoot);
        return ran;
      } catch (caught) {
        if (window.isDestroyed()) {
          interrupted.set(who.sourceRoot, { spaceRoot: planned.spaceRoot, stepId: lastStep });
        }
        return thrown(caught);
      } finally {
        who.migration.running = null;
        runningSources.delete(who.sourceRoot);
        runningTargets.delete(target);
      }
    });

    reg.handle('spaceMigrationStop', (event, arg): SpaceMigrationStopResult => {
      const who = asked(event);
      if ('ok' in who) return who;
      const parsed = parseArg(emptySchema, arg);
      if (!parsed.ok) return refusal(parsed.error.kind, parsed.error.message);
      const { running } = who.migration;
      running?.abort();
      return { ok: true, value: { stopping: running !== null } };
    });

    reg.handle('spaceMigrationOpenSpace', async (event, arg): Promise<SpaceWindowResult> => {
      const who = asked(event);
      if ('ok' in who) {
        const kind = who.error.kind === 'not-a-space-window' ? who.error.kind : 'not-allowed-here';
        return { ok: false, error: { kind, message: who.error.message } };
      }
      const parsed = parseArg(emptySchema, arg);
      if (!parsed.ok) return parsed;
      const { report } = who.migration;
      if (report === null) {
        return {
          ok: false,
          error: {
            kind: 'not-allowed-here',
            message:
              'No migration of this window reached its end, so there is no Space to open yet.',
          },
        };
      }
      const opened = await deps.space.openFolder(who.record.window, report.spaceRoot);
      if (opened.ok) held.delete(who.record.window.id);
      return opened;
    });
  };
}

/** The register module of migration, as the module list holds it. */
export const registerSpaceMigration: RegisterModule = createSpaceMigrationRegister();
