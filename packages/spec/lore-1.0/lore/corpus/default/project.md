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

- The `Level` field is a single-select field on every issue of the plan, with the values `Focus` and `Item`. It says how granular the issue is and nothing else: a [focus](./focus.md) is a root with children, and an [item](./item.md) has none.
- The [Stage field](./stage-field.md) is a single-select field on every **root** — an issue with no parent on the Project — whatever its Level. A standalone item carries its own Stage.
- The `Status` field carries activity: `In Progress` means a desk is working on the issue now, `Paused` means started and unfinished with no desk on it, and `Todo` means no session has yet worked it.
- The kind of the work, for example a feature, a document or an investigation, is a label. It belongs on the root and is inherited by its children rather than repeated on every item.
- A [dependency](./dependency.md) is GitHub's "blocked by" relation between two issues.
- A session issue has the fields of the Agents board: the write targets with their branches, the mode, attended or unattended, the person and the desk.
- There are four views from setup: the plan, which shows every root whatever its Level; everything under a parent, grouped by the root it belongs to; the backlog, which is what is not on the plan yet; and the Agents board, which shows the session issues by column. A focus also gets a view of its own, created with the focus and removed with it.

`Level` is a recorded field and not something the companion works out. It used to be derived — an issue was a focus when it had a Stage, **or** a kind label, **or** sub-issues — and no GitHub filter expresses a three-way disjunction over a field, a label set and a relation. The Dashboard and the Project could not show the same set by construction. A ticket typed into GitHub's own interface must be as visible to a session as one a session created, so the category is recorded where a filter can read it.

**A view's grouping cannot be set through the GitHub API.** `groupByFields` and `verticalGroupByFields` can be read but not written, re-checked against the live schema on 2026-09-22. Setup therefore creates each view and leaves its grouping to the Human Lead, and says which groupings are still outstanding every time the Project is read rather than once at setup.

The layout uses only what GitHub provides: issues, sub-issues, single-select fields, labels and views. Labels are used for kinds because GitHub has issue types only for organizations, and a Space may belong to a user account.

The default processes read and write the fields that this layout names, so the layout and the processes are replaced together.

## Where it is kept

The Project is on GitHub. Every issue of the Space, focus, item and session issue, is an issue of the Space repository, and the Project is the view over them. The file `lore/space.md` gives the number of the Project in its key `github`.

## What acts on it

The companion creates the Project at setup with this layout. The Human Lead edits the plan in GitHub's interface, and a session edits the same issues and fields from the command line with `gh`. A session in Read only may update the Project. The companion keeps a cache of the Project and shows the plan and the Agents board from that cache.

## Choices recorded here

- The product document of AI-Lore 1.0 says that the fields of a session issue include "the person and the machine". This entry says "the person and the desk", as the Lore does in every place where the product document says "machine".
- The product document lists the terms of the default Project layout as corpus terms of the default set and names no folder for them. The session that wrote this entry on 2026-09-18 placed them in `lore/corpus/default/`, because the product document and the Human Lead's decision on the layers give each part of the Lore a `default/` folder.
