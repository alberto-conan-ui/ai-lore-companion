---
type: verb
name: review-references
title: review-references — audit the outward links
family: outward
context: ./outward.md
track: full
home_only: true
writes:
  - none directly — repairs execute through the reference/parent verbs
contracts:
  - golden-rule
updated: 2026-07-02
---

# review-references

Audit every outward link — references *and* the parents list — against reality, and
interview the Human Lead about the dead ones. The outward grooming verb.

## When to invoke

- Periodically — the `groom` process's last step; after machines change or projects
  move on disk.

## What the review hunts

- **Dead targets** — `target_path` (or a parent's path) no longer resolves, or
  resolves to something that is no longer an AI-Lore project. Proposal: remove, or
  repair the path if the project moved.
- **Cold links** — a reference no journal entry has mentioned across many sessions;
  the purpose line reads like history. Proposal: remove (it can return when it
  earns it).
- **Miscast links** — a reference the project keeps *inheriting from* in spirit
  (copying its patterns by hand) → propose promotion to parent; a parent whose
  artifacts are never invoked → propose demotion to reference.
- **Broken contracts** — evidence a session *wrote* through a reference
  (read-only violated): surface loudly; that is a process defect to note, not just
  repair.

## The operation

1. **Confirm the verb** (golden rule); home-mounted.
2. **Walk** `references/` and the manifest's `parents:` — resolve every path, weigh
   every purpose against the journal's recent history.
3. **Interview** per finding; execute accepted outcomes through
   [`remove-reference`](./remove-reference.verb.md) /
   [`add-parent`](./add-parent.verb.md) / [`remove-parent`](./remove-parent.verb.md)
   / [`update-payload`](../payload/update-payload.verb.md)-adjacent repairs as fits.
4. **Close with the delta.**

## Refusals

- Not home / not mounted → refuse. · Bulk-remove without the interview → refuse.

## Related

[`add-reference`](./add-reference.verb.md) / [`remove-reference`](./remove-reference.verb.md)
· [`add-parent`](./add-parent.verb.md) / [`remove-parent`](./remove-parent.verb.md)
· the grooming siblings, composed by `groom`.
