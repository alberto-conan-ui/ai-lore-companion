# Verbs — the map of operations

A **verb** is a named operation — the unit of *what to do*, chosen per write under
the golden rule (every write is confirmed to a verb; nothing writes unchosen). A
**bookend** runs intrinsically at session open and close. A **process** orchestrates
verbs, Human-Lead-started. This is the map; each verb is its own encyclopedia,
loaded when invoked, self-contained.

Verbs live in the resolution chain — core (this set) < parents < project-local,
by-name lowest-wins; contracts accumulate. Core is never edited in place; disagree
by shadowing ([`add-verb`](./blueprint/add-verb.verb.md)). The un-overridable floor: the
bootstrap + `add-verb` / `add-process` / `add-contract` / `run-process`.

## Status tree

| Verb | One line |
|---|---|
| [`add-new-focus`](./status-tree/add-new-focus.verb.md) | open a unit of intent (the focus encyclopedia) |
| [`update-focus`](./status-tree/update-focus.verb.md) | amend bodies in a focus's subtree; discard guard |
| [`add-stage`](./status-tree/add-stage.verb.md) / [`add-phase`](./status-tree/add-phase.verb.md) | decompose: batch under focus / step under stage |
| [`complete-stage`](./status-tree/complete-stage.verb.md) / [`complete-phase`](./status-tree/complete-phase.verb.md) | close a batch / a step, evidence-gated |
| [`pause-focus`](./status-tree/pause-focus.verb.md) / [`resume-focus`](./status-tree/resume-focus.verb.md) | the side-state, out and back (staleness-checked) |
| [`complete-focus`](./status-tree/complete-focus.verb.md) | the Done call — **Human-Lead-only** |
| [`archive-focus`](./status-tree/archive-focus.verb.md) | relocate the finished subtree (HL) |
| [`review-focus-tree`](./status-tree/review-focus-tree.verb.md) | grooming: challenge what lingers |

## Buffers

| Verb | One line |
|---|---|
| [`add-note`](./buffers/add-note.verb.md) | capture to the notepad — cheapest write (light-writable) |
| [`add-backlog-item`](./buffers/add-backlog-item.verb.md) | capture pre-focus work (light-writable) |
| [`integrate-notepad`](./buffers/integrate-notepad.verb.md) | grooming: drain the knowledge inbox (home) |
| [`review-backlog`](./buffers/review-backlog.verb.md) | grooming: polish the work inbox (home) |

## Blueprint (authoring)

| Verb | One line |
|---|---|
| [`add-verb`](./blueprint/add-verb.verb.md) | author a verb / a shadow — **floor**; the shadowing encyclopedia |
| [`update-verb`](./blueprint/update-verb.verb.md) / [`retire-verb`](./blueprint/retire-verb.verb.md) | amend / remove an authored verb |
| [`add-process`](./blueprint/add-process.verb.md) | author an orchestration — **floor**; steps are verb references only |
| [`run-process`](./blueprint/run-process.verb.md) | drive an orchestration step-by-verb — **floor** (HL) |
| [`update-process`](./blueprint/update-process.verb.md) / [`retire-process`](./blueprint/retire-process.verb.md) | amend / remove |
| [`add-contract`](./blueprint/add-contract.verb.md) | author an inviolable rule — **floor**; the citation model |
| [`update-contract`](./blueprint/update-contract.verb.md) / [`retire-contract`](./blueprint/retire-contract.verb.md) | sharpen / release a rule (HL) |
| [`add-tooling`](./blueprint/add-tooling.verb.md) / [`update-tooling`](./blueprint/update-tooling.verb.md) / [`retire-tooling`](./blueprint/retire-tooling.verb.md) | the registry cards |
| [`update-mirror`](./blueprint/update-mirror.verb.md) | keep the Payload's description true (all three motions) |
| [`review-mirror`](./blueprint/review-mirror.verb.md) | grooming: diff description against reality (home) |

## Payload

