# Why making the plan took over a minute (diagnosis, 2026-09-19)

A developer's measured diagnosis of finding 6 in the manual-check feedback. No code was changed while diagnosing.

## What the create-Space plan runs

`spaceSetupPlan` (`packages/app/src/main/space/ipc/setup.ts`) → `setupDeps()` → `planCreateSpace` → `prepareCreate` → `planCreate` → `refuseForeignMatches` → `planSteps` (`packages/core/src/space/setup/flows.ts`, `setup/steps.ts`, `steps/run-steps.ts`). Every call runs one after another. There are no retries. `gh` has a 60 s timeout per call (`gh-cli.ts`); `git` has no timeout, and the runner does not set `GIT_TERMINAL_PROMPT=0`. Nothing is logged per call and no progress is reported during the plan.

Order for an existing Space:

1. `setupDeps`: `$SHELL -i -l -c printf PATH`, once per plan, 10 s timeout; then the `github-port` log line.
2. `refuseForeignMatches`: `gh api graphql` REPOSITORY_QUERY; `git ls-remote --heads -- https://github.com/<owner>/<name>.git` (network, no timeout); local git reads (`rev-parse --show-toplevel`, origin URL, `HEAD`, `isPushed`); `gh api graphql` OWNER_PROJECTS_QUERY (pages of 100); the manifest. READ_PROJECT_QUERY runs when the manifest is absent.
3. `planSteps`: each step's `isDone` and `describe`. GitHub lookups are cached only when they find something.

The call count grows in two ways:

- A failed lookup is not cached, and a `null` result is not cached. `refuseForeignMatches` sets `foreignChecked` only on success; on a failure that is not "taken", `planCreate` carries on, and the `isDone` of `space-repository` and `project` each run the whole check again. A stalled call can run up to three times in one plan.
- For a new name, the `null` repository and Project results are asked again by the `space-repository`, `project` and `scaffold` checks: about five gh calls instead of two.

## Measured (real account, read-only)

| Call | Time |
|---|---|
| `zsh -i -l -c 'printf $PATH'` | 0.12 s |
| `gh auth status --json hosts` | 0.39 s |
| REPOSITORY_QUERY (existing, new, missing) | 0.38–0.42 s |
| OWNER_PROJECTS_QUERY (one page) | 0.43 s |
| `git ls-remote` of the private `test` repository | 0.76–1.73 s |
| READ_PROJECT_QUERY | 0.56–0.58 s |
| PROJECT_FIELD_QUERY | 0.44 s |

A normal plan costs 2–4 s. The app log agrees (the `test2` plan and its confirmation took under 9 s).

## Cause

The number of calls cannot explain over a minute. One network call stalled, and the code lets a stall be unbounded (git has no timeout, gh has 60 s), repeated (failures are not cached; each `isDone` re-runs the checks) and silent (a failed check shows the step as "to do" instead of stopping the plan). The same pattern is in the log of 2026-09-18 (`space-repository` checking at 22:14:42, running at 22:16:14: 91.6 s). The only unbounded call is `git ls-remote` over HTTPS, which goes through the macOS keychain credential helper; it is the leading suspect. If the keychain has no GitHub credential and the app was started from a terminal, git asks for a password there and waits forever.

## Fixes recommended

1. A timeout on every network command. Better: replace `git ls-remote` with a GraphQL query of the repository's branch heads through `gh` (same sign-in, no keychain, about 0.4 s). Otherwise `ls-remote` with about 15 s, `GIT_TERMINAL_PROMPT=0` and `GCM_INTERACTIVE=never`. gh reads at about 20 s.
2. Cache "found / not found / failed" for one plan or run, so `refuseForeignMatches` runs at most once. A failed lookup stops the plan with the GitHub error.
3. Run the repository and Project lookups in parallel.
4. One log line per GitHub or git call: kind, query name, time, outcome.
5. Progress events during the plan (an `onProgress` in `planSteps` and `refuseForeignMatches`), naming the check under way, and a time limit on the whole plan with a message.

## The uncommitted `missingIsNull` change in `gh-cli.ts`: keep it

GitHub answers `field(name:)` for a field that does not exist with `data.node.field = null` plus a `NOT_FOUND` error, and `gh` exits 1. `missingIsNull` accepts an answer whose only errors are `NOT_FOUND` and reads the null. Without it, `ensureSingleSelectField` fails on every new Project and `readProject` fails while the Stage field is missing; both failures are in the log of 2026-09-18 (22:08:45, 22:12:36). It is the change that made Space creation work. It is not related to the slowness.

Follow-ups: the fixtures model a missing field wrongly (`FIELD_MISSING_BODY` and `github-simulated-gh.ts` near line 287 return `field: null` with no error and exit 0) and should return `NOT_FOUND` with exit 1. Optionally, accept only a `NOT_FOUND` at the `stage` path of READ_PROJECT_QUERY.

## Note on the "Set up the Project" step

It is never marked done (`isDone` is always false), so every re-run runs it again. The result screen should say it was re-applied, not present it as the step that was missing.
