---
type: corpus
term: custom
points_at:
  - ai_readme.md
---

# Custom

## What it means

The custom [layer](./layer.md) is the Space's own files in the Lore. A file of this layer is called an own file. The Human Lead uses the layer in two ways:

- To replace a [default](./default.md): the Human Lead writes a file with the same name as the default, beside the `default/` folder, and the own file is used instead of the default.
- To add something that no default covers: a verb that the Space needs, a contract for something that must never happen in this Space, a corpus entry for a concept of the Space.

Both ways produce ordinary markdown files, and the index of the folder lists them. The Space's own files are read in the same way as the core files and the defaults.

## Where it is kept

The Space's own files are in the folder of their part of the Lore, beside the folders `core/` and `default/`. A verb of the Space's own named release-notes is the file `release-notes.md` in `lore/verbs/`. An upgrade of AI-Lore does not change the Space's own files.

## What acts on it

The authoring verbs verb-add, process-add, contract-add and corpus-add each write one new own file, and the verb payload-add writes a mirror. There is no verb for changing or removing an own file: with the Lore claimed, editing or deleting it is an ordinary write. No own file may take the name of a [core](./core.md) file.

## Choices recorded here

- The product document of AI-Lore 1.0 names the layer "custom" and calls its files "the Space's own files". The Human Lead's decision of 2026-09-18 on the layers also says "own file". The Lore uses both words in that way: "custom" is the name of the layer, and "own file" is the name of a file in it.
