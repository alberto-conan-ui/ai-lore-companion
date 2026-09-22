---
type: corpus
term: focus
points_at:
  - lore/processes/default/specify.md
  - lore/processes/default/plan.md
---

# Focus

## What it means

A focus is what the default [Project](./project.md) layout calls a [unit of work](../core/unit-of-work.md). It is a parent issue on the Project. It is the unit of work that can have a spec, and the issue of a session that works on it names it. Its kind, for example a feature, a document or an investigation, is a label.

A focus has a [Stage field](./stage-field.md), which says how far the focus has got. Its breakdown is its [items](./item.md), which are its sub-issues. GitHub allows up to a hundred sub-issues per parent issue. There is no other level between a focus and its items.

The Human Lead closes a focus. When every item of the focus is Done, the Human Lead moves the focus to Review, reads the reports on its items against the agreed spec, and moves the focus to Done.

Focus is not a core term. A Space that changes its Project layout can call its unit of work something else.

## Where it is kept

A focus is an issue of the Space repository, shown on the Project. The view of the focuses grouped by Stage shows every focus.

## What acts on it

The process specify creates the focus at the Stage value Spec, or takes the focus that the Human Lead points at. The verb spec-agree links the published spec from the focus in a comment on its issue. The verb plan-break-down creates the items of the focus. The verb work-report writes a comment on the focus when a criterion of one of its items has changed. The contract spec-before-breakdown, which ships as a default, applies to a focus that is being specified, and the core contract stage-gate applies to its Stage field.
