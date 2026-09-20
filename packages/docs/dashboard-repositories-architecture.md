# D1 — the Space's repositories on the Dashboard: technical design and phase specifications

Written 2026-09-20 by the architect of stage D1 "the Space's repositories on the Dashboard" of the focus `daily-work-in-the-space`. Status: not reviewed by the Human Lead.

Inputs, in order of authority:

1. The stage file `.ai-lore-ai-lore-companion/memory/status/daily-work-in-the-space/D1-repositories-on-the-dashboard/D1-repositories-on-the-dashboard.stage.md` and the focus file above it.
2. `mvp-architecture.md`: section 5.11 (the Dashboard and the Project cache), the coding standards (section 6), the testing strategy (section 8) and the definition of done for a phase (section 8.7). Every phase follows them unless it says otherwise.
3. `m10-architecture.md`: the phase format of its section 5, which section 7 of this document uses.
4. The code as it stands on 2026-09-20: `packages/core/src/space/roots/`, `packages/core/src/space/baseline/`, `packages/core/src/space/exec/`, `packages/app/src/main/space/roots-service.ts`, `packages/app/src/main/space/project-refresh.ts`, `packages/app/src/renderer/src/space/dashboard/`.

Section 1 states what D1 adds and what it does not rebuild. Section 2 records the git behaviour this design depends on, with the runs that established it. Section 3 is the model. Section 4 is ahead and behind. Section 5 is cost and timing. Section 6 is the screen and which roots appear. Section 7 is the work breakdown. Section 8 is the list of open questions for the Human Lead.

---

## 1. What D1 adds, and what already exists

The Dashboard of a Space today shows the state line for the GitHub Project cache, Start a session, Needs you, Focuses by Stage and the Agents board. Every one of them comes from `SpaceProjectState`, which is the Project's snapshot and the model computed from it. Nothing on the Dashboard says anything about the code in `repos/` or about the Space repository itself. The Files window knows, because it starts the roots service, resolves the roots and attaches the root tracker; the Space window has never started it.

What already exists and is not rebuilt:

- `resolveRoots` (`packages/core/src/space/roots/resolve-roots.ts`) gives a Space's roots in the manifest's order, each with `kind` (`lore`, `workbench`, `publish-area`, `repository`), `name`, `path` and `tracking`. A root that cannot be tracked carries `tracking.tracked: false`, a `reason` and a `message` that is already a sentence for the Human Lead.
- `readChangesIn` (`roots/changes-in.ts`) gives a root's changes against a baseline, restricted to the root's sub-path, as a `RootChanges`.
- `attachRootTracker` (`roots/root-tracker.ts`) keeps a `RootSnapshot` per root and re-reads when files, `HEAD`, `logs/HEAD` or (through `roots-service.ts`) `index` move.
- `defaultBaselineOf` and `markRootReviewed` (`space/baseline/default-baseline.ts`) give the reviewed mark, and the first-seen commit when there is no mark. The reviewed mark **is** the baseline the tracker is given, so "what has changed since the reviewed mark" is already in `RootSnapshot.changes`.
- `GitPort` and `runGit` (`space/exec/git-port.ts`) run git through a `CommandRunner`, with `--no-optional-locks` on every read.
- `currentBranch` and `isAncestor` in `packages/core/src/changes/git-info.ts` are the v0.8 `spawnSync` readers. **They are not used by this design.** They start a process directly instead of going through the `CommandRunner` port, which section 8.1 of `mvp-architecture.md` requires of every 1.0 module. `GitPort.currentBranch` is the 1.0 equivalent and is used instead.

What D1 adds:

- A repository read in core that answers, from what a repository already knows and without contacting any remote: which branch `HEAD` is on, whether an operation (merge, rebase, cherry-pick, revert, bisect) is in progress, which tracking branch the branch has, how many commits it is ahead of and behind that tracking branch, and when the repository last fetched.
- A pure model in core that puts those facts together with the roots and the tracker's snapshots into one row per repository.
- A service in main that starts the reads, holds the result in memory and pushes each change to the windows of that Space, following exactly what `project-refresh.ts` does for the Project.
- A Repositories section on the Dashboard, one row per repository, each row leading to the Files window on that root.

**Reading only.** Nothing in D1 commits, pushes, pulls, fetches or switches a branch. Every git command it runs is a read with `--no-optional-locks`.

---

## 2. What git answers, and how it was established

Every claim in this section was observed on 2026-09-20 with git 2.39.5 (Apple Git-154) in a scratch folder of the architect's session, on repositories built for the purpose. A repository `a` was cloned from a bare remote, given commits, and put into each state.

| State | `symbolic-ref --short --quiet HEAD` | `for-each-ref refs/heads/<branch>` | `rev-list --left-right --count <upstream>...HEAD --` |
|---|---|---|---|
| On a branch with a tracking branch | exit 0, `main` | `refs/remotes/origin/main`, `origin/main`, `origin` | exit 0, `1\t2` (behind 1, ahead 2) |
| On a branch with no tracking branch | exit 0, `solo` | one line, three empty fields | not run |
| Tracking branch configured but not in the repository (deleted on the remote, or never fetched) | exit 0, `gonebr` | `refs/remotes/origin/gonebr`, `origin/gonebr`, `origin` | exit 128, `fatal: ambiguous argument` |
| Unborn branch (fresh clone of an empty remote) | exit 0, `main` | **no output at all** | not run |
| Detached `HEAD` | exit 1, no output | not run | not run |
| Mid-merge | exit 0, `main`; `.git/MERGE_HEAD` exists | unchanged | exit 0, answers normally |
| Mid-rebase | exit 1 (rebase detaches `HEAD`); `.git/rebase-merge/` exists, `head-name` holds `refs/heads/br1` | not run | not run |

Established facts this design relies on:

