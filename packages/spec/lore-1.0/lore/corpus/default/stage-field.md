---
type: corpus
term: Stage field
points_at:
  - lore/contracts/core/stage-gate.md
---

# Stage field

## What it means

The Stage field is a single-select field on every **root** of the plan — an issue with no parent on the Project — in the default [Project](./project.md) layout. It records the [stage](../core/stage.md) of that unit of work. A [focus](./focus.md) carries one, and so does a standalone [item](./item.md) that stands under no focus. It has five values, in this order: Backlog, Spec and Planning, Build, Review and Done.

`Backlog` is work that is recorded and not yet on the plan. The default plan view filters it out by name, so the value has to exist for that view to select anything.

`Spec and Planning` is one value and not two. A unit of work is broken down while its spec is still being written — the pieces are posted as they are thought of — so a Space that kept them apart had to either hold planning off the plan until a spec was agreed, or move a unit of work to a stage that said its spec was finished when it was not.

The processes specify and plan both run at `Spec and Planning`, and work covers Build. No process covers Review. At Review, the Human Lead reads the reports on the items of the unit of work against the agreed spec.

The moves are made in this way:

- From Backlog to Spec and Planning: the Human Lead makes the move when the work is taken onto the plan.
- From Spec and Planning to Build: the Human Lead makes the move. It is the moment a provisional breakdown stops being provisional, so a piece of work that no longer matches the agreed spec is corrected, closed or rewritten before the move.
- From Build to Review, and from Review to Done: the Human Lead makes the move in GitHub.

No move happens without the Human Lead's yes, which is the rule of the core contract stage-gate.

## Where it is kept

The field is on the Project, on GitHub. The view of the focuses grouped by Stage has one group per value, and the companion's Dashboard has one column per value.

## What acts on it

The processes specify and plan set the field, each after the Human Lead has answered its gate with yes. The Human Lead sets it in GitHub for the other two moves. The core contract stage-gate has the Stage field of a focus as its target in the default layout. In the first build that contract has only a rule.

## Choices recorded here

- The product document of AI-Lore 1.0 lists "the five Stage values" as the term. The session that wrote this entry on 2026-09-18 wrote one entry, named after the field, which gives the five values.
- The product document proposes a field for the stage, and not one sub-issue per stage, and leaves the point open. The focus of the first build says that the Dashboard shows the focuses by stage. This entry describes the field.
