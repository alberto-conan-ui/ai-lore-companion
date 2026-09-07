---
type: verb
name: retire-contract
title: retire-contract — release an inviolable rule
family: blueprint
context: ./blueprint.md
track: full
invoker: human-lead
writes:
  - blueprint/contracts/<name>.contract.md removed + citations unwired + hook removed
contracts:
  - golden-rule
updated: 2026-07-02
---

# retire-contract

Remove a project-local or shadow contract — the project consciously stops binding
itself. **Human-Lead-invoked**, and the heaviest retire: releasing a rule changes
what every future write may do. Inherits
[`add-contract`](./add-contract.verb.md)'s encyclopedia.

## When to invoke

- The invariant genuinely no longer applies (the platform changed, the obligation
  ended), or a shadow's conflict with an inherited contract dissolved (retiring the
  shadow restores the inherited rule).
- NOT because the rule is inconvenient this week — that conversation is a conscious
  override at [`save-point`](../acknowledgement/save-point.verb.md), on the record, rule intact.

## What retiring means

Read the citation map first — every citing verb/process gets its `contracts:` line
unwired in the same motion; the hook, if any, removed. The retirement's *why* goes
in the landing commit and, when the rule shaped history, a line in the journal —
future sessions reading old save-points will meet the rule's ghost.

## The operation

1. **Verify the invoker**; **confirm the verb** (and read the rule back — the
   Human Lead should hear what is being released); mounted, claim.
2. **Unwire**: citations, hook, index; remove the file.
3. **State what is now permitted** that wasn't — plainly.

## Refusals

- Not the Human Lead → refuse. · Core → refuse ([`upgrade`](../lifecycle/upgrade.verb.md)
  owns core's lifecycle). · "Just skip it this once" → that is a save-point
  override, not a retirement.

## Related

[`add-contract`](./add-contract.verb.md) · [`update-contract`](./update-contract.verb.md)
· [`save-point`](../acknowledgement/save-point.verb.md) for conscious one-time overrides.
