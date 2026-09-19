# M10 Polish — Product Specification

Written 2026-09-19 for the CTO, extending the AI-Lore Companion 1.0 MVP with four critical requirements. This document outlines the expected product changes to be built in the `M10-polish` stage, prior to the final M8 switch.

## 1. Color Scheme per AI-Space

Every AI-Space must have a visual identity that immediately separates it from others, reducing context-switching errors.

- **Distinct Colors:** Each Space receives a distinct color scheme (e.g., a primary hue mapped to the Space's ID or name) upon creation. This color scheme must be applied to all windows belonging to that Space (Dashboard, Sessions, Files, etc.) as a theme/accent color.
- **Large Title:** Every window of a Space MUST display a large, prominent title at the very top containing the AI-Space name.

## 2. Multi-Engine Support & Auto-Install

The MVP must explicitly support the four primary agents: Claude, Antigravity, OpenCode, and Codex.

- **Status Detection:** The companion must identify whether each of these agents is installed locally.
- **In-Session Warning & Installation:** When starting a session, if the selected LLM is not installed, the session screen must prevent the start, display a prominent warning, and offer a clear, one-click installation flow directly from that screen.
- **Guarded Sessions for All:** In contrast to previous design constraints, ALL of these agents are permitted and supported for guarded Space sessions.

## 3. Execution Flags

LLMs often require additional runtime flags (e.g., `--dangerously` for autonomous or root-level runs).

- **Flag Management:** The UI must provide a way to easily add, edit, and remove custom execution parameters for each engine.
- **Session Toggle:** When initiating a session, the configured flags must be visible as toggles, allowing the user to turn them on or off on a per-session basis before confirming the start.

## 4. Bug Fix: Simultaneous Sessions

The Human Lead reported an issue in their previous test: the app fails to open more than 2 sessions simultaneously.

- **Fix Requirement:** The session manager (and any associated PTY/IPC limits) must be patched to support more than 2 concurrent sessions without silent failures or crashes. Errors related to concurrent process limits or port assignments must be resolved.
