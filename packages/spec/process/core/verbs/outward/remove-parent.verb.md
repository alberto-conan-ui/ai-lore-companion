---
type: verb
name: remove-parent
title: remove-parent — stop inheriting from an upstream
family: outward
context: ./outward.md
track: full
invoker: human-lead
writes:
  - memory/workspace.yaml (parents: list)
  - engine re-projection of the resolved artifact set
contracts:
  - golden-rule
updated: 2026-07-02
---

# remove-parent

Drop a parent from the manifest — its artifacts leave the resolved set, its
contracts stop binding. **Human-Lead-invoked.** Inherits
[`add-parent`](./add-parent.verb.md)'s encyclopedia.

## When to invoke

- The upstream is dead, diverged, or the relationship ended.
- NOT to dodge one inherited artifact — shadow that one name instead
  ([`add-verb`](../blueprint/add-verb.verb.md) / [`add-contract`](../blueprint/add-contract.verb.md));
  removal is the whole relationship.

## What removal means

The delta runs in reverse and is walked with the Human Lead **before** landing:
verbs that disappear (and any local process step that references them by name — 
those processes are amended first or the removal refuses), shadows that stop
shadowing (the local artifact stays, now standing alone), contracts that stop
binding (said plainly — this is `retire-contract`-grade in effect, at wholesale).

## The operation

1. **Verify the invoker**; **confirm the verb** (golden rule); mounted.
2. **Compute and present the reverse delta**; amend dependent processes first.
3. **Remove the manifest line**; **re-project** the resolved set.
4. **State what changed** — gone, unshadowed, unbound.

## Refusals

- Not the Human Lead → refuse.
- A local process still references an inherited verb by name → amend first.
- The problem is one artifact → shadow it instead.

## Related

[`add-parent`](./add-parent.verb.md) the encyclopedia ·
[`review-references`](./review-references.verb.md) proposes removals ·
[`install`](../lifecycle/install.verb.md) re-projects.
