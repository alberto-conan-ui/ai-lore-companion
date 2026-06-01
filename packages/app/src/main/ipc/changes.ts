import { isAbsolute, join, relative, resolve } from 'node:path';
import { findDiffApp, isChainError, latestSavePoint, readDiffText } from '@ai-lore-companion/core';
import type {
  DiffTextArg,
  DiffTextResult,
  OpenDiffArg,
  OpenDiffResult,
  SetBaselineArg,
} from '../../shared/ipc.js';
import { launchDiff, materialiseBaseline } from '../diff.js';
import { projectToRepoRelative } from '../path-mapping.js';
import { loadGlobalSettings } from '../settings.js';
import type { RegisterModule } from './types.js';

/** Changes panel — flip baseline, read inline diff text, open external diff. */
export const registerChanges: RegisterModule = (reg, deps) => {
  reg.handle('setBaseline', (event, arg: SetBaselineArg) => {
    const ctx = deps.contextFor(event);
    if (!ctx?.wiring || isChainError(ctx.chain)) return;
    ctx.wiring.changes.setBaseline(arg.scope, arg.baseline);
    // setBaseline triggers an immediate tracker re-read, which fires onChange,
    // which pushes Changes + CommitList. No separate push needed here.
  });

  reg.handle('diffText', (event, arg: DiffTextArg): DiffTextResult => {
    const ctx = deps.contextFor(event);
    if (!ctx || isChainError(ctx.chain)) {
      return { kind: 'failed', message: 'no project context' };
    }
    const loreWorkingTree = join(ctx.chain.lorePath, 'memory');
    const workingTreeRoot = arg.scope === 'payload' ? ctx.root : loreWorkingTree;
    // Renderer sends project-relative paths; un-rebase the lore prefix so git
    // diff sees a path relative to the repo's working tree root.
    const repoRelPath = projectToRepoRelative(arg.scope, arg.relPath, ctx.root, loreWorkingTree);
    if (repoRelPath.startsWith('..') || isAbsolute(repoRelPath)) {
      return { kind: 'failed', message: 'path is outside the repo working tree' };
    }
    const result = readDiffText(workingTreeRoot, arg.baseline, repoRelPath);
    return result.kind === 'ok'
      ? { kind: 'ok', text: result.text }
      : { kind: 'failed', message: result.message };
  });

  reg.handle('openDiff', (event, arg: OpenDiffArg): OpenDiffResult => {
    const ctx = deps.contextFor(event);
    if (!ctx || isChainError(ctx.chain)) {
      return { kind: 'failed', message: 'no project context' };
    }
    const apps = loadGlobalSettings(deps.getUserDataDir()).apps ?? [];
    const diff = findDiffApp(apps);
    if (!diff || !diff.cliPath || !diff.argvTemplate) {
      return { kind: 'no-cli' };
    }
    const cli = diff.cliPath;
    const template = diff.argvTemplate;
    // Per-repo working tree. The lore repo's .git/ lives at
    // <lorePath>/memory/.git/, so its working tree root is <lorePath>/memory/.
    const workingTreeRoot =
      arg.scope === 'payload' ? ctx.root : resolve(ctx.chain.lorePath, 'memory');
    // Resolve the baseline commit. `'HEAD'` falls back to the latest save-point
    // — diffing working-tree-vs-HEAD opens an empty diff in the external app
    // when the file is unmodified, which is rarely what the user wants when
    // they ask for a Diff on a row.
    let commit: string;
    if (arg.baseline === 'HEAD') {
      const savePoint = latestSavePoint(resolve(ctx.chain.lorePath, 'memory/save-points'));
      if (!savePoint) return { kind: 'no-save-point' };
      commit = arg.scope === 'payload' ? savePoint.payloadCommit : savePoint.loreCommit;
    } else {
      commit = arg.baseline;
    }
    // Paths arrive project-relative; refuse anything that escapes the project.
    const absFile = isAbsolute(arg.relPath) ? arg.relPath : resolve(ctx.root, arg.relPath);
    const rootRel = relative(ctx.root, absFile);
    if (rootRel.startsWith('..') || isAbsolute(rootRel)) {
      return { kind: 'failed', message: 'path is outside the project' };
    }
    const gitRelPath = relative(workingTreeRoot, absFile);
    if (gitRelPath.startsWith('..') || isAbsolute(gitRelPath)) {
      return { kind: 'failed', message: 'path is outside the repo working tree' };
    }
    // For a renamed/copied entry the baseline content lives at the OLD path —
    // the new path does not exist at the commit, so materialising from it yields
    // an empty "before" and the external diff shows the file as new. Fall back to
    // the new path when there is no rename source.
    const baselineRel = arg.oldPath ?? arg.relPath;
    const absBaseline = isAbsolute(baselineRel) ? baselineRel : resolve(ctx.root, baselineRel);
    const baselineRootRel = relative(ctx.root, absBaseline);
    if (baselineRootRel.startsWith('..') || isAbsolute(baselineRootRel)) {
      return { kind: 'failed', message: 'rename source is outside the project' };
    }
    const baselineGitRelPath = relative(workingTreeRoot, absBaseline);
    if (baselineGitRelPath.startsWith('..') || isAbsolute(baselineGitRelPath)) {
      return { kind: 'failed', message: 'rename source is outside the repo working tree' };
    }
    const materialised = materialiseBaseline({
      workingTreeRoot,
      commit,
      gitRelPath: baselineGitRelPath,
    });
    if (materialised.kind === 'failed') {
      return materialised;
    }
    const launched = launchDiff({
      cli,
      template,
      baseline: materialised.tempPath,
      current: absFile,
    });
    if (launched.kind === 'failed') {
      return launched;
    }
    return { kind: 'ok', cli };
  });
};
