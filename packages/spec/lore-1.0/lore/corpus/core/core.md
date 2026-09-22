---
type: corpus
term: core
points_at:
  - ai_readme.md
  - lore/corpus/core/index.md
  - lore/verbs/core/index.md
  - lore/contracts/core/index.md
  - lore/processes/core/index.md
---

# Core

## What it means

The core is the [layer](./layer.md) of files that are fixed. Setup places them. An upgrade of AI-Lore replaces them as a whole. They are never edited in place, and no other file in the Space may take the name of a core file. A term, a verb or a contract that is core is the same in every Space.

This is all of the core:

- `ai_readme.md`, the first file that a session reads.
- The index convention: every folder in the Lore has an [index file](./index-file.md). The convention is core, and the content of an index is not.
- The core entries of the corpus, one per term that AI-Lore itself defines. This entry is one of them.
- The five authoring verbs: verb-add, process-add, contract-add, corpus-add and payload-add. Because they cannot be replaced, a Space whose own files are broken can be repaired with them.
- Four contracts: write-guard, lore-integrity, journal-append-forward and stage-gate.

No process is core, and `lore/processes/core/` is empty. No mirror is core, because a mirror describes one of the Space's own payloads. The core has no plan, because the plan is on the Space's GitHub Project and not in files.

## Where it is kept

`ai_readme.md` is in the Space's folder. The other core files are in the folder `core/` of their part: `lore/corpus/core/`, `lore/verbs/core/`, `lore/contracts/core/` and `lore/processes/core/`.

## What acts on it

No verb writes a core file. The contract lore-integrity refuses a write under a `core/` folder. An upgrade of AI-Lore replaces the core files.
