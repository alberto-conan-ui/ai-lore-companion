---
type: verb
name: plan-break-down
pillar: planning
mode: read-only
invoked_by:
  - plan
  - human-lead
---

# plan-break-down

This verb proposes the breakdown of a unit of work and, after the Human Lead has confirmed it, writes it to the plan. The breakdown is the list of the pieces of work. Each piece has acceptance criteria drawn from the unit's agreed spec, and the pieces can depend on each other. The plan is on the Space's GitHub Project and not in files.

The verb reads the Lore for how the plan is laid out in this Space, and it does not assume the default layout. With the default layout, the unit of work is a focus, the pieces are its sub-issues, which are called items, and the criteria are in the body of each sub-issue.

## When it is invoked

The process plan runs it in its step break-down. The Human Lead also invokes it on a unit of work whose breakdown needs changing.

## What it reads

- The Lore, for how the plan is laid out: what the units of work are, how they are broken down, and where acceptance criteria are kept. With the default set, the entries in `lore/corpus/default/` describe the layout.
- The unit of work on GitHub, read with `gh`: its text, the link to its agreed spec, and its existing breakdown.
- The agreed spec, in its publish area.
- The mirrors of the payloads that the pieces will write to, when the pieces cannot be told apart without them.

## What it writes and the mode it needs

It writes only to the plan on GitHub, with `gh`: it creates the pieces of work, writes their criteria, sets the dependencies between them, and closes the pieces that the Human Lead removed. A session in Read only may update the GitHub Project, so the verb runs in Read only. It does not ask for Writing.

It writes nothing before the Human Lead has confirmed the list.

## Steps

1. Read in the Lore how the plan is laid out.
2. Read the unit of work and its existing breakdown. If the unit of work has a spec that is not agreed and published, refuse: the rule of the contract spec-before-breakdown is that such a unit has no breakdown yet. If the unit of work has no spec at all, that contract does not cover it. Tell the Human Lead that there is no spec, and propose the pieces from the text of the unit of work and from what the Human Lead says.
3. Read the agreed spec.
4. Propose the pieces of work. For each piece, give its acceptance criteria: the statements of the spec that the piece satisfies and, for each, how it will be checked. A criterion is checked by a test to write, by a command that must pass, by a visible result that the Human Lead confirms, or by the Human Lead reading the result. Give the dependencies between the pieces. State every part of the spec that no piece covers.
5. The Human Lead edits the list. Change the proposal as they say, and show the list again, until they say that it is right.
6. Get the confirmation. When the process plan runs this verb, the confirmation is the gate of that process: the process asks it through the companion, and this verb writes only after the answer yes. When the Human Lead invoked the verb directly, the confirmation is their yes in the conversation.
7. Say which edits will be made to the plan, and make them with `gh`, as the layout says. With the default layout: create one sub-issue of the focus for each new piece, with its criteria in the body; change the sub-issues whose piece changed; set the dependencies between the sub-issues; and close the sub-issues that the Human Lead removed from the list. Every issue is created in the Space repository.
8. If GitHub cannot be reached, nothing is written and nothing queues the edits. Say so to the Human Lead and keep the confirmed list in the conversation or in `workbench/scratch/`.
9. Tell the Human Lead what is now on the plan, with the address of each piece.

This verb does not move the unit of work to its next stage. The process plan makes that move after this verb has ended.

## Contracts

- spec-before-breakdown, `lore/contracts/core/spec-before-breakdown.md`. Its rule is that a unit of work that has a spec has no breakdown until the spec is agreed, and that the criteria of every piece are drawn from the spec. This contract has only a rule, so no script refuses the write. The session checks the rule itself in step 2.
- stage-gate, `lore/contracts/core/stage-gate.md`. Its rule is that moving a unit of work from one stage to the next is the Human Lead's explicit yes. This verb moves no stage.

## What it refuses

- Breaking down a unit of work whose spec is a draft, or is agreed and not yet published and linked.
- Writing to the plan before the Human Lead has confirmed the list.
- Criteria that are not drawn from the spec, for a unit of work that has one.
- Leaving out of its proposal a part of the spec that no piece covers.
- Moving the unit of work to its next stage.
- Any write to the Lore or to a payload.

## Choices recorded here

The session that wrote this card on 2026-09-18 made the following choices. Each is open to the Human Lead's review.

- The product document describes this verb for a unit of work that has an agreed spec. The Human Lead decided on 2026-09-18 that a spec is optional and that spec-before-breakdown governs only units of work that are specified. What step 2 does for a unit of work with no spec follows from that decision.
- The focus of the first build says that a plan update that cannot reach GitHub fails, that the session says so, and that there is no queue. Step 8 follows that. Keeping the confirmed list in `workbench/scratch/` is this card's.
- The focus of the first build ships spec-before-breakdown with a rule and no check script. The product document describes a check. This card follows the focus.
