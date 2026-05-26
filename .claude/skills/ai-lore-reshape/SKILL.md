---
name: ai-lore-reshape
description: Set posture to Reshaping — work on Memory, Payload read-only
---

# reshape

`reshape` sets the session's posture to Reshaping. While in Reshaping, Memory is the working material; the Payload is read-only.

## The operation

1. **Write the posture to status** — set `posture: reshape` in `status/status.index.md` via [`write-lore`](./write-lore.md).
2. **Work on Memory** through `write-lore`. A restructure that keeps content proceeds ungated; a rebuild that discards content trips `write-lore`'s discard guard and waits for explicit Human Lead confirmation.
3. **Refuse Payload writes** while Reshaping. A request to edit the Payload is held until the Human Lead invokes [`execute`](./execute.md).

The posture is the gate. A Memory tree whose shape has drifted, content the Human Lead no longer trusts, a stale handover — these are reshape's domain. The session stays here until a posture verb moves it.
