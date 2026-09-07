---
name: ai-lore-runtime-session-protocol
description: "AI-Lore process runtime-session-protocol — how the app drives a read-only AI helper"
---

> Projected from `.ai-lore-ai-lore-companion/memory/blueprint/processes/runtime-session-protocol.process.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this process makes is confirmed with the Human Lead.


# The runtime↔session protocol

> **Written in the AI Helper arc, CR7 Phase 4, 2026-06-02.** The companion's runtime (the Electron app) drives a live, read-only AI session and renders its answers. This is the spec of *how* — the abstract capabilities a session engine must expose to be helper-capable, and the two concrete mappings built so far (Claude, Gemini). It is **promotion-prep**: the same shape is a strong candidate for a new facet of AI-Lore's [`bindings.md`](../../../.ai-lore-ai-lore-companion/references/ai-lore.md) (today only verbs→skills and bookends→hooks). Until that promotion lands in `ai-sdlc`, the spec lives here as the companion's own record. References are read-only — promotion is a separate move in `ai-sdlc`, never an edit through the reference.

## What a helper turn is

The runtime feeds the session **one read-only prompt at a time** (a canned action or free-text question), the session answers, the answer renders in the Assistant panel. Turns are **serialized** — one in flight per window. The session never writes the project; that guarantee is the [`helper-read-only` contract](../../../.ai-lore-ai-lore-companion/memory/blueprint/contracts/helper-read-only.contract.md), and it is a property of how the session is *launched* (capability 4 below).

## The four capabilities (the seam)

An engine is **helper-capable** iff the runtime can do all four of these with it. They are exactly what the engine-adapter seam (`HelperEngine<H>`, `packages/app/src/main/helper/engine.ts`) abstracts; everything above the seam — the IPC layer, the renderer panel, the Channel-C event shape — is engine-neutral.

| # | Capability | What the runtime needs | Why it can differ per engine |
|---|---|---|---|
| 1 | **drive-a-turn** | Hand the session a prompt and cause it to process it. | An interactive engine needs inject-then-submit; a headless engine takes the prompt as an argument. |
| 2 | **turn-complete signal** | Know, deterministically, when the turn is done. | A persistent session needs an out-of-band "Stop" signal; a one-shot process signals by exiting. |
| 3 | **structured result** | Get the assistant's answer text back, not scrape a terminal. | Source is a transcript file, a hook payload, or stdout JSON. |
| 4 | **read-only launch** | Launch the session so it *cannot* write the project or reach the network. | Each engine has its own permission/policy mechanism; this must be set at spawn (see the contract). |

The seam is generic over a per-window **host** `H` — the window-specific bundle a turn needs (Claude: a PTY spawn; Gemini: cwd + model). The IPC layer (`ipc/helper.ts`) resolves the engine, builds the right host, and drives `connect`/`submit` without knowing which engine answers.

## The transport channels

The code names four channels (`helper/manager.ts`, `helper/index.ts`, `helper/hooks.ts`):

- **Channel A — app → session (drive-a-turn).** The input leg. For Claude this is the one **unsupported, UI-automation** leg — PTY stdin write + a bare carriage return — deliberately **isolated in one swappable function** (`manager.ts` `submit`) with the supported headless path as the fallback. A headless engine has *no* Channel A: the prompt is an argv.
- **Channel B — session → app (turn-complete + result).** Only an engine with a persistent out-of-process session needs it: a localhost-bound, token-authed HTTP middleman (`helper/middleman.ts`) the session's hooks POST to. Claude's `SessionStart` hook signals "up", its `Stop` hook extracts the last assistant text from the transcript and POSTs it. A headless engine collapses B into the process result.
- **Channel C — app → renderer (egress).** Engine-**neutral**. Every state change is one `HelperEventPayload` phase (`connecting`/`ready`/`thinking`/`answered`/`error`, plus `ptyId` only when there's a visible session) pushed over Electron IPC. Both engines emit the identical shape — this is what keeps the renderer ignorant of the engine.
- **Channel D — read-only launch (capability 4).** Not a wire; the launch-time permission profile. Claude: a deny-writes `--settings` file. Gemini: an `--admin-policy` deny TOML. Owned by the contract.

## Identity & lifecycle

- **One helper session per window.** Keyed by `winId`. `disposeForWindow` tears it down on window close; `disposeAll` on quit.
- **Per-session secrets are minted per Connect and baked into the out-of-tree config** — for Claude the middleman `{sessionId, token, port}` go into the generated hook scripts in a throwaway temp dir (`helper/index.ts` `materialize`); never the user's `~/.claude/` or `~/.gemini/`.
- **Engine choice is per project**, persisted as `helperEngine` (`engine-state.json`), resolved by the pure `pickHelperEngine`. Switching it calls `helperReset` so the next Connect launches the new engine.

## The two concrete mappings

| Capability | **Claude** (visible PTY) | **Gemini** (headless) |
|---|---|---|
| 1 drive-a-turn | PTY stdin inject + `\r` (Channel A, `manager.ts`) | argv `-p <prompt>` — one process per turn |
| 2 turn-complete | `Stop` hook POSTs to the middleman (Channel B) | process exit |
| 3 structured result | `Stop` hook reads transcript JSONL, POSTs the text | stdout `-o json` → `response` (`parseGeminiResult`) |
| 4 read-only launch | deny-writes `--settings` profile | `--admin-policy` deny TOML, `default` mode |
| visible session? | **yes** — a PTY the panel binds an xterm to | **no** — renders as answer cards |
| middleman (Channel B)? | yes | no |

**Why they differ so much:** Claude's headless mode needs a setup-token + a separate credit pool, so the helper drives an *interactive* OAuth `claude` in a PTY — hence Channels A and B. Gemini's headless `-p` runs on the user's OAuth directly, so it needs no PTY, no hooks, no middleman: capabilities 1–3 collapse into "spawn one process, read stdout." The spike (focus Phase 0 / CR7 Phase 0) proved both. This asymmetry is the whole reason the seam exists — and the proof it's drawn in the right place.

## A new-engine checklist

To add engine *E* behind the seam:

1. Confirm all four capabilities exist for *E*, on the user's own login (**OAuth, no stored secrets** — a focus invariant). If read-only launch (4) can't be guaranteed, stop — the contract can't hold.
2. Implement `HelperEngine<HostE>`: map each capability to *E*'s mechanism; emit the standard Channel-C phases; declare `hasVisibleSession`.
3. Add *E*'s binary to `HELPER_CAPABLE_BINARIES` and route it in `pickHelperEngine`.
4. Add *E*'s read-only mechanism to the contract's engine table and assert its launch shape in a headless test.
5. **Check Q&A quality, not just write-blocking** — the CR5/Gemini trap: a "plan / read-only mode" can pass write-blocking yet wreck the answer by turning the session into a planning agent. The contract records why.

## Open questions for promotion (to `ai-sdlc`)

- The four capabilities generalize cleanly; **Channel C (the app→renderer egress) is companion-specific** — AI-Lore would define the session↔runtime capabilities, and leave rendering to the consumer.
- The **middleman/token transport** is an artifact of Claude needing an interactive session; a methodology-level spec should treat Channel B as "turn-complete + result by whatever out-of-band mechanism the engine offers," not mandate HTTP.
- Whether **read-only launch** belongs in `bindings.md` or in a security contract of its own is a `ai-sdlc` design call.

## Change log

- **2026-06-02 — CR7 Phase 4.** First recorded. Captures the four capabilities, the A/B/C/D channels, identity/lifecycle, and the Claude + Gemini mappings as built in `packages/app/src/main/helper/`. Promotion into AI-Lore's `bindings.md` flagged as a separate, later move in `ai-sdlc`.
