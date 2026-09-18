---
type: corpus
term: layer
points_at:
  - ai_readme.md
---

# Layer

## What it means

A layer says where a file of the [Lore](./lore.md) comes from, who wrote it and whether it can be changed. There are three layers:

- [Core](./core.md): the files that are fixed.
- [Default](./default.md): the files that ship with AI-Lore and that a Space may replace.
- [Custom](./custom.md): the Space's own files.

The files of all three layers are read in the same way.

## Where it is kept

Each part of the Lore can have a folder `core/`, a folder `default/`, and the Space's own files beside those two folders. A file's layer is known from where the file is. An own file with the same name as a file in `default/` is used instead of that default. No file may take the name of a file in `core/`.

An upgrade of AI-Lore replaces `core/` and `default/` as a whole and changes none of the Space's own files.

## What acts on it

The authoring verbs write the Space's own files, which are the custom layer. The contract lore-integrity refuses a write under a `core/` or a `default/` folder.
