---
type: verb
name: retire-process
title: retire-process — remove an orchestration
family: blueprint
context: ./blueprint.md
track: full
invoker: human-lead
writes:
  - blueprint/processes/<name>.process.md removed + index unwired
  - engine projection removed
contracts:
  - golden-rule
updated: 2026-07-02
---

# retire-process

Remove a project-local or shadow process from the resolved set. **Human-Lead-
invoked.** Inherits [`add-process`](./add-process.verb.md)'s encyclopedia.

## When to invoke

- The ritual is no longer performed, or a shadow's reason dissolved (retiring it
  restores the inherited process).
- NOT for core (that is [`upgrade`](../lifecycle/upgrade.verb.md)'s replacement) and never for
  a floor artifact.

## What retiring means

Processes have no dependents in the way verbs do (nothing references a process by
name except habit and documentation), so the check is lighter: confirm nothing in
the project's own docs instructs running it, then file out, index unwired,
projection removed. Reason in the landing commit.

## The operation

1. **Verify the invoker**; **confirm the verb**; mounted, claim.
2. **Sweep for references** in project docs; fix or note them.
3. **Remove**: file, index line, projection. **State the resolved set's new shape.**

## Refusals

- Not the Human Lead → refuse. · Core → refuse.

## Related

[`add-process`](./add-process.verb.md) · [`update-process`](./update-process.verb.md).
