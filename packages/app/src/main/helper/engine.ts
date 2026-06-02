/**
 * The helper-engine seam (AI Helper, CR7). The app drives a read-only AI
 * assistant that answers questions about the project; *which* engine answers is
 * a config choice, not a rewrite. This interface is the boundary: everything
 * above it (the IPC layer, the renderer panel, the `HelperEventPayload` Channel-C
 * events) is engine-neutral; everything engine-specific lives in an
 * implementation.
 *
 * The CR7 Phase-0 spike validated the seam by exposing how *different* two
 * engines are underneath:
 *   - **Claude** ({@link ./manager.ts}) hosts a persistent, **visible** PTY
 *     session driven by inject+CR, with a Stop hook + middleman returning the
 *     answer — because Claude's headless mode needs a setup-token + a separate
 *     credit pool.
 *   - **Gemini** ({@link ./gemini.ts}) runs **headless** one process per turn
 *     (`gemini -p … -o json`) on the user's OAuth, no visible session.
 *
 * The interface is generic over the per-window **host** `H` — the
 * window-specific capability bundle a turn needs (Claude: a PTY spawn; Gemini:
 * the project cwd + model). The IPC layer builds the right host for the
 * resolved engine and drives it through this one shape.
 */

import { basename } from 'node:path';
import type { EngineEntry } from '@ai-lore-companion/core';
import type { HelperEventPayload } from '../../shared/ipc.js';

/** The engine binaries the read-only helper can drive (CR7). Claude runs as a
 *  visible PTY; Gemini runs headless. Any other registered engine is not
 *  helper-capable and is never offered or resolved. */
const HELPER_CAPABLE_BINARIES = new Set(['claude', 'gemini']);

/** Whether an engine can back the helper — matched on the binary's basename, so
 *  an absolute path (`/opt/homebrew/bin/gemini`) still classifies. */
export function isHelperCapable(engine: EngineEntry): boolean {
  return HELPER_CAPABLE_BINARIES.has(basename(engine.binary));
}

/**
 * Decide which engine the helper uses, from the registered engines and the id
 * the user picked in the Assistant dropdown (`null` = no pick). Pure + the
 * single source of truth shared by the IPC resolver and asserted in tests.
 *
 * The **default** (no/unknown pick) is the *first helper-capable engine* — the
 * exact engine the dropdown shows by default — so the UI and the backend can
 * never disagree (the CR7 "showed Gemini, launched Claude" bug). A pick whose
 * binary is `gemini` routes to the headless Gemini engine; everything else
 * (including Claude) uses the Claude path.
 */
export function pickHelperEngine(
  engines: readonly EngineEntry[],
  pickedId: string | null,
): { kind: 'gemini'; entry: EngineEntry } | { kind: 'claude' } {
  const capable = engines.filter(isHelperCapable);
  const entry = (pickedId ? engines.find((e) => e.id === pickedId) : undefined) ?? capable[0];
  if (entry && basename(entry.binary) === 'gemini') return { kind: 'gemini', entry };
  return { kind: 'claude' };
}

/** A helper engine — the per-window lifecycle the IPC layer drives. Both the
 *  Claude manager and the Gemini helper conform to this; the renderer never
 *  knows which one is behind a given window. */
export type HelperEngine<H> = {
  /** Stable engine id (matches the `EngineEntry` family: `claude`, `gemini`). */
  readonly id: string;
  /** Whether this engine hosts a visible on-screen session (Claude: yes — a
   *  PTY the panel binds an xterm to; Gemini: no — headless answer cards). The
   *  renderer uses this to decide whether to show a terminal. */
  readonly hasVisibleSession: boolean;
  /** Ensure the window's helper is connected; resolves once it can take turns. */
  connect: (winId: number, host: H) => Promise<void>;
  /** Connect if needed, then drive one read-only turn with `prompt` (the IPC
   *  layer builds the prompt — it holds the project context). */
  submit: (winId: number, host: H, prompt: string) => Promise<void>;
  /** Tear down the window's helper. */
  disposeForWindow: (winId: number) => void;
  /** Tear down every helper this engine owns. */
  disposeAll: () => Promise<void>;
};

/** Re-exported for implementations that emit Channel-C events. */
export type { HelperEventPayload };
