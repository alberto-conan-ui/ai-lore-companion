---
type: corpus
term: item branch
points_at:
  - lore/processes/default/work.md
  - lore/contracts/core/write-guard.md
---

# Item branch

## What it means

An item branch is the branch of a [repository](../core/repository.md) on which the work on one [item](./item.md) is done. It is created from the item's issue with the command `gh issue develop --branch-repo`. The option `--branch-repo` is needed because the issue is in the Space repository and the branch is in the payload's repository. GitHub shows the branch in the section Development of the item's issue until a pull request replaces it.

A session that works an item names the repository and the item branch as its [write target](../core/write-target.md). The claim covers the whole repository, on that branch.

## Where it is kept

The branch is in the payload's repository, on GitHub and in the checkout under `repos/`. The link between the branch and the item is kept by GitHub, on the item's issue.

## What acts on it

In the step claim of the process work, the session creates the item branch, or takes the branch that the item's issue already has when an earlier session started the item. The contract write-guard refuses a write to the repository while a branch other than the claimed one is checked out. The last step of the process work pushes the branch and opens a [pull request](./pull-request.md) for it.

## Choices recorded here

- The product document of AI-Lore 1.0 says that the session runs `gh issue develop --branch-repo`. The architecture document of the first build has the companion create the branch when the Human Lead confirms the entering-Writing dialog. This entry follows the product document. The Human Lead is asked to settle which of the two creates the branch.
