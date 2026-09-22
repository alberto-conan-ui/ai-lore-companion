---
type: corpus
term: unit of work
points_at:
  - lore/contracts/default/spec-before-breakdown.md
  - lore/contracts/core/stage-gate.md
---

# Unit of work

## What it means

A unit of work is a piece of work on the Space's plan that can have a [spec](./spec.md), that goes through [stages](./stage.md), and that has a [breakdown](./breakdown.md) into pieces of work. When a unit of work has an agreed spec, the spec is linked from it, and its breakdown and the acceptance criteria of its pieces are drawn from that spec.

What a unit of work is called in a Space, and how it is recorded on the plan, is not fixed. The Lore of the Space says it. With the default Project layout, a unit of work is a parent issue that the layout calls a [focus](../default/focus.md).

A unit of work is optional. A session can do work that is on no issue, and an issue that is created on its own, under no unit of work, needs no spec.

## Where it is kept

A unit of work is kept on the plan, which is on GitHub: it is an issue in the Space repository, shown on the Space's GitHub Project. A draft in the Workbench belongs to a unit of work, and the journal's handovers are read per unit of work.

## What acts on it

With the default set, the process specify creates the unit of work or takes the one that the Human Lead points at, the verb spec-agree links the published spec from it, and the verb plan-break-down writes its breakdown. Two contracts concern it. The contract spec-before-breakdown, which ships as a default, says that a unit of work that is being specified has no breakdown until its spec is agreed. The contract stage-gate says that moving a unit of work from one stage to the next needs the Human Lead's explicit yes. The Human Lead closes a unit of work by reading the reports on its pieces against the agreed spec.
