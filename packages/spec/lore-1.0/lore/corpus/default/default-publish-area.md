---
type: corpus
term: default publish area
points_at:
  - lore/mirrors/publish.md
  - publish/specs/index.md
  - lore/space.md
---

# Default publish area

## What it means

The default publish area is the one [publish area](../core/publish-area.md) that a new Space has from setup: the folder `publish/` in the Space repository. Its name in `lore/space.md` is `publish`. Because it is in the Space repository, it is versioned with the Space and every desk of the Space has it. A Space can therefore publish its first spec without adding a payload.

Its specs folder is the folder `publish/specs/`. Every [agreed spec](../core/agreed-spec.md) is published as one file in it, and the index of the folder has one line per agreed spec.

The Human Lead is expected to change this: to add folders to `publish/` for the other documents of the Space, to move `specs/`, or to add publish areas in other places. A change to the folders is followed by a change to the mirror.

## Where it is kept

The folder `publish/` is in the Space's folder. Its mirror is `lore/mirrors/publish.md`, the only mirror in a new Lore. The skeleton of that mirror is the listing of the folder. Its prose says which sections a spec has and how a spec is written: in literal statements, with no metaphor, with no sentence written for effect, and with no detail that the Human Lead did not give.

## What acts on it

The verb spec-draft reads the mirror before it drafts. At the gate of the process specify, the session names this publish area unless the Human Lead names another. The verb spec-agree publishes the agreed spec in `publish/specs/` and adds its line to the index of that folder. The Human Lead changes the form of the Space's specs by changing the mirror. The part `lore/mirrors/` has no `core/` and no `default/` folder, so `lore/mirrors/publish.md` is edited in place, with the Lore claimed.

## Choices recorded here

- The product document of AI-Lore 1.0 lists "the default publish area and its specs folder" as one term. The session that wrote this entry on 2026-09-18 defined the specs folder in this entry and wrote no separate entry for it.
