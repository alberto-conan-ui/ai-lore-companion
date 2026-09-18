---
type: corpus
term: pull request
points_at:
  - lore/processes/default/work.md
---

# Pull request

## What it means

A pull request is GitHub's request to merge one branch of a repository into another. With the default way of working, the work on an [item](./item.md) ends with a pull request for its [item branch](./item-branch.md).

The process work opens the pull request in its last step, without asking the Human Lead. It does not merge it. Merging is the Human Lead's act on GitHub. Work that is on no item runs no process, and the session opens a pull request for it only if the Human Lead asks.

Whether a pull request or a merge ends an item is not fixed. It is part of the process, which the Human Lead can change.

## Where it is kept

A pull request is kept on GitHub, in the payload's repository. After it is opened, GitHub shows it in the section Development of the item's issue, in place of the branch.

## What acts on it

The process work opens the pull request in its step leave-writing. A mirror is reviewed after the pull request is merged: the merge changes the repository's default branch, the repository's mirror can then be out of date, and the Human Lead runs the verb mirror-review when they choose.

## Choices recorded here

- The Human Lead decided on 2026-09-18 that the pull request opens without asking. The product document of AI-Lore 1.0 proposes that the process work always opens a pull request and never merges, and leaves that point open. This entry and the process work follow the proposal.
