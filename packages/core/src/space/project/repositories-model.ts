/**
 * The Repositories section's model (architecture document, section 3.4;
 * stage D1). A pure function from the Space's roots, the root tracker's
 * snapshots, the baselines the tracker holds, the roots' default baselines
 * and a repository read per root, to one row per repository.
 *
 * Shaped like `dashboard-model.ts`: plain data in, plain data out, no git, no
 * clock, no file system. The same input gives the same rows.
 */

export type MirrorDrift = {
  path: string;
  state: 'matches' | 'differs' | 'not-checked' | 'no-mirror';
  added: number;
  removed: number;
  checkedAt: string | null;
};

export function mirrorDrift(arg: {
  path: string;
  stored: readonly string[];
  generated: readonly string[] | null;
  checkedAt: string | null;
}): MirrorDrift {
  if (arg.generated === null) {
    return { path: arg.path, state: 'not-checked', added: 0, removed: 0, checkedAt: arg.checkedAt };
  }
  const storedSet = new Set(arg.stored);
  let added = 0;
  for (const line of arg.generated) {
    if (!storedSet.has(line)) added++;
  }
  const generatedSet = new Set(arg.generated);
  let removed = 0;
  for (const line of arg.stored) {
    if (!generatedSet.has(line)) removed++;
  }
  return {
    path: arg.path,
    state: added === 0 && removed === 0 ? 'matches' : 'differs',
    added,
    removed,
    checkedAt: arg.checkedAt,
  };
}

import type { DefaultBaseline } from '../baseline/types.js';
import type {
  Root,
  RootGitOperation,
  RootHeadState,
  RootKind,
  RootRemoteComparison,
  RootRepositoryState,
  RootSnapshot,
  RootTracking,
} from '../roots/types.js';

/** What a repository read produced for one root, as the model takes it. */
export type RepositoryRead =
  | { status: 'ok'; state: RootRepositoryState }
  | { status: 'failed'; message: string };

/** What the model is computed from. Everything is plain data. */
export type RepositoriesModelInput = {
  /** The Space's roots, from `resolveRoots`, in their order. */
  roots: readonly Root[];
  /** The tracker's snapshot per root id. A root with no entry is still being read. */
  snapshots: Readonly<Record<string, RootSnapshot>>;
  /** The baseline the tracker holds per root id. */
  baselines: Readonly<Record<string, string>>;
  /** The root's default baseline per root id, or `null` when it could not be read. */
  defaults: Readonly<Record<string, DefaultBaseline | null>>;
  /** The repository read per root id. A root with no entry is still being read. */
  reads: Readonly<Record<string, RepositoryRead>>;
  /** `owner/name` per repository root, from the manifest. */
  github: Readonly<Record<string, string>>;
  /** The mirror drift per root id, if applicable. */
  mirrors: Readonly<Record<string, MirrorDrift>>;
};

/** What a row says about the changes of its root. */
export type RepositoryRowChanges = {
  /** Files that differ from the baseline, including those left out of the snapshot's list. */
  total: number;
  /**
   * Of the files the snapshot listed, those that are not committed. When
   * `truncated` is true this is a lower bound, because the snapshot's list was
   * cut and `RootChanges.uncommitted` names only listed paths.
   */
  uncommitted: number;
  /** Whether the snapshot's list was cut at its limit. */
  truncated: boolean;
  /** `'HEAD'` or a full commit SHA. */
  baseline: string;
  /**
   * Where the baseline came from. `picked` when the baseline the tracker holds
   * is not the root's default, which is a point the Human Lead chose in the
   * Files window.
   */
  baselineSource: 'reviewed-mark' | 'first-seen' | 'head' | 'picked';
  /** When the mark or the first-seen record was written; `null` for the other two. */
  baselineAt: string | null;
  /** Whether the baseline commit is `HEAD` or one of its ancestors; `null` when there is no commit. */
  baselineIsAncestor: boolean | null;
};

/** One row of the Repositories section. */
export type RepositoryRow = {
  /** The id of the root the row is named after. */
  rootId: string;
  kind: RootKind;
  /** The root's name; `lore` for the Lore. */
  name: string;
  /** The root's folder, absolute. */
  path: string;
  /** `owner/name` for a repository root whose manifest entry has one, else `null`. */
  github: string | null;
  /** The ids of the other roots that share this working tree, in the roots' order. */
  alsoCovers: string[];
  /**
   * `reading`: the repository read or the first change read has not answered.
   * `ready`: both answered.
   * `untracked`: the root has no change tracking; `notKnown` says why.
   * `failed`: the repository read failed; `notKnown` carries its message.
   */
  status: 'reading' | 'ready' | 'untracked' | 'failed';
  /** A sentence for the Human Lead when `status` is `untracked` or `failed`, else `null`. */
  notKnown: string | null;
  /** `null` while `status` is `reading`, `untracked` or `failed`. */
  head: RootHeadState | null;
  operation: RootGitOperation | null;
  remote: RootRemoteComparison | null;
  /** `null` until the tracker has read the root, and for an untracked root. */
  changes: RepositoryRowChanges | null;
  mirror: MirrorDrift | null;
};

/** The Repositories section's model. */
export type RepositoriesModel = { rows: RepositoryRow[] };

/** `repository` first, then `lore`, then `publish-area`. Lower ranks own a shared working tree. */
function rankOf(kind: RootKind): number {
  if (kind === 'repository') return 0;
  if (kind === 'lore') return 1;
  return 2;
}