1. **`rev-list --left-right --count A...B` prints `<left>\t<right>`**, where left is the count of commits reachable from `A` and not from `B`. With `A` the tracking branch and `B` `HEAD`, left is **behind** and right is **ahead**. Checked against `git status --porcelain=v2 --branch`, which printed `# branch.ab +2 -1` for the same state.
2. **`for-each-ref` prints `%(upstream)` from the configuration**, so it is non-empty even when the tracking ref itself has been deleted. Existence of the ref is therefore decided by whether `rev-list` succeeds, not by whether `%(upstream)` is empty.
3. **`for-each-ref` prints nothing at all when the branch ref does not exist**, which is the unborn case. It exits 0 for a pattern that matches nothing, so the empty output is the signal.
4. **`%00` works as a field separator in a `for-each-ref` format**, confirmed with `od -c`. A branch with no tracking branch gives one record of three empty fields.
5. **A trailing `--` is accepted by `rev-list --left-right --count`** and removes any revision-or-path ambiguity.
6. **A fresh clone has no `.git/FETCH_HEAD`.** The file appears only after `git fetch` or `git pull`. `git push` does not write it.
7. **`%(upstream:track)` is not translated** (checked with `LC_ALL=fr_FR.UTF-8`, which still printed `ahead 2`). This design does not parse it anyway; it is recorded so a later phase does not re-establish it.
8. **`git status --porcelain=v2 --branch` answers the branch, the tracking branch and `# branch.ab` in one command.** This design does **not** use it, because it rescans the working tree, and the root tracker already runs a full `git status` for every root. The commands chosen below are ref-level and do not touch the working tree.

---

## 3. The model

### 3.1 Where the new code lives

| File | What it holds |
|---|---|
| `packages/core/src/space/roots/types.ts` (edit) | The new plain-data shapes: `RootHeadState`, `RootGitOperation`, `RemoteUnknownReason`, `RootRemoteComparison`, `RootRepositoryState`, `RootRepositoryFailureKind`, `RootRepositoryFailure`, and the constant `ROOT_REPOSITORY_TIMEOUT_MS`. This file imports types only and nothing of Node, which the new shapes keep. |
| `packages/core/src/space/roots/remote-state.ts` (create) | `readRepositoryStateIn`, the git reads. Imports `node:fs` for the two file checks that git has no cheap command for. |
| `packages/core/src/space/project/repositories-model.ts` (create) | `repositoriesModel`, a pure function, and the row shapes. Follows `dashboard-model.ts`: plain data in, plain data out, no Node, no Electron, the same input given twice gives the same model. |
| `packages/app/src/shared/ipc/space/repositories.types.ts` (create) | The argument, result and push types of the new channels. |
| `packages/app/src/shared/ipc/space/repositories.contract.ts` (create) | The four channels. |
| `packages/app/src/main/space/repositories.ts` (create) | The service of one Space: starts the reads, holds the state, pushes changes. Imports nothing from Electron, so a headless test drives it, as `project-refresh.ts` does. |
| `packages/app/src/main/space/ipc/repositories.ts` (create) | The handlers. |
| `packages/app/src/renderer/src/space/dashboard/Repositories.tsx`, `repositoriesText.ts`, `useRepositoriesState.ts` (create) | The section, its sentences and its state hook. |

### 3.2 The shapes in `roots/types.ts`

```ts
/** Where `HEAD` is. */
export type RootHeadState =
  /** On a branch that has a commit. */
  | { kind: 'branch'; branch: string; commit: string }
  /** On a branch whose ref does not exist yet: a repository with no commit. */
  | { kind: 'unborn-branch'; branch: string }
  /** Not on a branch. During a rebase git detaches `HEAD`; `rebasing` then names the branch being rebased. */
  | { kind: 'detached'; commit: string; rebasing: string | null };

/** An operation git records as in progress in its folder, or `null` when there is none. */
export type RootGitOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'bisect';

/**
 * Why the comparison with the tracking branch is not known.
 * `no-remote`: the repository has no remote at all.
 * `no-upstream`: the branch has no tracking branch configured.
 * `upstream-missing`: a tracking branch is configured and its ref is not in this
 *   repository. It has never been fetched, or it was deleted on the remote.
 * `detached-head`: `HEAD` is not on a branch, so there is no tracking branch.
 * `unborn-branch`: the branch has no commit, so there is nothing to compare.
 * `git-failed`: a git command did not answer. `message` carries git's own words.
 */
export type RemoteUnknownReason =
  | 'no-remote'
  | 'no-upstream'
  | 'upstream-missing'
  | 'detached-head'
  | 'unborn-branch'
  | 'git-failed';

/**
 * What one repository's own records say about its remote, read without
 * contacting it. `ahead` and `behind` are both numbers or both `null`; they are
 * never `0` for a fact that could not be established.
 */
export type RootRemoteComparison = {
  /** The remote's name, `origin`, or `null` when there is none to name. */
  remote: string | null;
  /** The tracking branch in its short form, `origin/main`, or `null`. */
  upstream: string | null;
  /** Commits on `HEAD` that the tracking branch does not have, or `null`. */
  ahead: number | null;
  /** Commits on the tracking branch that `HEAD` does not have, or `null`. */
  behind: number | null;
  /** Why `ahead` and `behind` are `null`; `null` when they are known. */
  unknown: { reason: RemoteUnknownReason; message: string } | null;
  /**
   * When git last fetched into this repository, ISO 8601, from the modification
   * time of `FETCH_HEAD` in its git folder. `null` when there is no such file,
   * which is the case in a repository that has been cloned and never fetched.
   */
  lastFetchAt: string | null;
};

/** What one read of a repository established. */
export type RootRepositoryState = {
  /** The top folder of the working tree that was read. */
  workTree: string;
  head: RootHeadState;
  operation: RootGitOperation | null;
  remote: RootRemoteComparison;
  /** When the read ran, ISO 8601. */
  readAt: string;
};

/**
 * Why a repository could not be read at all.
 * `folder-missing`: there is no folder at the working tree's path.
 * `not-a-repository`: the folder is in no git working tree.
 * The other kinds are the command runner's.
 */
export type RootRepositoryFailureKind =
  | 'folder-missing'
  | 'not-a-repository'
  | 'command-refused'
  | 'command-not-found'
  | 'command-timeout'
  | 'command-failed';

export type RootRepositoryFailure = Failure<RootRepositoryFailureKind>;

/** How long a git command of a repository read may run. */
export const ROOT_REPOSITORY_TIMEOUT_MS = 10_000;
```

`readRepositoryStateIn` fails as a whole only for `folder-missing` and `not-a-repository`, and when the very first command cannot be run. Every other git failure is encoded inside `remote.unknown` with `reason: 'git-failed'`, so the row still shows the branch it did read.

### 3.3 `readRepositoryStateIn`

```ts
/** Options of `readRepositoryStateIn`. */
export type ReadRepositoryStateOptions = {
  /** Stop each git command after this many milliseconds. Default `ROOT_REPOSITORY_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** The time the read is stamped with. Default `() => new Date()`. A test passes a fixed one. */
  now?: () => Date;
};

