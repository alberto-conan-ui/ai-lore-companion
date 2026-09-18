---
type: corpus
term: publish area
points_at:
  - lore/space.md
  - lore/mirrors/publish.md
  - publish/specs/index.md
---

# Publish area

## What it means

A publish area is a [payload](./payload.md) that holds documents: the [agreed specs](./agreed-spec.md), and anything else that the Space publishes. A Space has as many publish areas as it needs.

In AI-Lore 1.0 a publish area is a local folder, in one of two places. It is inside the Space repository, and then it is versioned with the Space and every desk that clones the Space has it. Or it is another folder on the same computer, outside the Space repository, and then it is versioned and shared only if the place it is in does that.

A new Space has one publish area from setup: the folder `publish/` in the Space repository, with the folder `specs/` in it. It is the [default publish area](../default/default-publish-area.md). The Human Lead is expected to change this: to add folders to `publish/`, to move `specs/`, or to add publish areas in other places. A session learns the structure from the mirror, so a change to the folders is followed by a change to the mirror.

## Where it is kept

The file `lore/space.md` lists the publish areas of the Space. For a publish area inside the Space's folder it gives the path. The path of a publish area outside the Space's folder differs from one desk to another, so the companion keeps it with the desk's records. Each publish area has a [mirror](./mirror.md) in `lore/mirrors/`, and the mirror of `publish/` is `lore/mirrors/publish.md`.

## What acts on it

The verb payload-add adds a publish area to the Space. A session writes to a publish area only in Writing, with that publish area as its [write target](./write-target.md). With the default set, the verb spec-agree publishes an agreed spec to the publish area that the Human Lead names at the gate of the process specify, and the verb mirror-review generates the skeleton of a publish area's mirror from its folder.
