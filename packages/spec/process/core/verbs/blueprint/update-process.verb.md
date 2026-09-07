---
type: verb
name: update-process
title: update-process — amend an orchestration
family: blueprint
context: ./blueprint.md
track: full
writes:
  - blueprint/processes/<name>.process.md (outside core/)
  - engine re-projection
contracts:
  - golden-rule
updated: 2026-07-02
---

# update-process

Amend a project-local or shadow process. Inherits
[`add-process`](./add-process.verb.md)'s encyclopedia — the verb-reference-only
rule, the authority order, the resolution chain.

## When to invoke

- The sequence learned something: a step added or reordered, parameterization
  sharpened, a "done" clarified.
- A step's verb was retired or renamed — the reference must move
  ([`retire-verb`](./retire-verb.verb.md) sends its dependents here).
- NOT for core processes — shadow via `add-process` instead.

## What holds

Every amended step still names a resolving verb — the rule is re-checked across the
whole file, not just the touched step. Name never changes (retire + add). Discard
guard on removed steps or dropped judgement points. Re-project in the same motion.

## The operation

1. **Confirm the verb** (golden rule); mounted, claim.
2. **Amend**; re-check every step resolves; discard guard.
3. **Re-project**; **state the change.**

## Refusals

- Core → shadow instead. · A step goes inline → refuse. · Rename → retire + add.

## Related

[`add-process`](./add-process.verb.md) the encyclopedia ·
[`retire-process`](./retire-process.verb.md) the exit.
