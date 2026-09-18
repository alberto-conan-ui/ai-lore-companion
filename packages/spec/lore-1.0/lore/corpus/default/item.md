---
type: corpus
term: item
points_at:
  - lore/processes/default/work.md
  - lore/verbs/default/plan-break-down.md
---

# Item

## What it means

An item is one piece of work in the default [Project](./project.md) layout. It is a sub-issue of a [focus](./focus.md). The verb plan-break-down creates it when the focus is at the Stage value Plan, with its [acceptance criteria](../core/acceptance-criteria.md) in the body of the issue. The items of a focus are the [breakdown](../core/breakdown.md) of that focus.

An item has the Status field that GitHub gives every issue on a Project. An item may have sub-issues of its own when it needs to be broken down further.

A standalone item is an issue under no focus. The Human Lead writes it, with criteria in its body if they want a report against them. It needs no spec, and the process work runs on it as on any item.

Item is not a core term. A Space that changes its Project layout can call its pieces of work something else.

## Where it is kept

An item is an issue of the Space repository, shown on the Project. The view of the items grouped by their parent focus shows the items of each focus.

## What acts on it

The verb plan-break-down creates the items of a focus, changes them, and closes the ones that the Human Lead removed from the list. The process work takes one item from its criteria to a [pull request](./pull-request.md), on an [item branch](./item-branch.md). The verb work-report writes the report as the last comment on the item's issue. The last step of the process work moves the item's Status, and an item whose criteria are all met moves to Done.