/**
 * Read one repository's branch, its operation in progress and its comparison
 * with its tracking branch, from what the repository already knows. Nothing
 * here contacts a remote: there is no `fetch`, no `ls-remote` and no network.
 *
 * `workTree` is the top folder of a working tree, which is what
 * `Root.tracking.workTree` holds for a tracked root.
 */
export async function readRepositoryStateIn(
  runner: CommandRunner,
  workTree: string,
  options?: ReadRepositoryStateOptions,
): Promise<Result<RootRepositoryState, RootRepositoryFailure>>;
```

The commands, in order. Every one goes through `runGit(runner, workTree, args, { readOnly: true, timeoutMs })`, which places `--no-optional-locks` before the subcommand.

1. `statSync(workTree).isDirectory()` is false or throws → fail `folder-missing`, message `There is no folder at <workTree>.`
2. `rev-parse --absolute-git-dir`. Exit 0 and non-empty → `gitDir`. Any other outcome → fail `not-a-repository` when the run itself succeeded, otherwise the `commandFailure` kind.
3. `symbolic-ref --short --quiet HEAD`. Exit 0 → the branch name. Exit 1 → `HEAD` is detached. Anything else → `commandFailure`, and the whole read fails with that kind.
4. `rev-parse --verify --quiet HEAD^{commit}`. Exit 0 → the commit SHA. Exit 1 → there is no commit.
5. The operation in progress, by `existsSync` under `gitDir`, tested in this order and the first match wins: `rebase-merge` or `rebase-apply` → `rebase`; `MERGE_HEAD` → `merge`; `CHERRY_PICK_HEAD` → `cherry-pick`; `REVERT_HEAD` → `revert`; `BISECT_LOG` → `bisect`. For `rebase`, the first line of `rebase-merge/head-name` or `rebase-apply/head-name` is read; when it begins with `refs/heads/` the rest is the branch being rebased, otherwise `rebasing` is `null`.
6. `head` is then: `{ kind: 'detached', commit, rebasing }` when step 3 said detached; `{ kind: 'unborn-branch', branch }` when step 4 found no commit; otherwise `{ kind: 'branch', branch, commit }`.
7. `lastFetchAt` is `statSync(join(gitDir, 'FETCH_HEAD')).mtime.toISOString()`, and `null` when the file is absent or the call throws.
8. The comparison:
   - `head.kind === 'detached'` → `unknown: { reason: 'detached-head', … }`, `remote` and `upstream` `null`. No further command.
   - `head.kind === 'unborn-branch'` → `unknown: { reason: 'unborn-branch', … }`. No further command.
   - Otherwise `for-each-ref --format=%(upstream)%00%(upstream:short)%00%(upstream:remotename) refs/heads/<branch>`. The pattern is built by concatenation with the literal prefix `refs/heads/`, so the argument never begins with `-`; git refuses `*`, `?` and `[` in a branch name, so the pattern is never a glob (section 2, fact 3). The output is split on `\n`, the first record split on `\0`. Empty output, or an empty first field, means no tracking branch is configured; then:
     - `remote` (the subcommand, no arguments). Exit 0 with no non-empty line → `unknown: { reason: 'no-remote', … }` and `remote: null`. Otherwise `unknown: { reason: 'no-upstream', … }` and `remote: null`.
   - With a non-empty first field, `upstream` is the second field and `remote` the third. Then `rev-list --left-right --count <fullUpstreamRef>...HEAD --`. Exit 0 → the output split on whitespace gives `[behind, ahead]` in that order (section 2, fact 1). Exit non-zero and the run itself succeeded → `unknown: { reason: 'upstream-missing', … }`. The run failed → `unknown: { reason: 'git-failed', message: commandFailure(...).message }`.

The `message` of each `unknown` is the sentence the screen shows; section 6.3 gives the exact text of each.

### 3.4 `repositoriesModel`

```ts
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
};

/** The Repositories section's model. */
export type RepositoriesModel = { rows: RepositoryRow[] };