| Verb | One line |
|---|---|
| [`update-payload`](./payload/update-payload.verb.md) | the floor for Payload writes — project verbs (via `add-verb`) are the preferred path |

## Tracks

| Verb | One line |
|---|---|
| [`spawn-track`](./tracks/spawn-track.verb.md) | create a child workspace from home (HL) |
| [`mount-track`](./tracks/mount-track.verb.md) | attach a session; auto-mount-home fast path |
| [`update-track`](./tracks/update-track.verb.md) | reshape a claim / repoint a focus |
| [`merge-track`](./tracks/merge-track.verb.md) / [`abandon-track`](./tracks/abandon-track.verb.md) | the exits: land / discard (HL) |
| [`release-track`](./tracks/release-track.verb.md) | clear a dead session's stale mount (HL) |

## Acknowledgement

| Verb | One line |
|---|---|
| [`ack`](./acknowledgement/ack.verb.md) | deliberate pause-point commit — the pairing encyclopedia (HL) |
| [`ack-and-continue`](./acknowledgement/ack-and-continue.verb.md) | light mid-execution commit (HL) |
| [`save-point`](./acknowledgement/save-point.verb.md) | seal the accumulator into a milestone (HL, home-only, children closed) |

Every ack-family commit is paired (payload-first) and appends its annotated row to
the open `next.save-point.md` accumulator — cross-repo correlation by data, not
heuristics.

## Outward

| Verb | One line |
|---|---|
| [`add-reference`](./outward/add-reference.verb.md) / [`remove-reference`](./outward/remove-reference.verb.md) | consult-only links, in and out |
| [`review-references`](./outward/review-references.verb.md) | grooming: audit the outward links (home) |
| [`add-parent`](./outward/add-parent.verb.md) / [`remove-parent`](./outward/remove-parent.verb.md) | inherit / stop inheriting from an upstream (HL) |
| [`publish`](./outward/publish.verb.md) | sync the curated deliverable (HL; Publishing projects) |

## Lifecycle + journal

| Verb | One line |
|---|---|
| [`init`](./lifecycle/init.verb.md) | bootstrap a folder into a project (HL) |
| [`install`](./lifecycle/install.verb.md) | project the resolved set into an engine (HL) |
| [`upgrade`](./lifecycle/upgrade.verb.md) | replace core wholesale; re-validate shadows (HL) |
| [`archive-journal`](./lifecycle/archive-journal.verb.md) | roll the live journal (HL) |

## Bookends

| Bookend | One line |
|---|---|
| [`orient`](./bookends/orient.verb.md) | session open: floor + thin core, registry, chain, drift |
| [`close-session`](./bookends/close-session.verb.md) | session close: journal, handover, closing paired commit, unmount |

## Core processes

| Process | Composes |
|---|---|
| [`groom`](../processes/groom.process.md) | the five grooming verbs — the tidy-the-project sweep |
| [`close-out`](../processes/close-out.process.md) | complete-focus → archive-focus → save-point |
| [`start-work`](../processes/start-work.process.md) | intention → focus → decomposition → mounted first step |
| [`parallel-work`](../processes/parallel-work.process.md) | the child-track journey: spawn → mount → land/discard |
| [`recover-session`](../processes/recover-session.process.md) | after a dead session: release → remount → keep/discard drift |

## The pillars

Six reference pillars sit beside the families — `project-structure.md` (the
vocabulary; the thin core), `status.md` (the tree and registry; the thin core),
`memory.md` (components and the file schema), `tracks.md`, `git.md`, `bindings.md`.
They carry vocabulary and background; the verb cards are authoritative on
operation. Two of them load at orient; the rest load when a card or a question
needs them.

## The tool

`blueprint/tooling/core/ai-lore.py` is the mechanical half of `init` / `install` /
`upgrade` (and the `check` behind `core-containment`, `ack-pairing`'s ledger
presence, and dead-link hygiene). See its card, `ai-lore.tooling.md`.
