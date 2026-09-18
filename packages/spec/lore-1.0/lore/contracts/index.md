---
type: index
---

# Contracts

A contract says what must never happen when a session writes. Each contract is one card. A contract names its target: everything, the Lore, the journal in the Workbench, the plan on GitHub, or a payload. It has two halves. The check is a script that the AI engine runs before or after a write to the target. The rule is the prose for what no script can cover. A contract may have only a rule, and then its card says so. A session treats a contract that has only a rule as advice that it can be asked to justify, not as something that is enforced.

A check script is kept in the same folder as its card, so that every clone of the Space has the same checks. A script has a line in its folder's index, as every file has.

The Space's own contracts are files in this folder, beside the folder below, and each has a line here. No file may take the name of a file in `core/`. The verb contract-add writes a new contract.

- [core/](./core/index.md): the contracts that AI-Lore itself fixes, with their check scripts.
