---
type: verb
name: remove-reference
title: remove-reference — drop a consult-only link
family: outward
context: ./outward.md
track: full
writes:
  - references/<name>.md removed + index unwired
contracts:
  - golden-rule
updated: 2026-07-02
---

# remove-reference

Drop a reference the project no longer consults. A pointer is deleted, not retired —
hence `remove-`, the pointer grammar. Inherits
[`add-reference`](./add-reference.verb.md)'s encyclopedia.

## When to invoke

- The target moved away, died, or simply stopped mattering;
  [`review-references`](./review-references.verb.md) proposes these.

## The operation

1. **Confirm the verb** (golden rule); mounted.
2. **Check** nothing in Memory instructs consulting it by name; fix what does
   (insights sourced from it keep their `source` line — history is history).
3. **Remove** file + index line. **State it.**

## Refusals

- The project still consults it → why remove? Update the file instead.

## Related

[`add-reference`](./add-reference.verb.md) ·
[`review-references`](./review-references.verb.md).
