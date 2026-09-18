---
type: corpus
term: mirror
points_at:
  - lore/mirrors/index.md
  - lore/verbs/default/mirror-review.md
---

# Mirror

## What it means

A mirror is a description of the structure and the content of one [payload](./payload.md). It says what the payload looks like and where things go in it. Every payload has a mirror. A session reads the mirror before it writes to the payload, so that what it writes fits what is already there.

A mirror has two parts. The skeleton is the part that a script can generate from the payload: from the default branch for a repository, and from the folder for a publish area. The prose is the rest of the mirror, which a script cannot generate.

A mirror is current when the skeleton stored in it is the same as the skeleton that the script generates from the payload now. It is out of date when the two differ. This state is computed when it is needed and is stored nowhere. A branch that is not merged does not count.

## Where it is kept

The mirrors are the folder `lore/mirrors/`, with one mirror per payload, in a file named after the payload. The scripts that generate skeletons are in `lore/mirrors/generators/`. A mirror is a [card](./card.md) whose frontmatter has its payload, its skeleton generator and the stored skeleton. A new Space has one mirror, `lore/mirrors/publish.md`, which describes the default publish area.

## What acts on it

The verb payload-add writes the mirror of the payload that it adds, with a first skeleton. With the default set, the verb mirror-review generates the skeleton again, compares it with the stored one, proposes a change to the prose for each difference, and writes the mirror after the Human Lead confirms. A mirror is not reviewed while work is in progress. It is reviewed after the work is merged, against what the payload then contains. With the default set, the verb session-orient states which mirrors are out of date.

## Choices recorded here

- The product document of AI-Lore 1.0 lists "mirror and its skeleton" as one term. The session that wrote this entry on 2026-09-18 defined the skeleton in this entry and wrote no separate entry for it.
