---
name: ai-lore-redial
description: Set the dials — the conversational register
---

# redial

`redial` re-attunes the session — to its conversational register (the two dials) and to the shape of the work it is currently doing. The verb is loaded only when invoked; this is deliberate, because a register instruction held as a standing rule degrades under task load. Loaded on `redial`, the dial setting is high-signal exactly when it is applied. Definitions for the dials and the postures live in [`status.md`](../status.md); this document is the operation that applies the re-attunement.

## What redial does

- **Re-reads [`status.md`](../status.md) and the active focus** so the register applies to the work as it actually is, not as the session remembers it from earlier turns.
- **Applies the requested setting** — two dial stops (an Altitude and a Commitment), or a named preset. If no new setting is named, re-applies what status currently records.
- **Names the setting** so the Human Lead sees the register the session is moving to.
- **Names what the setting suppresses.** At high Altitude a point gets dropped; at *Go* Commitment a concern gets withheld. If the setting is about to cost the Human Lead information, that cost is named when the setting is applied.

Every following response writes from that setting until the next `redial`.

`redial` changes the conversational register only. The task, the conclusion, and any Memory write are unchanged by it. Posture is changed by its own verbs.
