# AI-Lore

A desktop host for AI-Lore projects — each project in its own window. It reads
a project's tracker chain (`mode → focus → active phase`), watches the project
for file writes, surfaces unacked changes as a queue with a drift indicator,
and persists that queue in a per-project SQLite database. Tracker files moving
into `Review` show up as distinct events so the Human Lead can see the moment a
phase asks for review, not just the file write that caused it.

Each project window is a **dockable workspace**: left, right, and bottom panels
host movable tabs — the project cockpit, integrated terminals, and embedded
browser tabs with isolated profiles. App-launch shortcuts open the project (or
its Lore) in your editor of choice. Opening a folder that is not yet an AI-Lore
project hands you a terminal and a link to convert it.

It is the visible product surface of the [AI-Lore methodology](https://example/ai-lore) —
the methodology defines how AI sessions and humans collaborate against a
project's Memory; the cockpit makes that collaboration tangible.

## Prerequisites

- **Node.js ≥ 20** (Node 23.x recommended — `node:test` ships natively and is
  used by the `core` test suite).
- **macOS** (Linux/Windows packaging is post-V1; dev mode may work on Linux
  but is not tested).
- **Xcode Command Line Tools** (for native module compilation: `xcode-select
  --install`).

## Install

```bash
git clone <repo-url> ai-lore-companion
cd ai-lore-companion
npm install
```

A `postinstall` hook in `packages/app/` rebuilds `better-sqlite3` against
Electron's Node ABI so the desktop shell can open the DB on first launch.

## Run

```bash
npm run dev
```

Launches the Electron cockpit in development mode against this project's own
Lore. Hot module reload is wired for the renderer.

To point the cockpit at a different AI-Lore project, pass `--root`:

```bash
npm run dev -- --root /path/to/some/other/ai-lore-project
```

Or set the `COCKPIT_ROOT` environment variable.

## Space PM (Post-MVP thin slice)

Opening an AI-Lore 1.0 Space automatically starts one guarded **PM** tab in
Sessions. If its engine or Lore installation is unavailable, Sessions explains
why and offers Retry PM. Ordinary `+ AI` sessions remain independent.

In the PM terminal, ask: `You are the PM. Please update the dashboard.` The
**Draft dashboard request** button inserts that message; press Enter to send it.
The PM reads the role and dashboard definitions, then calls the authenticated
`report_dashboard` MCP tool. Dashboard shows the latest report as literal text,
with the submitting session, receipt time and a warning after the Project
source changes or the PM ends. The existing factual Project board is unchanged.

The first PM uses the Space's ready remembered engine, or the first ready engine,
and remembers that binding separately as `pm-profile`. Its engine profile's
`model` is passed to the CLI; an unset model uses the engine's default. A missing
bound engine or unsafe default parameters produce a refusal, never a silent
switch or an automatic unguarded start. Role/model selection has no new settings
UI in this slice.

New Spaces receive `lore/corpus/default/pm.md` and `dashboard.md`. To customise
the report, create `lore/corpus/dashboard.md` with its index entry under a
confirmed Lore claim. Older Spaces without these cards use the app's shipped
definitions without modifying their Lore.

The PM stays Read only for reporting. It is window-scoped, not a background
supervisor; closing the PM stops it, and Start PM/Restart starts a new session.
Closing the Space stops its sessions and discards the report. This slice adds
neither worker delegation nor the v1.1 resident AI Lead runtime.

The isolated integration check uses real Electron, terminal I/O and the MCP SDK
with a deterministic model stand-in (no model API spend):

```bash
npm run build
cd packages/app
../../node_modules/.bin/playwright test space-pm.spec.ts
```

## Test

```bash
npm test              # core unit suite (node:test, ~5s)
npm run test:e2e -w @ai-lore-companion/app   # Playwright end-to-end (~5s)
```

The core suite runs against bare Node. The e2e suite builds the Electron
bundle and drives it via `_electron`. Both will trigger `better-sqlite3`
ABI rebuilds when switching between Node and Electron contexts — first run
after a switch is slower.

## Lint and format

```bash
npm run lint    # biome check
npm run format  # biome format --write
```

Biome enforces formatting and a project-local rule that blocks `packages/core`
from importing from `electron`. The `core` package must stay headless so the
test suite can run without spawning Electron.

## Build

```bash
npm run build   # both workspaces — core: tsc, app: electron-vite
```

## AG Grid license

The file grid uses **AG Grid Enterprise**. Set `VITE_AG_GRID_LICENSE_KEY` so the
grid runs without the evaluation watermark. Vite embeds `VITE_`-prefixed
variables at build time, so the key must be present in the environment that
runs `npm run dev` or `npm run dist`:

```bash
export VITE_AG_GRID_LICENSE_KEY="<your-key>"
```

Source the key from the AG Grid account holder — it is not committed to the
repo. Without a key the cockpit still runs fully; the grid just shows the AG
Grid evaluation watermark. Production `.dmg` builds should always be produced
with the key set:

```bash
VITE_AG_GRID_LICENSE_KEY="<your-key>" npm run dist -w @ai-lore-companion/app
```

## Distribute

```bash
npm run dist -w @ai-lore-companion/app
```

Produces an **unsigned** `.dmg` plus the underlying `.app` bundle under
`packages/app/dist/` via electron-builder. macOS arm64 only for V1.

## Layout

```
packages/core/   pure-Node TypeScript — chain reader, queue, watcher,
                 SQLite persistence, node:test suite
packages/app/    Electron + React + Zustand shell over core/ —
                 typed IPC bridge, tracker strip, queue UI, Playwright tests
archive/poc/     The original JS proof-of-concept that validated the thesis
.ai-lore-ai-lore-companion/
                 The project's own Lore — tracker chain, journal, KT, blueprint
```

## Current limitations

- **macOS, Apple Silicon only.** The `.dmg` targets `arm64`; Intel Macs and
  Linux/Windows are not built.
- **Unsigned.** No Apple Developer ID signature or notarisation — macOS
  Gatekeeper warns on first open. Right-click ▸ Open, or allow it in System
  Settings ▸ Privacy & Security.
- **No Homebrew Cask.** Distribution is a direct `.dmg`.
- **Asar packing is disabled** in the distributable as a workaround for an
  electron-builder limitation around workspace-symlinked dependencies. The
  app ships with `node_modules/` unpacked — larger app, slightly slower first
  load.
- **No walk-up.** The app takes the project root as given — it does not
  search ancestors for a `.ai-lore-<name>/` folder. Pass `--root` or launch
  from the project root.
- **No background daemon.** Events that happen while the app is closed are
  not captured. Each launch baselines against the disk's current state, then
  restores persisted unacked entries from prior sessions.

## What's next

Code signing and notarisation — so the `.dmg` opens without a Gatekeeper
warning — and CI remain the main deferred work.