/** Compute the model. Pure: the same input gives the same model. */
export function repositoriesModel(input: RepositoriesModelInput): RepositoriesModel;
```

How the rows are built:

1. The Workbench root is dropped. It is gitignored by design in a Space, `resolveRoots` always gives it `tracking.tracked: false` with `reason: 'git-ignored'`, and it has no branch, no remote and no baseline. It is never a row.
2. A root whose `tracking.reason` is `path-unknown` is dropped. Its folder is not known on this desk, so there is nothing to read.
3. Every remaining tracked root is grouped by `tracking.workTree`. Within a group the owning root is the one of highest rank, rank being `repository` (0), `lore` (1), `publish-area` (2); a tie is broken by the roots' order. The other roots of the group go into the owner's `alsoCovers`. This is what stops the Lore and a publish area inside the Space from producing two rows for one working tree with the same branch.
4. Every remaining untracked root of kind `repository` or `lore` becomes a row with `status: 'untracked'` and `notKnown` set to `tracking.message`, which `resolveRoots` already writes as a sentence.
5. Rows are ordered by the owner's rank, then by the roots' order. The result is: the repository roots in the manifest's order, then the Space repository (named after the Lore), then any publish area that is a tracked root of a working tree of its own.
6. `changes` is filled from the root's `RootSnapshot` when its `status` is `ok`: `total` from `changes.total`, `uncommitted` from `changes.uncommitted.length`, `truncated` from `changes.truncated`, `baselineIsAncestor` from `changes.baselineIsAncestor`. `baselineSource` is `'picked'` when `baselines[rootId] !== defaults[rootId]?.baseline`, otherwise `defaults[rootId]?.source ?? 'head'`. `baselineAt` is `defaults[rootId]?.at ?? null`, and `null` when the source is `picked`. A snapshot of status `failed` leaves `changes` `null` and appends nothing: the row keeps `status: 'ready'` when the repository read succeeded, and the screen says the changes could not be read. A snapshot of status `unread`, or a root with no snapshot, keeps `status: 'reading'`.

---

## 4. Ahead and behind, honestly

**The companion never fetches to paint the Dashboard.** Ahead and behind are read from the tracking ref the repository already holds. The commands are `for-each-ref` and `rev-list --left-right --count`, both listed with their exact arguments in section 3.3.

Every case has one defined answer, and no case is answered with a zero:

| Case | `ahead` / `behind` | `unknown.reason` | Shown as |
|---|---|---|---|
| On a branch with a tracking branch that is in the repository | the two counts | `null` | the counts, with the age of the knowledge |
| On a branch, a tracking branch is configured, its ref is not in the repository | `null` | `upstream-missing` | not known, with the reason |
| On a branch, no tracking branch configured, the repository has at least one remote | `null` | `no-upstream` | not known, with the reason |
| On a branch, the repository has no remote at all | `null` | `no-remote` | not known, with the reason |
| Detached `HEAD`, including the whole of a rebase | `null` | `detached-head` | not known, with the reason |
| Unborn branch (no commit yet) | `null` | `unborn-branch` | not known, with the reason |
| Mid-merge, mid-cherry-pick, mid-revert, mid-bisect | the two counts, which git still answers | `null` | the counts, and a separate line naming the operation |
| A git command failed or timed out | `null` | `git-failed`, `message` is git's | not known, with git's message |

A merge in progress does not stop the comparison: the branch and its tracking ref are both there, and `rev-list` answers (section 2). A rebase does stop it, because git detaches `HEAD` for the duration; the row says so and names the branch being rebased, read from `rebase-merge/head-name`.

**How old the knowledge is.** `lastFetchAt` is the modification time of `FETCH_HEAD` in the repository's git folder, obtained with `statSync`. That file is written by `git fetch` and by `git pull`, and by nothing else. Two consequences, both stated on the screen rather than hidden:

- A repository that was cloned and never fetched has no `FETCH_HEAD`, so `lastFetchAt` is `null` even though its tracking refs are exactly as current as the clone. The row says there is no record of a fetch, not that the knowledge is old.
- A `git push` updates the tracking ref without writing `FETCH_HEAD`, so after a push the counts are current and `lastFetchAt` still names the older fetch. The row's wording ("last fetched") states what was measured and claims nothing more.

---

## 5. Cost and timing

### 5.1 The Dashboard's first paint waits for nothing

`Dashboard.tsx` mounts `<Repositories />` unconditionally, beside the parts it already mounts. `useRepositoriesState` makes its first request inside a `useEffect`, after the first render. Before any answer the section renders its heading and one line, so the first paint costs one heading and one sentence and no git command has started.

### 5.2 How the reads are started, and how results arrive

The service `spaceRepositories` in `packages/app/src/main/space/repositories.ts` follows `project-refresh.ts` exactly:

- `current()` returns the state now, with a `version` that increases with every state given.
- `readOnce()` starts the first read when none has run for this Space in this run of the app. The first `spaceRepositoriesState` call of a Space calls it, and the handler answers at once with the state as it is.
- `refresh()` reads now and resolves when the run that serves the request has ended. One run at a time; a request made during a run is served by one more run after it.
- `windowFocused()` calls `refresh()`, as the Project's service does.
- `subscribe(listener)` is forwarded by the IPC module to the windows of that Space only, through `deps.space.sendToSpace`.
- A timer of `DEFAULT_REPOSITORY_REFRESH_MS` (60 000, a constant in this file, `unref`ed) runs a refresh, so that a `git fetch` made in a terminal is picked up within a minute. The roots' watchers report file events but not a change of refs alone, which is what a fetch is.

A run does this:

1. `await context.service(spaceRoots).running()`. That resolves the roots, gives each its default baseline and attaches the root tracker with its watchers. It is the same service the Files window uses, so when the Files window is open nothing new is started.
2. Take `roots.list(held)`, which gives one `RootSummary` per root with its `root`, `baseline`, `defaultBaseline` and `snapshot`, and the manifest's `github` string.
3. For every row-owning tracked root, call `readRepositoryStateIn(context.runner, root.tracking.workTree, { timeoutMs: ROOT_REPOSITORY_TIMEOUT_MS })`. The calls run together with `Promise.allSettled`; one working tree is read once even when several roots share it.
4. Each result is written into a `Map<string, RepositoryRead>` **as it arrives**, and the state is emitted after each one. A window therefore sees rows fill one at a time rather than all at the end.
5. `repositoriesModel` is computed in `current()` from the roots, the tracker's snapshots, the baselines, the defaults and the reads, so a snapshot the tracker pushes between runs is reflected without a new git read.

The service also subscribes to `roots.onFileEvent`, debounced by 500 ms per Space, and re-emits without running the repository reads again: a file event changes the tracker's snapshot, not the branch or the remote. `roots.onFileEvent` is a multi-listener API and adding a listener does not disturb the Files window.

### 5.3 When one is slow or fails

`ROOT_REPOSITORY_TIMEOUT_MS` is 10 000 and is passed as `timeoutMs` to every git command of the read. A command that passes it comes back as `RunResult` with `failure: 'timeout'`, which `commandFailure` turns into `command-timeout` with the message `git <subcommand> did not finish in time`. The row's `status` becomes `failed` and `notKnown` carries that message. The other rows are unaffected: each root is read independently and the state is emitted per result.

While a root's read has not answered, its row has `status: 'reading'` and the screen shows one line for it. There is no spinner and no colour-only state.

### 5.4 What is cached, and where

**Nothing is written to the desk.** The state lives in memory in the Space's service and is gone when the Space's last window closes.

This is deliberately unlike the Project cache of section 5.11 of `mvp-architecture.md`. The Project is read over the network from GitHub, which can be unreachable and is slow, so the companion keeps `desk/project-cache.json` and shows it with its age when a refresh fails. A repository's branch and its tracking counts are local, cost a handful of ref-level git commands, and change while the companion is not running. A value read in a previous run would be shown as current and would be wrong. The row therefore shows either what this run read or that it is still reading.

---

## 6. The screen

### 6.1 Where the section sits

`Repositories` goes between `Needs you` and `Focuses by Stage` in `Dashboard.tsx`. Needs you holds pending gates and focuses at Review and must not be pushed down; it is empty most of the time, in which case Repositories is the first thing under Start a session. Open question 1 puts the placement to the Human Lead.

The section renders even when `model` is `null` (no Project has been read), because it does not depend on the Project at all.

### 6.2 A row

One `<li>` per row in a `<ul>`, in the model's order. Test ids: the section is `data-testid="dashboard-repositories"`; a row is `data-testid="repository-row"` with `data-root-id`, `data-status` and `data-kind` attributes, which is the shape `root-changes.spec.ts` already reads for the Changes panel.

A row shows, in order:

1. **The name**, as a button with `linkStyle`, which opens the Files window on this root (6.4). For a repository root the name is the manifest's name; for the Lore the name shown is `Lore`. When `github` is set, ` — <owner>/<name>` follows it in the secondary colour.
2. **The branch line** (6.3).
3. **The operation line**, only when an operation is in progress.
4. **The uncommitted line**.
5. **The remote line**, and after it the knowledge-age sentence when ahead and behind are known.
6. **The changes line**.

For `status: 'reading'` the row shows the name and one line. For `status: 'untracked'` or `'failed'` the row shows the name and `notKnown`.

### 6.3 The exact wording

All of it lives in `packages/app/src/renderer/src/space/dashboard/repositoriesText.ts` as pure functions, so the component test and the component say the same thing. The file imports types only from core, never a value, as the renderer rule requires. `formatAge` and `formatTime` are imported from the existing `dashboardText.ts`.

Reading:

- `Reading this repository.`

Branch:

- `On the branch <branch>.`
- `On the branch <branch>, which has no commit yet.`
- `Not on a branch. The checked-out commit is <first 7 of commit>.`

Operation:

- `A merge is in progress.`
- `A rebase of <branch> is in progress.` — when `head.rebasing` is `null`: `A rebase is in progress.`
- `A cherry-pick is in progress.`
- `A revert is in progress.`
- `A bisect is in progress.`

Uncommitted:

- `No uncommitted change.`
- `1 uncommitted change.`
- `<n> uncommitted changes.`
- When `changes.truncated`: `At least <n> uncommitted changes.`

Remote, known:

- `Level with <upstream>.`
- `<n> commit ahead of <upstream>.` / `<n> commits ahead of <upstream>.`
- `<n> commit behind <upstream>.` / `<n> commits behind <upstream>.`
- `<a> commits ahead of and <b> commits behind <upstream>.` (singular `commit` where the number is 1, on either side.)

Followed, in the same line, by the age of the knowledge:

- `Read from what this repository already knows; it last fetched <age> ago.`
- `Read from what this repository already knows; there is no record of a fetch in it.`

Remote, not known. Each begins the same way so the row reads consistently:

- `no-remote`: `Ahead and behind are not known: this repository has no remote.`
- `no-upstream`: `Ahead and behind are not known: the branch <branch> has no tracking branch.`
- `upstream-missing`: `Ahead and behind are not known: the tracking branch <upstream> is not in this repository. It has not been fetched, or it was deleted on the remote.`
- `detached-head`: `Ahead and behind are not known: this repository is not on a branch.`
- `unborn-branch`: `Ahead and behind are not known: the branch <branch> has no commit yet.`
- `git-failed`: `Ahead and behind are not known: <message>.`

Changes:

- `baselineSource: 'reviewed-mark'`, `total` 0: `No file has changed since the reviewed mark of <time>.`
- `baselineSource: 'reviewed-mark'`, `total` above 0: `<n> file changed since the reviewed mark of <time>.` / `<n> files have changed since the reviewed mark of <time>.`
- `baselineSource: 'first-seen'`: the same two sentences with `since the companion first saw this repository, on <time>` in place of `since the reviewed mark of <time>`, followed by ` This repository has no reviewed mark.`
- `baselineSource: 'head'`: `This repository has no reviewed mark and no first-seen record, so only what is not committed is counted.`
- `baselineSource: 'picked'`: `<n> files have changed since the commit picked in the Files window, <first 7 of baseline>.`
- When `changes.truncated`, append ` The list was cut, so the count is a lower bound.`
- When `changes.baselineIsAncestor === false`, append ` The baseline commit is not on the current branch.`
- When `changes` is `null` and `status` is `ready`: `The changes of this repository could not be read.`

Untracked or failed:

- `status: 'untracked'`: `notKnown` as `resolveRoots` wrote it, unchanged.
- `status: 'failed'`: `This repository could not be read: <message>`

Section, when there is no row at all:

- `This Space has no repository.`

Before the first answer:

- `Reading the Space's repositories.`

