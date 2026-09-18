---
type: corpus
term: Stage field
points_at:
  - lore/contracts/core/stage-gate.md
---

# Stage field

## What it means

The Stage field is a single-select field on a [focus](./focus.md), in the default [Project](./project.md) layout. It records the [stage](../core/stage.md) of the focus. It has five values, in this order: Spec, Plan, Build, Review and Done.

Each of the three default processes covers one value: specify covers Spec, plan covers Plan, and work covers Build. No process covers Review. At Review, the Human Lead reads the reports on the items of the focus against the agreed spec.

The moves are made in this way:

- From Spec to Plan: the process specify makes the move, after its gate.
- From Plan to Build: the process plan makes the move, after its gate.
- From Build to Review, and from Review to Done: the Human Lead makes the move in GitHub.

No move happens without the Human Lead's yes, which is the rule of the core contract stage-gate.

## Where it is kept

The field is on the Project, on GitHub. The view of the focuses grouped by Stage has one group per value, and the companion's Dashboard has one column per value.

## What acts on it

The processes specify and plan set the field, each after the Human Lead has answered its gate with yes. The Human Lead sets it in GitHub for the other two moves. The core contract stage-gate has the Stage field of a focus as its target in the default layout. In the first build that contract has only a rule.

## Choices recorded here

- The product document of AI-Lore 1.0 lists "the five Stage values" as the term. The session that wrote this entry on 2026-09-18 wrote one entry, named after the field, which gives the five values.
- The product document proposes a field for the stage, and not one sub-issue per stage, and leaves the point open. The focus of the first build says that the Dashboard shows the focuses by stage. This entry describes the field.
