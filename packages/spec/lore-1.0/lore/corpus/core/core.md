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

## What a core card may not say

**A core card does not name anything a Space is entitled to replace.** Not the values of a field, not the name of a field, not the kind of issue something is recorded on, not which process covers what. Those belong to the default layer, where a Space that works differently writes its own file beside them.

The reason is the shape of core itself. A core file cannot be edited in place, and no Space file may take its name — so the ordinary way of correcting a file is unavailable for it. A core card that names a replaceable detail is a sentence that goes stale in every Space that exercises its right to replace that detail, and stays stale until AI-Lore is upgraded, while every session reads it.

Two cards were written this way and had to be corrected: stage-gate said the stage of a unit of work is "the Stage field of a focus", and this card's neighbour stage.md listed five stage values and mapped a process to each. A Space that merged two of those stages then had two core cards stating something false about its own plan, and no way to fix either.

A core card says what is true in every Space, and points at the Space's own Lore for the rest.

## Where it is kept

`ai_readme.md` is in the Space's folder. The other core files are in the folder `core/` of their part: `lore/corpus/core/`, `lore/verbs/core/`, `lore/contracts/core/` and `lore/processes/core/`.

## What acts on it

No verb writes a core file. The contract lore-integrity refuses a write under a `core/` folder. An upgrade of AI-Lore replaces the core files.