`<time>` is `formatTime(iso)` from `dashboardText.ts`; `<age>` is `formatAge(now - at)` from the same file.

### 6.4 A row leads to the Files window

The name button calls:

```ts
void window.cockpit.spaceNavigate({ to: 'space-files', open: { rootId: row.rootId } });
```

`SpaceNavigateArg` already carries `{ to: 'space-files'; open?: OpenInFiles }`, `OpenInFiles` already carries `rootId`, and `main/space/ipc/windows.ts` already validates it with `openInFilesSchema` and opens or brings forward the Files window of that Space on that root. Nothing in main, preload or the contract changes for this.

### 6.5 Which roots appear, and why

| Root | Row | Why |
|---|---|---|
| A repository root under `repos/`, tracked | Yes | The stage names them. It is a working tree of its own with its own branch and remote. |
| A repository root that is not tracked (folder missing, not a repository, its path refused) | Yes, `status: 'untracked'`, with `resolveRoots`'s own sentence | A repository named in the manifest and not readable is exactly what the Human Lead must see. Silence would read as "nothing to report". |
| The Lore root | Yes, one row, named `Lore` | It is a folder of the Space repository, which is a repository with a branch and a remote. Being behind on it means another desk pushed plan changes; that is the same question the stage asks for the code. Open question 2. |
| The Workbench root | No | It is gitignored by design in a Space. `resolveRoots` always marks it untracked with `reason: 'git-ignored'`. It has no branch, no remote and no baseline, so every field of a row would be "not known" for one reason that never changes. |
| A publish area inside the Space | No row of its own | Its working tree is the Space repository, already shown by the Lore's row. Its id appears in that row's `alsoCovers`. |
| A publish area outside the Space, tracked | Yes, after the repositories | It is a working tree of its own that the Human Lead works in. Open question 3. |
| A publish area whose path this desk does not know (`path-unknown`) | No | There is no folder to read. |

---

## 7. The work breakdown

### How to read a phase

As in section 5 of `m10-architecture.md`. Each phase lists its files and the exact changes. "Create" is a new file, "Edit" an existing one. Names, types, copy and test ids given in this document are fixed; what this document does not fix is the developer's smallest choice under section 7 of `mvp-architecture.md`, listed under "Choices made" in the phase report.

Every phase ends with the definition of done of section 8.7 of `mvp-architecture.md`. The commands, from the repository root, with `<id>` the phase id in lower case (`d1-1`):

