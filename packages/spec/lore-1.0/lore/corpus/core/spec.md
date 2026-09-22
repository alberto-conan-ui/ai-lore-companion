---
type: corpus
term: spec
points_at:
  - lore/processes/default/specify.md
  - publish/specs/index.md
---

# Spec

## What it means

A spec is a written document that says what is wanted, agreed by the Human Lead before the work it describes is built. It is written by the Human Lead and a session together, in the Workbench, over as many sessions as it takes. Agreeing it is an explicit act of the Human Lead.

From the moment it is agreed, the spec is the reference for the work: the plan is derived from it, each piece of work has [acceptance criteria](./acceptance-criteria.md) drawn from it, and finished work is checked against it. A change to what is wanted is a change to the document, which is then republished.

A spec is optional. The Human Lead can ask a session for a piece of work that has no spec, and the session does it under the same contracts and the same rules for payloads as any other work. The Human Lead decides which work is large enough for a spec.

The reason to write a spec is that a session that works from a conversation reconstructs what is wanted each time, and can reconstruct it differently. A session that works from an agreed document reads the same statement every time, and so does the next session. An unattended session checks its work against the same document.

## Where it is kept

Before it is agreed, a spec is a [draft](./draft.md) in `workbench/drafts/`. Once it is agreed, it is an [agreed spec](./agreed-spec.md) in a [publish area](./publish-area.md). In a new Space that is the folder `publish/specs/`, with one file per agreed spec. What a spec must contain and how it is written is said in the Lore. With the default set it is said in the mirror of the default publish area.

## What acts on it

With the default set, the process specify takes an idea to an agreed spec, with the verb spec-draft for the draft and the verb spec-agree for publishing it. The verb plan-break-down draws the breakdown and the criteria from the agreed spec, and the verb work-report reports a changed criterion on the spec's unit of work. The contract spec-before-breakdown, which ships as a default, applies to a unit of work that is being specified.
