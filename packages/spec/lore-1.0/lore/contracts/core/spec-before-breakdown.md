---
type: contract
name: spec-before-breakdown
pillar: specifying
target: plan
check: null
when: null
---

# spec-before-breakdown

This contract guards the pillar Specifying. Its target is the plan, which is the Space's plan on GitHub. This contract has only a rule. It has no check script, so nothing refuses a write that breaks it. A session treats it as advice that it can be asked to justify, and not as something that is enforced.

## The rule

A unit of work that has a spec has no breakdown until the spec is agreed, and the acceptance criteria of every piece of the breakdown are drawn from the agreed spec.

A spec is agreed when the Human Lead has declared it agreed and it is published in a publish area, and the unit of work links the published file.

## What the rule covers

- The rule covers a unit of work that is being specified: one that has a draft or a spec. With the default layout of the plan, a unit of work is a focus, and breaking it down means creating sub-issues under the focus.
- A spec is optional. A unit of work that has no spec at all is not covered, and a session may break it down from the text of the unit of work and from what the Human Lead says.
- An issue that is created on its own, under no focus, is not a breakdown and needs no spec.

## What a session does

Before a session writes a breakdown for a unit of work, it reads the unit of work and looks for the link to the published, agreed spec. When the unit of work has a draft or a spec that is not yet agreed and published, the session writes no breakdown and says so to the Human Lead. When the session writes the criteria of a piece of work, it takes them from the agreed spec.

## Why it has no check

The product document of AI-Lore 1.0 describes a check for this contract: before a sub-issue is created under a focus, a script confirms that the focus links a published, agreed spec, and the script reads the Lore for how the plan is laid out. The first build of AI-Lore 1.0 does not include that script, by the Human Lead's decision on the scope of the first build. Until the script exists, `check` and `when` are `null`, and the rule is kept by the session and by the verbs and processes that name this contract.

## Why it is core

A breakdown that is not made from the agreed spec can differ from what the Human Lead agreed, and the work is then checked against criteria that the spec does not contain. The spec is written to prevent that.

## Choices recorded here

The product document fixes the rule, what it covers and the check that it describes. The session that wrote this card on 2026-09-18 made one choice, which is open to the Human Lead's review.

- The sentence that says when a spec is agreed puts together what the product document says in several places: the Human Lead declares the draft agreed, the agreed spec is published to a publish area, and the unit of work links it.
