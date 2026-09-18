---
type: corpus
term: dependency
points_at:
  - lore/processes/default/work.md
---

# Dependency

## What it means

A dependency says that one issue cannot be worked before another issue is done. In the default [Project](./project.md) layout it is GitHub's own relation between two issues, "blocked by" on one issue and "blocking" on the other. The [breakdown](../core/breakdown.md) of a unit of work is its pieces of work and the dependencies between them.

GitHub shows a marker named Blocked on an issue that is blocked by another issue. That marker is not the column Blocked of the Agents board, which is for an unattended session that waits at a gate.

## Where it is kept

A dependency is kept on GitHub, on the two issues that it relates. It is set in GitHub's interface or from the command line.

## What acts on it

The verb plan-break-down sets the dependencies between the [items](./item.md) when it writes the breakdown. The Human Lead starts the process work on each item in the order that the dependencies allow. In its first step the process work reads the item's dependencies, and if the item is blocked by another item that is not done, the process stops and the session says so. A session in Read only may add a dependency, because the Project is neither a payload nor the Lore.
