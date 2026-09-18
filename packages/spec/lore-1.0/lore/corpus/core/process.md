---
type: corpus
term: process
points_at:
  - lore/processes/index.md
---

# Process

## What it means

A process is a sequence of [verbs](./verb.md) and decisions to be followed. Its card declares its steps by name and in order, its [gates](./gate.md), which are the steps that need the Human Lead's yes, and whether it may run [unattended](./attended-and-unattended.md). A step that is not a gate runs without asking.

The Human Lead starts a process by its name, as with a verb. A process's name is one word, as in plan. No process runs another process.

A process is offered and not required. The Human Lead runs a process when they want what it gives, and asks a session directly when they do not. Work that runs no process has no confirmation after the dialog in which the session enters Writing.

A process is where a Space's way of working is defined: which steps happen, in what order, where the Human Lead is asked, and whether a session may run the process without the Human Lead present.

## Where it is kept

The processes are the folder `lore/processes/`. No process is core, and `lore/processes/core/` is empty. The three default processes, specify, plan and work, are in `lore/processes/default/`, and the Space's own processes are beside those two folders. A process is a [card](./card.md) whose frontmatter has its name, its pillar, its steps, its gates and whether it may run unattended.

## What acts on it

The verb process-add writes a new process. The companion reads the frontmatter of a process to show the step that a session is at and the gates of the process.
