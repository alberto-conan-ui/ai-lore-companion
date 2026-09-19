# Architecture Document: M10 Polish

## Overview
This document outlines the technical design for the M10-polish phase of the MVP AI-Lore Companion.

## 1. Color Scheme per AI-Space & Title
- **Requirement:** Apply a color scheme per AI-Space to all windows, and display a large AI-Space title at the top.
- **Design:**
  - Update `packages/app/src/renderer/src/App.tsx` and `SpaceWindow.tsx` to read the AI-Space identity from the project data.
  - Expose a `colorScheme` property to the `SpaceWindowInitPayload`.
  - Inject CSS variables dynamically into the root element for consistent theming across all windows (Dashboard, Files, Sessions).
  - Add a sticky header component displaying the AI-Space title prominently across windows.

## 2. Multi-Engine Support & Auto-Install
- **Requirement:** Detect installation status for Claude, Antigravity, OpenCode, Codex. Offer installation flow if missing.
- **Design:**
  - Extend `checkSessionEngine` in `packages/app/src/main/space/sessions/preflight.ts` and `engines.ts` to probe binaries for Antigravity, OpenCode, and Codex.
  - Modify `EngineStartControl.tsx` to handle a `not-installed` state specifically, revealing an "Install" action button.
  - Create a new `EngineInstallFlow` UI component triggered via `runFix` that runs the necessary shell commands to install the selected engine.

## 3. Execution Flags
- **Requirement:** UI to add/edit/toggle execution flags (e.g. `--dangerously`) when starting sessions.
- **Design:**
  - Add an `executionFlags` array to `startSession` in `SpaceSessions.tsx`.
  - Update `EngineStartControl.tsx` to include an expandable settings panel with checkboxes for flags like `--dangerously`.
  - Pass the selected flags through `window.cockpit.spaceSessionStart({ engineId, flags })` to the IPC handler, and update `engineArgv` in `command-line.ts` to append these flags to the engine arguments.

## 4. Bug Fix: Session Limit
- **Requirement:** Fix the issue where only 2 sessions can be opened simultaneously.
- **Design:**
  - Investigate the concurrency limits in `packages/app/src/main/space/sessions/service.ts`, `session-server/broker.ts` or `packages/core/src/space/desk/lifecycle.ts`.
  - Also ensure that PTY allocation and MCP host registration (in `packages/app/src/main/helper/mcp-host.ts`) correctly support >2 concurrent processes.
  - Adjust any arbitrary limits (e.g., `MAX_SESSIONS` or `startableCount`) restricting the UI or backend from spawning multiple engines.
