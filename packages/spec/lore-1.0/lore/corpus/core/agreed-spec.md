---
type: corpus
term: agreed spec
points_at:
  - publish/specs/index.md
  - lore/verbs/default/spec-agree.md
---

# Agreed spec

## What it means

An agreed spec is a [spec](./spec.md) that the Human Lead has declared agreed. Agreeing is an explicit act of the Human Lead, and the spec leaves the Workbench only then. When it is agreed, the spec is published to a [publish area](./publish-area.md) and linked from the [unit of work](./unit-of-work.md) it belongs to. It stops being a draft in the Workbench and becomes part of a payload, where it is kept.

An agreed spec is the reference that the work is checked against. The breakdown of its unit of work and the acceptance criteria of the pieces are drawn from it. When what is wanted changes, the document is changed and republished.

What counts as agreed is not fixed. The Lore of the Space says it.

## Where it is kept

An agreed spec is kept in a publish area. In a new Space it is one file in `publish/specs/`, and the index of that folder has one line per agreed spec. With the default Project layout, the link from the unit of work is a comment on the unit's issue.

## What acts on it

With the default set, the verb spec-agree enters Writing with the publish area as its write target, publishes the spec, removes the draft from the Workbench, links the published spec from the unit of work, and leaves Writing. The process specify runs that verb after its gate, which is the Human Lead declaring the draft agreed. In the default process work, republishing a changed spec is a gate.
