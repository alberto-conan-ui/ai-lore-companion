---
type: verb
name: retire-verb
title: retire-verb — remove an authored verb
family: blueprint
context: ./blueprint.md
track: full
invoker: human-lead
writes:
  - blueprint/verbs/<name>.verb.md removed + index unwired
  - engine projection removed
contracts:
  - golden-rule
updated: 2026-07-02
---

# retire-verb

Remove a project-local or shadow verb from the resolved set. **Human-Lead-invoked**
— retiring capability is a project decision. Inherits
[`add-verb`](./add-verb.verb.md)'s encyclopedia.

## When to invoke

- The verb's kind of write no longer happens, or a shadow's disagreement with core
  dissolved (retiring a shadow **restores the inherited verb** — often the point,
  especially at upgrade time when the new core absorbed the shadow's fix).
- NOT for core artifacts (core retires only via [`upgrade`](../lifecycle/upgrade.verb.md)
  replacing it) and never for the floor.

## What retiring means

Check the dependents first: any **process step referencing the verb by name** breaks
on retirement — the resolved set must still satisfy every process, or the process is
amended first ([`update-process`](./update-process.verb.md)). Then: file removed,
index unwired, engine projection removed. History survives in git; the retirement
reason goes in the commit that lands it.

## The operation

1. **Verify the invoker**; **confirm the verb** (golden rule); mounted, claim.
2. **Dependency check** across the resolved processes; amend or refuse.
3. **Remove**: file, index line, projection.
4. **State** what the resolved set now looks like for that name (inherited verb
   restored, or nothing).

## Refusals

- Not the Human Lead → refuse. · Core / the floor → refuse. · A process still
  references it → amend the process first or refuse.

## Related

[`add-verb`](./add-verb.verb.md) · [`update-verb`](./update-verb.verb.md) ·
[`upgrade`](../lifecycle/upgrade.verb.md) the core-side lifecycle.