```
npm run verify
npm run lint
AI_LORE_CORE_TEST_OUT=.test-runs/<id>/dist-test npm test -w @ai-lore-companion/core
AI_LORE_APP_TEST_OUT=.test-runs/<id>/dist-test npm run test:headless -w @ai-lore-companion/app
npm run test:component -w @ai-lore-companion/app
npm run e2e                      # phases that change main, preload or renderer
```

A developer agent runs with the repository root as its working directory, writes files only with the Write and Edit tools, and makes no commit. No existing test is deleted or skipped.

### Order and parallel groups

| Group | Phases | Runs after |
|---|---|---|
| 1 | **D1.1** and **D1.2** in parallel | — |
| 2 | **D1.3** | D1.1 |
| 3 | **D1.4** | D1.3 |
| 4 | **D1.5** | D1.2 and D1.4 |

Why the groups are cut this way:

- **D1.1 and D1.2 may run at the same time.** D1.1 touches only `packages/core/src/space/**`, `packages/core/test/space/**` and one new file plus one export line under `packages/app/src/shared/ipc/`. D1.2 touches only `packages/app/test/space-fixture.ts`. They share no file and neither reads the other's output.
- **D1.3 must not run at the same time as D1.4.** D1.4 is renderer code whose `window.cockpit` types are generated from `CONTRACT`, and D1.3 is the phase that adds the fragment to `CONTRACT`. Running them together would leave D1.4 unable to typecheck.
- **D1.3 cannot be split into "the contract" and "the handlers".** `packages/app/test/headless/space/groundwork.test.ts` asserts `SPACE_MODULES.length === Object.keys(FRAGMENTS).length`, so a contract fragment that has no register module fails an existing test. A phase that added only the fragment would not close in a runnable state.
- **D1.5 must not run at the same time as D1.4**, because it reads the test ids D1.4 creates.

Files several phases touch, and their owner:

| File | Owner |
|---|---|
| `packages/app/src/shared/ipc.ts` | D1.1 (the one export line) |
| `packages/app/src/shared/ipc/contract.ts` | D1.3 |
| `packages/app/test/headless/space/groundwork.test.ts` | D1.3 (the `FRAGMENTS` entry) |
| `packages/app/src/renderer/src/space/dashboard/Dashboard.tsx` | D1.4 |
| `packages/app/test/space-fixture.ts` | D1.2 |

---

### D1.1 — The repository read and the repositories model, in core

**Goal.** Core can read one repository's branch, its operation in progress, its comparison with its tracking branch and the age of that knowledge, without contacting a remote; and a pure function turns the roots, the tracker's snapshots and those reads into the Dashboard's rows.

**Depends on.** Nothing. Parallel with D1.2.

**Files and changes.**

1. Edit `packages/core/src/space/roots/types.ts`: add `RootHeadState`, `RootGitOperation`, `RemoteUnknownReason`, `RootRemoteComparison`, `RootRepositoryState`, `RootRepositoryFailureKind`, `RootRepositoryFailure` and `ROOT_REPOSITORY_TIMEOUT_MS`, with the doc comments of section 3.2 word for word. The file keeps importing types only and nothing of Node.
2. Create `packages/core/src/space/roots/remote-state.ts` with `ReadRepositoryStateOptions` and `readRepositoryStateIn`, exactly the commands and the order of section 3.3. Every git command goes through `runGit(runner, workTree, args, { readOnly: true, timeoutMs })`. The file's header comment states that nothing in it contacts a remote.
3. Edit `packages/core/src/space/roots/index.ts`: export the new type names and `readRepositoryStateIn`.
4. Create `packages/core/src/space/project/repositories-model.ts` with `RepositoryRead`, `RepositoriesModelInput`, `RepositoryRowChanges`, `RepositoryRow`, `RepositoriesModel` and `repositoriesModel`, exactly as section 3.4 gives them, including the row rules 1 to 6.
5. Edit `packages/core/src/space/project/index.ts`: export them, in a block with the comment `// Stage D1: the Dashboard's repositories.`
6. Create `packages/app/src/shared/ipc/space/repositories.types.ts`:

   ```ts
   import type { RepositoriesModel } from '@ai-lore-companion/core';

   /** What the Repositories section receives, by push and as the result of its requests. */
   export type SpaceRepositoriesState = {
     /** The number of this state among those the Space's service has given; a later state is higher. */
     version: number;
     /** Whether a read is running now. */
     reading: boolean;
     /** The rows, or `null` before the roots have been resolved. */
     model: RepositoriesModel | null;
     /** When the last run finished, ISO 8601, or `null` when none has. */
     readAt: string | null;
     /** Why the Space's roots could not be resolved at all, or `null`. */
     problem: string | null;
   };

   /** Argument of every channel of the repositories: nothing. The Space is the window's. */
   export type SpaceRepositoriesArg = Record<string, never>;

   /** Why a request was not served. `message` can be shown as it is. */
   export type SpaceRepositoriesFailure = {
     kind: 'invalid-argument' | 'not-a-space-window';
     message: string;
   };

   export type SpaceRepositoriesStateResult =
     | { ok: true; value: SpaceRepositoriesState }
     | { ok: false; error: SpaceRepositoriesFailure };
   ```

7. Edit `packages/app/src/shared/ipc.ts`: add `export * from './ipc/space/repositories.types.js';` after the `project.types.js` line.

**Tests.** Tier: core unit and core integration.

- Create `packages/core/test/space/repositories-model.test.ts` (core unit). Built inputs, no git. At least: the Workbench is never a row; a publish area inside the Space is folded into the Lore's row through `alsoCovers`; the order is repositories, then the Lore, then an outside publish area; a root with no read is `reading`; an untracked repository root is `untracked` with `resolveRoots`'s message; a failed read is `failed` with its message; `baselineSource` is `picked` when the baseline differs from the default; `uncommitted` is the length of `RootChanges.uncommitted`; `total` and `truncated` come through unchanged.
- Create `packages/core/test/space/roots-remote.int.test.ts` (core integration, real git in temporary folders, `AI_LORE_TEST=1` through `core/test/support/temp.ts`). One repository per case of the table in section 4: a clone that is ahead only; one that is ahead and behind after a second clone pushed and the first fetched; a branch with no tracking branch, in a repository that has a remote; a repository with no remote at all; a branch whose tracking ref was deleted with `git update-ref -d`; a detached `HEAD`; a fresh clone of an empty bare remote (unborn branch); a repository left mid-merge, which still answers the counts and reports `operation: 'merge'`; a repository left mid-rebase, which reports `operation: 'rebase'`, `head.kind: 'detached'` and `head.rebasing` naming the branch. Also: `lastFetchAt` is `null` before any fetch and a time after one. Every assertion of ahead and behind is checked against `git status --porcelain=v2 --branch`'s `# branch.ab` line read in the same test, so the test does not restate this document's arithmetic.
- Create `packages/core/test/space/roots-remote.test.ts` (core unit) for the parsing helpers `readRepositoryStateIn` exposes for testing, driven by a scripted `CommandRunner` from `space/testing`: a `for-each-ref` record of three empty fields, a `rev-list` output of `1\t2`, a `rev-list` that exits 128, and a runner that reports `timeout`, each giving the documented outcome.

