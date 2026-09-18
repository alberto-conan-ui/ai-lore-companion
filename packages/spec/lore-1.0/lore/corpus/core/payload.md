---
type: corpus
term: payload
points_at:
  - lore/space.md
  - lore/mirrors/index.md
---

# Payload

## What it means

A payload is what the sessions of an [AI Space](./ai-space.md) produce. There are two kinds of payload: a [repository](./repository.md), which holds code, and a [publish area](./publish-area.md), which holds documents. A Space has as many of each as it needs.

AI-Lore does not say what a payload should contain. The Lore of the Space says it. Every payload has a [mirror](./mirror.md) in the Lore that says what the payload looks like and where things go in it.

## Where it is kept

A repository is checked out on the desk under `repos/`. A publish area is a folder, either inside the Space's folder or in another place on the same computer. The file `lore/space.md` lists the payloads of the Space, and `lore/mirrors/` has one mirror per payload, in a file named after the payload.

## What acts on it

The verb payload-add adds a payload to a Space: it records the payload, creates or checks out its folder, and writes its mirror with a first skeleton. A session writes to a payload only in [Writing](./writing.md), with that payload as its [write target](./write-target.md), and it reads the payload's mirror before it writes. The contract write-guard refuses a write to a payload that the session has not claimed.
