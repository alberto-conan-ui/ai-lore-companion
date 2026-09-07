---
type: verb
name: add-contract
title: add-contract — author an inviolable rule
family: blueprint
context: ./blueprint.md
track: full
floor: un-overridable
writes:
  - blueprint/contracts/ (new *.contract.md outside core/) + branch index
  - engine reinforcement (contract → hook, where checkable)
contracts:
  - golden-rule
updated: 2026-07-02
---

# add-contract

Author a **contract** — an inviolable, always-on rule. Part of the un-overridable
floor.

## When to invoke

- A rule emerges that must *never* be skipped: a quality bar, an integration
  obligation, an invariant across releases.
- A note routed by [`integrate-notepad`](../buffers/integrate-notepad.verb.md) turns out to
  be a rule.
- NOT for operations (verbs) or sequences (processes) — a contract states what must
  hold, never how to act.

## What a contract is

Defined by **inviolability, not hook-ability.** Enforcement is layered, weakest
floor first: **stated** in the methodology text (works on any AI, the agnostic
baseline) → **cited** by every verb and process it governs (the rule surfaces at the
point of action — this is why verb frontmatter carries `contracts:`) → **reinforced**
by an engine hook where mechanically checkable (the bookend-reinforcement pattern;
optional, never load-bearing). `contracts/` legitimately holds both checkable rules
(*commits carry no AI attribution*) and judgement rules (*never break compat without
a playbook*) — the second kind is no less a contract for being uncheckable by
machine.

**Accumulation, not replacement.** Contracts stack across the resolution chain —
every ancestor's contracts bind, core's included; a same-named local contract
resolves lowest-wins only on *direct conflict*, it does not silence the rest. A
project escapes an inherited contract by consciously shadowing that name — visible,
auditable, on the record.

The shape, `<name>.contract.md`: frontmatter (`type: contract`, `name`, `title`,
`updated`, `checkable: yes|judgement`, `cited_by` — the verbs/processes that carry
it); body — the rule in one evaluable sentence, then what honoring it looks like,
then what checks it (a hook, a walk at [`save-point`](../acknowledgement/save-point.verb.md), a
reviewer's eye).

**Citations are half the artifact.** A contract nothing cites fires only at
save-point's walk; wire the `contracts:` line of every governed verb/process in the
same motion ([`update-verb`](./update-verb.verb.md) / `update-process`), and the
hook where checkable.

## The operation

1. **Confirm the verb** (golden rule); mounted, claim covering
   `blueprint/contracts/`.
2. **Settle the rule**: one evaluable sentence; checkable or judgement; who cites
   it; conflict-check against the accumulated set (a contradiction with an
   inherited contract is a shadow decision, said aloud).
3. **Author**; **wire the citations** into the governed artifacts; hook where
   checkable.
4. **Branch index; state the addition** and its citation map.

## Refusals

- It says *how* rather than *what must hold* → verb or process.
- Target is `core/`, or a floor shadow → refuse.
- Uncited and unhooked with no save-point-walk relevance → push back: a rule nothing
  surfaces is an aspiration.

## Related

[`update-contract`](./update-contract.verb.md) ·
[`retire-contract`](./retire-contract.verb.md) ·
[`save-point`](../acknowledgement/save-point.verb.md) walks the accumulated set ·
[`integrate-notepad`](../buffers/integrate-notepad.verb.md) feeds rules here.
