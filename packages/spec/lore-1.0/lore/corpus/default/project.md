---
type: corpus
term: Project
points_at:
  - lore/space.md
---

# Project

## What it means

The Project is the Space's GitHub Project: the one GitHub Project over the issues of the Space repository. The plan is kept on it, and the [Agents board](../core/agents-board.md) is one of its views. AI-Lore adds no file that copies what is on the Project.

The default layout of the Project has these parts:

- A [focus](./focus.md) is a parent issue. It is the unit of work. Its kind, for example a feature, a document or an investigation, is a label.
- The [Stage field](./stage-field.md) is a single-select field on a focus.
- An [item](./item.md) is a sub-issue of a focus, or a standalone issue under no focus.
- A [dependency](./dependency.md) is GitHub's "blocked by" relation between two issues.
- A session issue has the fields of the Agents board: the focus, the write targets with their branches, the mode, attended or unattended, the person and the desk.
- There are three views: the focuses grouped by Stage, the items grouped by their parent focus, and the Agents board, which shows the session issues by column.

The layout uses only what GitHub provides: issues, sub-issues, single-select fields, labels and views. Labels are used for kinds because GitHub has issue types only for organizations, and a Space may belong to a user account.

The default processes read and write the fields that this layout names, so the layout and the processes are replaced together.

## Where it is kept

The Project is on GitHub. Every issue of the Space, focus, item and session issue, is an issue of the Space repository, and the Project is the view over them. The file `lore/space.md` gives the number of the Project in its key `github`.

## What acts on it

The companion creates the Project at setup with this layout. The Human Lead edits the plan in GitHub's interface, and a session edits the same issues and fields from the command line with `gh`. A session in Read only may update the Project. The companion keeps a cache of the Project and shows the plan and the Agents board from that cache.

## Choices recorded here

- The product document of AI-Lore 1.0 says that the fields of a session issue include "the person and the machine". This entry says "the person and the desk", as the Lore does in every place where the product document says "machine".
- The product document lists the terms of the default Project layout as corpus terms of the default set and names no folder for them. The session that wrote this entry on 2026-09-18 placed them in `lore/corpus/default/`, because the product document and the Human Lead's decision on the layers give each part of the Lore a `default/` folder.
