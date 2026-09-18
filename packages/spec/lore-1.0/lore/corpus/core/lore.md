---
type: corpus
term: Lore
points_at:
  - lore/index.md
---

# Lore

## What it means

The Lore is what every AI Agent in the [AI Space](./ai-space.md) must know: how to behave in the Space and how the payloads are to be written. It is a folder of markdown files. A session learns how the Space works from the Lore and from no other place: there is no configuration screen for it, no prompt typed at the start of a session, and no memory inside the AI.

The Lore has five parts: the [corpus](./corpus.md), the [verbs](./verb.md), the [processes](./process.md), the [contracts](./contract.md) and the [mirrors](./mirror.md). Each part is read at a different moment: a corpus entry when its word comes up, a verb when it is invoked, a process when it is run, a contract before every write to its target, and a mirror before writing to its payload. Nothing is read before it is needed.

Every file in the five parts is a [card](./card.md). The files of the Lore come from three [layers](./layer.md).

## Where it is kept

The Lore is the folder `lore/` in the Space's folder. It is kept in git with the Space repository as its remote, so it is the same on every desk of the Space and every change to it has a history. `lore/index.md` has one line per part, and every folder in the Lore has an [index file](./index-file.md).

## What acts on it

The Human Lead changes the Lore, which is the pillar [Shaping](./shaping.md). The five authoring verbs, verb-add, process-add, contract-add, corpus-add and payload-add, each add to it. There is no verb for changing or removing a file: with the Lore claimed, editing or deleting one of the Space's own files is an ordinary write.

A session writes to the Lore only in [Writing](./writing.md) with the Lore as its [write target](./write-target.md). The Lore is one target, and one session holds it at a time. The contract lore-integrity refuses a write under a `core/` or `default/` folder, and after every write to the Lore it checks the frontmatter, the references and the indexes.