**Gate.** The six commands of "How to read a phase" pass. `npm run e2e` is not required: this phase changes no file of main, preload or the renderer other than one type file and one export line.

---

### D1.2 — The end-to-end fixture Space gains repositories

**Goal.** An end-to-end test can ask for a fixture Space that has repositories under `repos/`, so D1.5 has rows to look at.

**Depends on.** Nothing. Parallel with D1.1.

**Files and changes.**

1. Edit `packages/app/test/space-fixture.ts`: `makeSpaceE2eFixture` takes a second parameter `options?: { repositories?: readonly string[] }` and passes `repositories` through to the `makeSpaceFixture` call in the child-process script, which already accepts it (`SpaceFixtureOptions.repositories`). `SpaceE2eFixture` gains `repositories: string[]`, the names as given. `withSpaceApp` takes the same option and forwards it. The default stays no repository, so every existing spec behaves exactly as it does today.

**Tests.** Tier: end-to-end (the existing suite). No new spec. The gate is that `npm run e2e` passes unchanged, which shows the default path was not disturbed.

**Gate.** `npm run verify`, `npm run lint`, `npm run e2e`.

---

### D1.3 — The repositories service and its channels, in main

**Goal.** A Space serves the repositories state on four channels, reads each repository independently, pushes each result as it arrives, and holds nothing on the desk.

**Depends on.** D1.1. Not parallel with D1.4.

**Files and changes.**

1. Create `packages/app/src/shared/ipc/space/repositories.contract.ts`:

   ```ts
   export const SPACE_REPOSITORIES_CONTRACT = {
     /** The rows as the service holds them now. The first request of a Space starts its first read. */
     spaceRepositoriesState: invoke<[arg: SpaceRepositoriesArg], SpaceRepositoriesStateResult>(
       'space:repositories-state',
     ),
     /** Read now, on demand. Answers when the run that serves this request ended. */
     spaceRepositoriesRefresh: invoke<[arg: SpaceRepositoriesArg], SpaceRepositoriesStateResult>(
       'space:repositories-refresh',
     ),
     /** The window gained focus: read, as the timer does. Answers at once with the state before the read. */
     spaceRepositoriesFocus: invoke<[arg: SpaceRepositoriesArg], SpaceRepositoriesStateResult>(
       'space:repositories-focus',
     ),
     /** The repositories state changed: a read started, a row arrived, or a root's changes moved. */
     onSpaceRepositoriesState: push<SpaceRepositoriesState>('space:on-repositories-state'),
   } as const;
   ```

2. Edit `packages/app/src/shared/ipc/contract.ts`: import the fragment and spread it into `CONTRACT`, beside `SPACE_PROJECT_CONTRACT`.
3. Create `packages/app/src/main/space/repositories.ts`: `DEFAULT_REPOSITORY_REFRESH_MS = 60_000`, `REPOSITORY_FILE_EVENT_DEBOUNCE_MS = 500`, `createSpaceRepositories(options)` returning `{ current, refresh, windowFocused, readOnce, subscribe, dispose }` with the behaviour of section 5.2, and `export const spaceRepositories = defineSpaceService<…>({ id: 'repositories', create, dispose })`. The file imports nothing from Electron. `create` takes the roots service with `context.service(spaceRoots)`, subscribes to `roots.onFileEvent` and returns the unsubscribe from its `dispose`, exactly as `spaceProjectRefresh` does for the dialog broker. The service never calls `roots.bind`.
4. Create `packages/app/src/main/space/ipc/repositories.ts`: `registerSpaceRepositories`, the three invoke handlers and the once-per-Space push forwarding, copied in shape from `ipc/project.ts` including its `forwarded` `WeakSet` and its `notASpaceWindow` constant. Every handler validates its argument with `parseArg(z.strictObject({}), arg)` and returns a failure as its result; none rejects.
5. Edit `packages/app/src/main/space/ipc/index.ts`: import `registerSpaceRepositories` and add it to `SPACE_MODULES`.
6. Edit `packages/app/test/headless/space/groundwork.test.ts`: import `SPACE_REPOSITORIES_CONTRACT` and add `repositories: SPACE_REPOSITORIES_CONTRACT` to `FRAGMENTS`. This is the only change to that file.

**Tests.** Tier: app headless.

