---
type: corpus
term: acceptance criteria
points_at:
  - lore/verbs/default/work-report.md
  - lore/verbs/default/plan-break-down.md
---

# Acceptance criteria

## What it means

The acceptance criteria of a piece of work are the statements that the finished work is reported against. When the piece belongs to a [unit of work](./unit-of-work.md) that has an agreed spec, its criteria are drawn from that spec.

A piece of work that has criteria is closed by a report against them. For each criterion the report says one of three things: met, with the [evidence](./evidence.md) that proves it; not met; or changed, with a reason. A criterion that is not met keeps the piece of work open. On a piece of work that has a spec, a changed criterion means that the spec is republished.

Criteria are optional. A piece of work with no criteria gets a report of what was done. How criteria are written is not fixed, and the Lore of the Space says where they are kept.

## Where it is kept

Acceptance criteria are kept on the plan, on GitHub. With the default Project layout they are in the body of the issue of the piece of work.

## What acts on it

With the default set, the verb plan-break-down writes the criteria of each piece when it writes the [breakdown](./breakdown.md), and the verb work-report takes the criteria of a piece of work one by one and writes the report. In the default process work, republishing a spec because a criterion changed is a [gate](./gate.md).
