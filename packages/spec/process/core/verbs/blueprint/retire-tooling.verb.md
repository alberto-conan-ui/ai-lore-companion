---
type: verb
name: retire-tooling
title: retire-tooling — remove a registry card
family: blueprint
context: ./blueprint.md
track: full
writes:
  - blueprint/tooling/<name>.tooling.md removed + index unwired
contracts:
  - golden-rule
updated: 2026-07-02
---

# retire-tooling

Remove a tooling entry whose tool is gone or superseded. Inherits
[`add-tooling`](./add-tooling.verb.md)'s encyclopedia.

## When to invoke

- The tool was deleted from the Payload, or replaced (the successor gets its own
  card; the old card goes).
- NOT to delete the tool itself — that is Payload work with its own conversation;
  the card follows the tool, never leads it.

## The operation

1. **Confirm the verb** (golden rule); mounted, claim.
2. **Check references**: processes or verbs that instruct using the tool are
   amended first.
3. **Remove** the card, unwire the index. **State it.**

## Refusals

- The tool still exists and works → why retire the card? Update it instead.
- Something still instructs its use → amend that first.

## Related

[`add-tooling`](./add-tooling.verb.md) · [`update-tooling`](./update-tooling.verb.md).
