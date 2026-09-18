---
type: corpus
term: Producing
points_at:
  - lore/mirrors/index.md
  - lore/verbs/default/mirror-review.md
---

# Producing

## What it means

Producing is the [pillar](./pillar.md) of what the work produces: the [payloads](./payload.md), written as the Lore says they must be, and the [agreed specs](./agreed-spec.md), published to a publish area.

AI-Lore does not say what a payload should contain. The Lore does: its mirrors say what each payload looks like and where things go, its corpus says what the words mean, and its contracts say what must never be written. A session that writes to a payload reads these first.

Finished work is shown by [evidence](./evidence.md).

Two things about Producing are fixed. A payload is written only by a session in Writing that has claimed it, and a repository is written on the branch that the claim names. An agreed document is published to a payload and is never kept only in a Workbench. Everything else is a process that the Human Lead can change: which publish areas the Space has and how they are structured, what a repository must look like, whether a pull request or a merge ends a piece of work, and what evidence a criterion needs.

## Where it is kept

The payloads are the repositories under `repos/` and the publish areas. The description of each payload is its [mirror](./mirror.md) in `lore/mirrors/`.

## What acts on it

No process ships for Producing. With the default set, producing happens inside the other processes: specify publishes the agreed spec, and work writes to the repositories and opens the pull request. One default verb serves this pillar: mirror-review, which makes a mirror match its payload again after the work is merged. No core contract guards this pillar, because what a payload must look like is for each Space to decide.