- Create `packages/app/test/headless/space/repositories-ipc.test.ts`, driven through the capturing registrar of `space-harness.ts` as `roots-ipc.test.ts` is, against a `makeSpaceFixture` Space with one repository. At least: `spaceRepositoriesState` answers at once with `model: null` and `reading: true` and does not wait for a git read; a later state carries a row for the repository and a row for the Lore and none for the Workbench; each of the three invoke channels refuses an argument that is not `{}` and refuses a call that does not come from a window of a Space; a push reaches only the windows of that Space; `version` never goes down across the states a run emits; `dispose` stops the timer and later requests do nothing; nothing was written under the desk folder (read the desk folder's entries before and after and compare).

**Gate.** The six commands, `npm run e2e` included, since main changes.

---

### D1.4 — The Repositories section on the Dashboard

**Goal.** The Dashboard shows one row per repository with its branch, its uncommitted changes, its comparison with its remote and its changes since the reviewed mark; a value that is not known says why; a row opens the Files window on its root.

**Depends on.** D1.3. Not parallel with D1.3 or D1.5.

**Files and changes.**

1. Create `packages/app/src/renderer/src/space/dashboard/useRepositoriesState.ts`, modelled on `useProjectState.ts`: reads once with `spaceRepositoriesState`, takes every `onSpaceRepositoriesState` push, keeps the state with the highest `version`, calls `spaceRepositoriesFocus` on the window's `focus` event, and exposes `refresh` over `spaceRepositoriesRefresh`. It returns `{ repositories, problem, requested, refresh }`.
2. Create `packages/app/src/renderer/src/space/dashboard/repositoriesText.ts`: one pure function per sentence of section 6.3, with the text word for word. It imports `formatAge` and `formatTime` from `./dashboardText.js` and types only from core.
3. Create `packages/app/src/renderer/src/space/dashboard/Repositories.tsx`: the section of section 6.2, styled with `style` objects and the `theme.css` tokens the neighbouring components use, with the test ids of section 6.2, and the name button calling `spaceNavigate` as section 6.4 gives it. No new colour token is added.
4. Edit `packages/app/src/renderer/src/space/dashboard/Dashboard.tsx`: import and mount `<Repositories />` between `<NeedsYou …/>` and the Focuses by Stage `<section>`, outside the `project !== null && model !== null` condition, so it shows whether or not a Project has been read. The file's header comment gains one sentence naming the section and this stage.

**Tests.** Tier: component.

- Create `packages/app/test/component/space/dashboard-repositories.test.tsx`, with a stubbed `window.cockpit` as `dashboard.test.tsx` has one. At least: before any answer the section shows `Reading the Space's repositories.`; a ready row shows the branch line, the uncommitted line, the remote line and the changes line with the exact sentences; each of the six `RemoteUnknownReason` values gives its sentence and no number; a row mid-merge shows the operation line and still shows the counts; a row mid-rebase shows the rebase line and the `detached-head` sentence; a `reading` row shows one line; an `untracked` row shows the root's own message; a `failed` row shows its message; the name button calls `spaceNavigate` with `{ to: 'space-files', open: { rootId } }`; a section with no row shows `This Space has no repository.`

**Gate.** The six commands, `npm run e2e` included.

---

### D1.5 — The Repositories section, end to end

**Goal.** In a real Space opened by the real app, the section fills with the true state of the Space's repositories, and a row opens the Files window on that root.

**Depends on.** D1.2 and D1.4.

**Files and changes.**

1. Create `packages/app/test/space-repositories.spec.ts`, using `withSpaceApp('e2e-repositories', …, { repositories: ['app'] })` from D1.2. The fixture's repository is a clone of a bare remote with one local commit that was never pushed and three uncommitted entries, so before the test changes anything it is ahead 1, behind 0, with 3 uncommitted changes and no record of a fetch. The test then, with `execFileSync` git calls in temporary folders only:
   - reads the Dashboard's rows and asserts the branch line, `3 uncommitted changes.`, `1 commit ahead of origin/main.` and `there is no record of a fetch in it`;
   - clones the bare remote a second time in a temporary folder, commits there, pushes, fetches in the fixture repository, presses Refresh, and asserts the row now reads `1 commit ahead of and 1 commit behind origin/main.` and `it last fetched less than a minute ago`;
   - deletes the tracking ref with `git update-ref -d refs/remotes/origin/main`, refreshes, and asserts the row reads the `upstream-missing` sentence and shows no number;
   - asserts that the Dashboard's state line and Focuses by Stage are on screen before the first repository row is, which is the first-paint condition of the stage's gate, measured by asserting `dashboard-state` is visible while `repository-row` is still absent on the first paint;
   - clicks a row's name and asserts the Files window opens with that root selected.

**Tests.** Tier: end-to-end with `FakeGitHub`, as `space-dashboard.spec.ts` runs it.

**Gate.** The six commands, `npm run e2e` included.

---

## 8. What is not settled, for the Human Lead

Each question has a recommendation. A developer agent that reaches one before it is answered takes the recommendation and records it under "Choices made".

1. **Where the section sits on the Dashboard.** Recommendation: between Needs you and Focuses by Stage. Needs you holds pending gates and blocked sessions and must stay first; it is empty most of the time, so in practice Repositories is the first block under Start a session. The alternative is above Needs you, which puts the code question first always.
2. **Whether the Lore root gets a row.** Recommendation: yes, named `Lore`. Being behind on the Space repository means another desk pushed plan changes, which is the same question the stage asks of the code. The alternative is repository roots only, which is the literal reading of the stage's gate line.
3. **Whether a publish area outside the Space gets a row.** Recommendation: yes, after the repositories, in the same shape. It is a working tree the Human Lead works in. The alternative is to leave it out until it is asked for.
4. **Whether opening a Space may start the root tracker.** The Space window has never started the roots service; today only the Files window does. The section needs it, which means that on opening a Space the companion attaches one chokidar watcher per root folder, one per git folder and one per git index, and runs a first `git status` per root. Recommendation: yes, started after the first paint. The benefit beyond this stage is that the rows then follow file changes live without polling. The alternative is a second, watcher-free reader for the Dashboard, which duplicates `readChangesIn` and gives two answers for the same question in one application.
5. **The re-read rhythm.** Recommendation: a 60 second timer, plus the window gaining focus, plus a 500 ms debounced re-emit on a root's file events. A `git fetch` made in a terminal changes only refs and produces no file event, so without the timer the counts would stand still until the window was focused again. The number is a constant in `main/space/repositories.ts`, not a setting, until the Human Lead asks for one.
6. **Whether a row should offer an action that fetches.** The focus's non-goal names commit, push, pull and branch switch; a fetch is a read, but it contacts the network and writes refs into the repository, so this document treats it as out of scope. Recommendation: not in D1. Raise it after the Human Lead has used the reading for a while, which is what the focus says.
7. **How the age of the remote knowledge is measured.** Recommendation: the modification time of `FETCH_HEAD` only, with the two honest consequences stated on screen (section 4). The alternative is to add the reflog time of the tracking ref, which moves on a push as well as a fetch and would need a second command and a second sentence per row.
8. **Which baseline the changes line uses.** The root's baseline can have been pinned by the Human Lead in the Files window, in which case it is not the reviewed mark. Recommendation: show the root's current baseline, the same one the Files window shows, and name its source in the sentence, so the Space gives one answer. The alternative is to always compare with the reviewed mark on the Dashboard, which would make the two screens disagree about the same repository.
9. **A repository root whose folder is missing.** Recommendation: a row that states it, using `resolveRoots`'s own sentence. Dropping it would make a repository named in the manifest and absent on disk indistinguishable from one that is fine.
