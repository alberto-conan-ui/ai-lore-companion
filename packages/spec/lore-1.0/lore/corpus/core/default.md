---
type: corpus
term: default
points_at:
  - lore/verbs/default/index.md
  - lore/processes/default/index.md
  - lore/corpus/default/index.md
---

# Default

## What it means

A default is a file of the [layer](./layer.md) that ships with AI-Lore already written, so that a new Space can be used from the start. The defaults are one way of working. They are a starting point and not a requirement, and a Space is expected to change them.

The default set is three processes, seven verbs, one publish area with its mirror, a layout for the Space's GitHub Project, and a starter corpus. The processes are specify, plan and work. The verbs are spec-draft, spec-agree, plan-break-down, session-orient, session-close, work-report and mirror-review. The publish area is the folder `publish/`. The starter corpus is the core entries, the default entries for the terms of the Project layout and of the default way of working, and one entry for the Space itself, which is written at setup.

A default file is not edited in place. To change a default, the Human Lead writes a file with the same name beside the `default/` folder, and the own file is used instead of the default.

## Where it is kept

Default verbs are in `lore/verbs/default/`, default processes are in `lore/processes/default/`, and default corpus entries are in `lore/corpus/default/`. An upgrade of AI-Lore replaces a `default/` folder as a whole. The Project layout is on GitHub and is not a file, and the entries in `lore/corpus/default/` describe it. The mirror of the default publish area is `lore/mirrors/publish.md`, because the part `lore/mirrors/` has no `default/` folder.

## What acts on it

No verb writes a default file. The contract lore-integrity refuses a write under a `default/` folder. The authoring verbs write the file that replaces a default, which is an own file and belongs to the [custom](./custom.md) layer.

## Choices recorded here

- The product document of AI-Lore 1.0 says that the default set adds the corpus entries it needs, and that focus and item are not core terms. It names no folder for those entries. The session that reviewed this entry on 2026-09-18 placed them in `lore/corpus/default/`, because the product document and the Human Lead's decision on the layers give each part of the Lore a `default/` folder. The architecture document of the first build does not show that folder in its tree.
