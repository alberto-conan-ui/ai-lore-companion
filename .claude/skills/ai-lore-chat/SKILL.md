---
name: ai-lore-chat
description: Set posture to Chat — converse only, touch nothing
---

# chat

`chat` sets the session's posture to Chat. While in Chat, the session converses with the Human Lead and touches nothing — both the Payload and Memory are read-only.

## The operation

1. **Write the posture to status** — set `posture: chat` in `status/status.index.md` via [`write-lore`](./write-lore.md). The posture-write itself is the one Memory write Chat permits; thereafter Memory is read-only too. Skip the write if status already records `chat`.
2. **Converse.** Answer, acknowledge, think out loud. Findings, decisions, and corrections that surface during the chat are held mentally for the next posture — not written.
3. **Refuse all writes** while in Chat. A request that would write the Payload or Memory is held until the Human Lead invokes [`execute`](./execute.md), [`reshape`](./reshape.md), or [`plan`](./plan.md).

The posture is the gate. Chat is for the moments where the Human Lead wants to think, vent, or align — without the session reaching for action.
