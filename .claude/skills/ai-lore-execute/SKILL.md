---
name: ai-lore-execute
description: Set posture to Executing — produce the Payload (the default)
---

# execute

`execute` sets the session's posture to Executing. While in Executing, the session produces the Payload against the active focus and its gates.

Executing is the **default posture** — the value status carries when no other posture has been set, and the value `init` writes at project creation.

## The operation

1. **Write the posture to status** — set `posture: execute` in `status/status.index.md` via [`write-lore`](./write-lore.md). Skip the write if status already records `execute`.
2. **Produce the Payload** against the focus and any phase gates. Record progress in Memory via `write-lore`.
3. **Stop** when the focus gate is met or the Human Lead names a different posture.

The posture is the gate. Executing lifts the Payload read-only rule that `plan` and `reshape` impose; the session can write the Payload because the posture says so.