function isTracked(
  root: Root,
): root is Root & { tracking: Extract<RootTracking, { tracked: true }> } {
  return root.tracking.tracked;
}

function changesOf(
  rootId: string,
  snapshot: RootSnapshot,
  baselines: RepositoriesModelInput['baselines'],
  defaults: RepositoriesModelInput['defaults'],
): RepositoryRowChanges | null {
  if (snapshot.status !== 'ok') return null;
  const changes = snapshot.changes;
  const def = defaults[rootId] ?? null;
  const baselineSource: RepositoryRowChanges['baselineSource'] =
    baselines[rootId] !== def?.baseline ? 'picked' : (def?.source ?? 'head');
  return {
    total: changes.total,
    uncommitted: changes.uncommitted.length,
    truncated: changes.truncated,
    baseline: changes.baseline,
    baselineSource,
    baselineAt: baselineSource === 'picked' ? null : (def?.at ?? null),
    baselineIsAncestor: changes.baselineIsAncestor,
  };
}

function trackedRow(
  owner: Root,
  also: readonly Root[],
  input: RepositoriesModelInput,
): RepositoryRow {
  const read = input.reads[owner.id];
  const snapshot = input.snapshots[owner.id];

  let status: RepositoryRow['status'];
  let notKnown: string | null = null;
  let head: RootHeadState | null = null;
  let operation: RootGitOperation | null = null;
  let remote: RootRemoteComparison | null = null;
  let changes: RepositoryRowChanges | null = null;

  if (read === undefined) {
    status = 'reading';
  } else if (read.status === 'failed') {
    status = 'failed';
    notKnown = read.message;
  } else if (snapshot === undefined || snapshot.status === 'unread') {
    status = 'reading';
  } else {
    status = 'ready';
    head = read.state.head;
    operation = read.state.operation;
    remote = read.state.remote;
    changes = changesOf(owner.id, snapshot, input.baselines, input.defaults);
  }

  return {
    rootId: owner.id,
    kind: owner.kind,
    name: owner.kind === 'lore' ? 'Lore' : owner.name,
    path: owner.path,
    github: input.github[owner.id] ?? null,
    alsoCovers: also.map((root) => root.id),
    status,
    notKnown,
    head,
    operation,
    remote,
    changes,
    mirror: input.mirrors[owner.id] ?? null,
  };
}

function untrackedRow(root: Root, input: RepositoriesModelInput): RepositoryRow {
  const tracking = root.tracking;
  const message = tracking.tracked ? '' : tracking.message;
  return {
    rootId: root.id,
    kind: root.kind,
    name: root.kind === 'lore' ? 'Lore' : root.name,
    path: root.path,
    github: input.github[root.id] ?? null,
    alsoCovers: [],
    status: 'untracked',
    notKnown: message,
    head: null,
    operation: null,
    remote: null,
    changes: null,
    mirror: input.mirrors[root.id] ?? null,
  };
}

/** Compute the model. Pure: the same input gives the same model. */
export function repositoriesModel(input: RepositoriesModelInput): RepositoriesModel {
  // Rule 1: the Workbench is never a row. Rule 2: a root this desk has no path for is dropped.
  const kept = input.roots.filter((root) => {
    if (root.kind === 'workbench') return false;
    if (!root.tracking.tracked && root.tracking.reason === 'path-unknown') return false;
    return true;
  });

  const originalIndex = new Map(input.roots.map((root, index) => [root.id, index] as const));

  // Rule 3: tracked roots are grouped by working tree; the owner is the one of highest rank.
  const trackedRoots = kept.filter(isTracked);
  const groupOrder: string[] = [];
  const groupMembers = new Map<string, Root[]>();
  for (const root of trackedRoots) {
    if (root.kind === 'publish-area') continue;
    const workTree = root.tracking.workTree;
    const members = groupMembers.get(workTree);
    if (members === undefined) {
      groupMembers.set(workTree, [root]);
      groupOrder.push(workTree);
    } else {
      members.push(root);
    }
  }

  type RowSource = { rankRoot: Root; build: () => RepositoryRow };
  const sources: RowSource[] = [];

  for (const workTree of groupOrder) {
    const members = groupMembers.get(workTree) ?? [];
    let owner = members[0];
    if (owner === undefined) continue;
    for (const member of members) {
      if (rankOf(member.kind) < rankOf(owner.kind)) owner = member;
    }
    const also = members.filter((member) => member.id !== owner.id);
    sources.push({ rankRoot: owner, build: () => trackedRow(owner, also, input) });
  }

  // Rule 4: every remaining untracked repository or Lore root becomes its own row.
  for (const root of kept) {
    if (root.kind === 'publish-area' && isTracked(root)) {
      sources.push({ rankRoot: root, build: () => trackedRow(root, [], input) });
      continue;
    }
    if (root.tracking.tracked) continue;
    if (root.kind !== 'repository' && root.kind !== 'lore' && root.kind !== 'publish-area')
      continue;
    sources.push({ rankRoot: root, build: () => untrackedRow(root, input) });
  }

  // Rule 5: ordered by the owner's rank, then by the roots' order.
  sources.sort((a, b) => {
    const rankDiff = rankOf(a.rankRoot.kind) - rankOf(b.rankRoot.kind);
    if (rankDiff !== 0) return rankDiff;
    return (originalIndex.get(a.rankRoot.id) ?? 0) - (originalIndex.get(b.rankRoot.id) ?? 0);
  });

  return { rows: sources.map((source) => source.build()) };
}
