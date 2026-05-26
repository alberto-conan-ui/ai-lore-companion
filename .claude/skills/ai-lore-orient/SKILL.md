---
name: ai-lore-orient
description: Session open — load the methodology, walk the focus chain, check for drift
---

# orient

`orient` is the **session-opening bookend.** Its aim: by the time the Human Lead asks the first question, the session is **expert on the active task** — ready to answer informed and act, not scrambling for context. The session runs `orient` on itself at the start of every session; the Human Lead does not invoke it.

To get there, orient loads the methodology if it isn't already loaded, walks the focus chain to its tip, reads whatever else the active focus depends on, surfaces any drift, and states where the work stands.

## What orient knows after running

- **The methodology.** The five pillars are loaded: [`project-structure.md`](../project-structure.md), [`memory.md`](../memory.md), [`status.md`](../status.md), [`verbs/verbs.index.md`](./verbs.index.md), [`bindings.md`](../bindings.md). On the plain-text path, `ai_readme.md` has just walked the session through them. On an installed engine, the SessionStart hook fires `orient` directly — the session reads the five files itself as its first step. Either way, by the time orient has finished, the session is AI-Lore-shaped.
- **The current context.** The focus chain has been walked from `memory/status/status.index.md` down through the active focus and (if present) the active AT node, to whatever is at the tip. The session knows the active focus and its `focus_type`, the dials and posture in status. The journal has been read — specifically the **handover** in the most recent journal file for the active focus, which says where the work was left and what the next session does first. Any blueprint relevant to the focus has been read — contracts the Payload must honour, processes the focus invokes, mirror nodes for areas the focus touches.
- **Whatever else the focus actually depends on.** Orient is not done at the focus chain alone. If the focus references a knowledge-tree entry, read it. If a gate or "done when" names a Payload file or area, read that. If the focus's journal trail mentions a prior session's finding that bears on what's next, pull the relevant entry. The aim is for the session to start *up to date with the work*, not merely up to date with the structure.
- **The state of both repos.** The drift check has run on each — a dirty tree in either is unacknowledged work, surfaced so the Human Lead can [`ack`](./ack.md), [`save-point`](./save-point.md), or continue knowing the state.

## Drift check — the right paths

The lore repo's `.git/` lives at `<lore>/memory/.git/`, **not** at `<lore>/.git/`. Running `git status` from inside `<lore>/` walks up to the Payload's `.git/` and reports that instead — a silent miss. Use the explicit form:

```
git -C <lore>/memory status
git -C <project> status
```

[`project-structure.md`](../project-structure.md) carries the full git arrangement.

## How it states the context

One readout: the active focus, its type, the posture, any drift, what is at the tip of the chain, the next step from the handover. If the project is headless, say so and wait for direction.

An engine binding may reinforce `orient` with a SessionStart hook so a session cannot open without it; the methodology does not depend on the reinforcement.
