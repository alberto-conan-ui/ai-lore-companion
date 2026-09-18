---
type: corpus
term: breakdown
points_at:
  - lore/verbs/default/plan-break-down.md
  - lore/contracts/core/spec-before-breakdown.md
---

# Breakdown

## What it means

The breakdown of a [unit of work](./unit-of-work.md) is its pieces of work and the dependencies between them. When the unit has an agreed spec, each piece has [acceptance criteria](./acceptance-criteria.md) drawn from that spec.

One thing about a breakdown is fixed: a unit of work that is being specified has no breakdown until its spec is agreed, and its breakdown and the criteria of its pieces are drawn from that spec. An issue that is created on its own, under no unit of work, is not a breakdown and needs no spec.

How the breakdown is done is not fixed. The Lore of the Space says it.

## Where it is kept

A breakdown is kept on the plan, on GitHub. With the default Project layout, the pieces of work are sub-issues of the unit's issue, which the layout calls [items](../default/item.md), and the criteria of a piece are in the body of its sub-issue.

## What acts on it

With the default set, the verb plan-break-down proposes the pieces of work, each with its criteria, and states any part of the spec that no piece covers. The Human Lead edits the list and confirms it, and the verb then writes the breakdown to the plan. The process plan runs that verb, and the Human Lead's confirmation of the breakdown is the gate of that process. The core contract spec-before-breakdown guards the breakdown. In the first build it has only a rule.
