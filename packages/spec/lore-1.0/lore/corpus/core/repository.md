---
type: corpus
term: repository
points_at:
  - lore/space.md
  - lore/mirrors/index.md
---

# Repository

## What it means

A repository is a [payload](./payload.md) that holds code. It is a GitHub repository other than the Space repository. A Space has as many repositories as it needs.

The Space repository is a different thing: it is the one GitHub repository that holds the Lore, the default publish area and every issue of the Space. When the Lore says "repository" with no other word, it means a payload.

A session that claims a repository holds the whole repository, on the branch that the claim names, so one session writes to a repository at a time. With the default way of working, when the work is on a piece of work of the plan, the branch is created from the issue of that piece and the work ends with a pull request. The entries [item branch](../default/item-branch.md) and [pull request](../default/pull-request.md) describe both.

## Where it is kept

A repository is checked out on the desk under `repos/`, a folder inside the Space's folder that the Space repository git-ignores. The checkout of a repository is the folder `repos/` followed by the repository's name. The file `lore/space.md` lists the repositories of the Space, each with its address on GitHub. Each repository has a [mirror](./mirror.md) in `lore/mirrors/`.

## What acts on it

The verb payload-add adds a repository to the Space: it records it, checks it out and writes its mirror. A session writes to a repository only in Writing, with the repository as its [write target](./write-target.md), and the contract write-guard refuses a write on any branch other than the claimed one. With the default set, the verb mirror-review generates the skeleton of a repository's mirror from the repository's default branch.

## Choices recorded here

- The product document of AI-Lore 1.0 uses "repository" for a payload and "Space repository" for the repository of the Space, and does not state a rule for the word on its own. The session that wrote this entry on 2026-09-18 stated the rule that "repository" with no other word means a payload.
