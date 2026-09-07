---
type: contract
name: golden-rule
title: golden-rule — every write is confirmed to a verb
updated: 2026-09-07
checkable: judgement
cited_by:
  - every core verb and process (the `contracts:` line of each card)
---

# golden-rule

**Every write is confirmed to a verb; nothing writes unchosen.** Reads and
conversation are free. At every write touch the session names the governing verb
and the Human Lead confirms — usually the verb already in flight, at the cost of
one breath. The session never auto-routes intent to a verb: it surfaces the fitting
verb(s) with a recommendation and the Human Lead chooses.

## What honoring it looks like

- **No exempt surface.** Scratch (`out/`), journal, registry, accumulator, engine
  projections — every one is written by the step-list of a verb that owns it. A
  write with no owning verb is a gap that routes through the authoring floor
  ([`add-verb`](../verbs/blueprint/add-verb.verb.md)), never a silent exception.
- **Confirmation is per write, cheap by design.** A standing instruction ("ack-and-
  continue after each phase, go") *is* the confirmation for the writes it names;
  ceremony compresses, the choice never does. Mount-track's auto-mount fast path
  is the one sanctioned elision — the write that triggered it carries the choice.
- **Primitives are total.** Because every entity names its lifecycle verbs and the
  Payload has its floor verb, the rule can only ever channel a write, never block
  one. A legitimate write that finds no verb is a defect in the verb set, filed
  through the authoring floor, not a reason to write unchosen.
- **Processes never grant exemptions.** A run pauses at every write of every step-
  verb; a declared process makes confirmations predictable, not skippable.

## What checks it

- **Stated** here and in the floor (`ai_readme.md`) — the AI-agnostic baseline.
- **Cited** by every verb: step 1 of every operation is the confirmation.
- **Reinforced** by engine hooks where the binding can: the Claude binding fires a
  post-write reminder naming the rule on every `Write`/`Edit` (see
  [`bindings.md`](../verbs/bindings.md)). The hook cannot judge whether a
  verb was confirmed — that is the Human Lead's eye at review, and the reviewer's at
  [`save-point`](../verbs/acknowledgement/save-point.verb.md).
