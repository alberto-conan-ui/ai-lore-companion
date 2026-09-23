# AGENTS.md — read this file first

This file is the entry point for an AI session working in this repository. `CLAUDE.md` contains `@AGENTS.md`, so Claude Code reads this file too.

A session on this repository follows its own Space's `AGENTS.md` for how work goes from issue to pull request, its rules, and the words a session needs. This file describes the repository itself: what it holds, how it is built and tested, and its own conventions.

## What this repository is

`ai-lore-companion` is a desktop host for AI-Lore projects: an Electron app that opens a project ("a Space") in its own window, drives AI engine sessions (Claude Code, Codex, Antigravity, OpenCode) inside it, and renders a Dashboard over the project's GitHub Project. It is the payload repository of the Space `ai-lore` (`alberto-conan-ui/ai-lore`), checked out on that Space's desk at `repos/ai-lore-companion/`.

## Layout

```
packages/core/    Pure-Node TypeScript, no Electron. Chain/frontmatter reading,
                   the desk (open, lifecycle, guards, claims), GitHub (gh-cli
                   port + FakeGitHub), the Space migration steps, dashboard
                   model and derivations. node:test suite. Resolved by the app
                   through its build output (packages/core/dist), not its
                   source — see "Build core after switching branches" below.
packages/app/      Electron + React + Zustand shell over core/.
  src/main/         Main process: IPC, engines, space/ (sessions, GitHub
                     service, mirror-drift, session-server for the PM's MCP
                     tools).
  src/main/space/sessions/  Per-engine adapters (claude-code.ts, codex.ts,
                     antigravity.ts, opencode.ts) and standard-lore.ts, which
                     detects a Space with an AGENTS.md and drops the write-guard
                     and lore plugin for it (ai-lore#144).
  src/preload/      The typed IPC bridge.
  src/renderer/     The React UI: the dockable workspace, the Files views, and
                     src/renderer/src/space/dashboard/ for the Dashboard (the
                     "dashboard v2" bands: Dashboard.tsx, FocusesByStage.tsx,
                     AgentsBoard.tsx, NeedsYou.tsx, Repositories.tsx, and their
                     …Text.ts copy modules).
  src/shared/       Types and IPC contracts shared between main and renderer.
  scripts/typecheck.ts  The app's typecheck script — see below.
  test/headless/    Main-process tests (node:test, run against a built dist-test).
  test/component/   Renderer/React tests (vitest).
  test/*.spec.ts    End-to-end tests (Playwright, driving the real Electron app).
packages/docs/     Design and architecture notes, not code.
packages/spec/     The AI-Lore spec this app can provision into a new project
                   (`process/` — verbs, processes, contracts, `ai-lore.py` —
                   plus `lore-1.0/`). Still referenced by packages/core/src/space
                   (install, setup) and packages/app/src/main/template-dir.ts.
                   Edit here, not in a generated project's own Lore.
archive/poc/       The original JS proof-of-concept. Left unchanged.
```

## Building and testing it

**Build `core` after switching branches.** The app resolves `@ai-lore-companion/core` through its build output (`packages/core/dist`), not its source. Switching branches without rebuilding typechecks the app against another branch's types. Run:

```bash
npm run build -w @ai-lore-companion/core
```

**There are four suites, and no single command runs them all.**

| Suite | How it is run | What it covers |
|---|---|---|
| core | `npm test -w @ai-lore-companion/core` | everything in `packages/core`, `node:test` |
| app headless | `npm run test:headless -w @ai-lore-companion/app` | the main process: IPC, services, the desk |
| app component | `npm run test:component -w @ai-lore-companion/app` | the rendered React bands, vitest |
| end-to-end | `npm run e2e` | the real app, Electron under Playwright |

`npm run verify` runs, in order: `lint` (`biome check .`), `build -w core`, `typecheck -w app`, then `test --workspaces --if-present`. The app's own `test` script is `test:headless && test:component`, so `verify` covers lint, the build, the type check and the first three suites. **`verify` does not run the end-to-end suite.** CI does, as a separate job (see below).

`test:headless` alone is not "the app's tests" — it misses every component test, which is where the rendered Dashboard bands are covered.

**The type check is `npm run typecheck -w @ai-lore-companion/app`** (`vite-node scripts/typecheck.ts`), not `npm run typecheck:node -w @ai-lore-companion/app` (`tsc -b tsconfig.node.json`, main/preload/shared only). The app's own script checks two projects: `tsconfig.node.json` must have no error; `tsconfig.web.json` (the renderer) is checked against a baseline recorded in `typecheck-baseline.json`, because it carried pre-existing errors when the check was repaired on 2026-09-18. It fails on an error that is not in the baseline or that occurs more often than the baseline says; a fixed error is reported, and the baseline is then lowered with `npm run typecheck -w @ai-lore-companion/app -- --update` (refuses to record a new error). `--print` prints the baseline that matches the current state without writing.

Two test runs at once can hang each other: both `test:headless` scripts start with `rm -rf "$OUT"`, defaulting to `dist-test`. Run one at a time, or set `AI_LORE_CORE_TEST_OUT` and `AI_LORE_APP_TEST_OUT` to separate directories.

CI (`.github/workflows/ci.yml`) runs two jobs on every push to `main` and every pull request: `fast` (`npm run verify`, i.e. lint, core build, typecheck, and the non-e2e tests) and `e2e` (a full Electron build, then `npm run e2e` under `xvfb-run`). Each job has its own `timeout-minutes`; a required check with no timeout is a merge queue with no bottom.

**A test fixture that builds a Project must set every axis the code under test reads**: `Level`, `Stage`, `Status`, and the kind label. A fixture that sets a `Stage` and leaves another axis unset has broken silently before. Fixtures live in `packages/app/test/*.spec.ts` (end-to-end), `packages/app/test/component/space/dashboard-fixtures.ts` and its neighbours (component), and `packages/core/test/space/github-contract.ts` (the shared port contract, run against both `FakeGitHub` and the gh adapter).

## Lint and format

```bash
npm run lint    # biome check .
npm run format  # biome format --write .
```

Biome enforces formatting and a project-local rule that blocks `packages/core` from importing from `electron`; `core` stays headless so its suite runs without spawning Electron.

## Conventions

- `FakeGitHub` (`packages/core/src/space/github/fake.ts`) is what every test run and end-to-end test sees; `main/space/live-github.ts` forces it. A new port operation that lands without its fake means the panel using it ships untested. Its state file pins `version: 1` and its loader throws on anything else, so add a field backward-compatibly rather than bumping the version.
- Adding an option to a `Level`/`Stage`/`Status`/kind union is a renderer change, not just a core change: the Dashboard's `else`-chains only learn about it once `typecheck -w app` sees it.
- `packages/spec/` is the canonical copy of the spec this app provisions into new projects. A project's own operating Lore is generated from it; never edit a generated project's Lore in place expecting it to flow back here.
