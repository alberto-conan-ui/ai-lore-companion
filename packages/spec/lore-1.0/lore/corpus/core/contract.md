---
type: corpus
term: contract
points_at:
  - lore/contracts/index.md
---

# Contract

## What it means

A contract says what must never happen when a session writes. A contract names its target: everything, the Lore, a payload, the journal in the Workbench, or the plan on GitHub.

A contract has two halves, a check and a rule.

- The check is a script that the AI engine runs before or after a write to the contract's target. The engine runs it, and not the session. Where the engine has hooks, the check runs as a hook.
- The rule is prose. It covers what no script can check.

A contract may have only a rule, and then its card says so. A session treats a contract that has only a rule as advice that it can be asked to justify, and not as something that is enforced.

## Where it is kept

The contracts are the folder `lore/contracts/`. The five core contracts are in `lore/contracts/core/`: write-guard, lore-integrity, journal-append-forward, spec-before-breakdown and stage-gate. The Space's own contracts are beside that folder. A check script is kept in the Lore, in the same folder as the card of its contract, so that every clone of the Space repository has the same checks.

A contract is a [card](./card.md) whose frontmatter has its target, its check script if it has one, and whether the check runs before or after a write.

## What acts on it

The verb contract-add writes a new contract. The companion installs the checks into the AI engine as hooks of that engine. The Human Lead adds contracts one at a time, as the Space learns what must never happen in it.

## Choices recorded here

- The product document of AI-Lore 1.0 lists "contract with its check and rule" as one term. The session that wrote this entry on 2026-09-18 defined the check and the rule in this entry and wrote no separate entry for either.
