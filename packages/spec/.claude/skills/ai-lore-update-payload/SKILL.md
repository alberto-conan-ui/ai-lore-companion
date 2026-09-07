---
name: ai-lore-update-payload
description: "AI-Lore verb update-payload — the floor verb for Payload writes"
---

> Projected from `.ai-lore-ai-sdlc/memory/blueprint/verbs/core/payload/update-payload.verb.md` by `ai-lore.py install` — the Lore file is the source; this copy is derived. Under the golden rule every write this verb makes is confirmed with the Human Lead.

> **family:** payload · **track:** full · **writes:** the Payload, within the mounted track's claim · **contracts:** golden-rule

# update-payload

Write the **Payload** — the project's actual working materials. The core floor verb
that makes the golden rule total: every write has a verb, and the Payload is the
biggest write surface there is.

## When to invoke

- Any Payload edit for which no more specific verb exists — code, prose, specs,
  assets, whatever the Payload is made of.
- NOT when a fitting project verb exists: `update-payload` is the **floor, not the
  preferred path**. A project authors its own payload verbs via
  [`add-verb`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-verb.verb.md) — "write a migration", "add an endpoint", "draft a
  chapter" — each carrying the project's own discipline. Resolution prefers them by
  design; reaching the floor repeatedly for the same kind of write is itself a
  finding: define the verb.

## What a Payload write knows

The Payload is the point; Memory exists to serve it. Before writing, the two
consultations that keep a session from writing confidently wrong:

- **The mirror** (`blueprint/mirror/`) — the project's committed description of the
  area being touched: what it is, what it owns, what a session must know before
  working it. An area with no mirror node is legitimately undescribed; an area whose
  mirror contradicts what you find is a finding
  ([`add-note`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/buffers/add-note.verb.md) it, or [`update-mirror`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/update-mirror.verb.md)
  with the Human Lead).
- **The contracts** (`blueprint/contracts/`, all levels of the resolution chain —
  they accumulate) — the rules the Payload must honor. A write that would violate one
  stops before it lands, not after.

Claim discipline is absolute: the path must be inside the mounted track's claim. In a
Publishing project, `payload/` is writable and `publish/` never is (that is the
[`publish`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/publish.verb.md) verb's alone). `out/` scratch produced while working
is owned by this verb's run — disposable, never a source of truth.

The Payload's own conventions outrank general taste: match the codebase's style, the
document set's voice, the existing structure. The verb carries discipline, not
opinions.

## The operation

1. **Confirm the verb** (golden rule): name `update-payload` (or surface the fitting
   project verb instead — the recommendation the Human Lead actually wants) and the
   target area; the Human Lead confirms. Ensure a mounted full track whose claim
   covers the target.
2. **Consult** the area's mirror node and the accumulated contracts.
3. **Write**, honoring the area's conventions.
4. **Check contracts** against the result; surface any mirror drift discovered.
5. **State what changed** — the drift lands on the track for the ack family.

## Refusals

- Trackless/light session → Payload writes are full-track only; the mount flow fires.
- Path outside the claim → refuse; extend the claim, remount, or skip.
- Target is `publish/` → refuse; that surface belongs to `publish` alone.
- A contract would be violated → stop and surface it; the Human Lead decides
  (violating consciously is their call to make, on the record).

## Related

[`add-verb`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/add-verb.verb.md) authors the specific verbs that should replace most
uses of this floor · [`update-mirror`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/blueprint/update-mirror.verb.md) keeps the description
true · [`ack`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/ack.verb.md) / [`ack-and-continue`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/acknowledgement/ack-and-continue.verb.md)
acknowledge the drift · [`publish`](../../../.ai-lore-ai-sdlc/memory/blueprint/verbs/core/outward/publish.verb.md) the one Payload-adjacent
surface this verb refuses.
