---
type: index
---

- [pm.md](./pm.md): the PM role, its reporting responsibility and its Read only boundaries.
- [dashboard.md](./dashboard.md): the PM dashboard report, its default sections and project customisation.

# Corpus: default entries

The entries for the terms of the default set: the default layout of the Space's GitHub Project, and what the default way of working adds to a repository and to the Space's folder. The default verbs and processes say "with the default layout" where they use these terms, and these entries are where the Lore describes that layout.

These files ship with AI-Lore. They are not edited in place, and an upgrade of AI-Lore replaces them as a whole. To change one, write a file with the same name in the folder above this one, and add its line to that folder's index. The own file is then used instead of the default. A Space that changes its Project layout changes these entries and the processes together.

- [project.md](./project.md): what the Project is in the default set of AI-Lore, the Space's one GitHub Project, with the fields, labels and views of the default layout.
- [focus.md](./focus.md): what a focus is in the default Project layout, a parent issue that is the unit of work, can have a spec and has a Stage.
- [stage-field.md](./stage-field.md): what the Stage field is in the default Project layout, a single-select field on a focus with the values Spec, Plan, Build, Review and Done, and who makes each move.
- [item.md](./item.md): what an item is in the default Project layout, a sub-issue of a focus with its acceptance criteria in the body, or a standalone issue under no focus.
- [dependency.md](./dependency.md): what a dependency is in the default Project layout, GitHub's "blocked by" relation between two issues, and how the process work uses it.
- [item-branch.md](./item-branch.md): what an item branch is in the default way of working, the branch of a repository that is created from an item's issue and named in the session's claim.
- [pull-request.md](./pull-request.md): what a pull request is in the default way of working, how the process work ends the work on an item, opened without asking and merged only by the Human Lead.
- [unattended-label.md](./unattended-label.md): what the `unattended` label is, a proposed GitHub label that shows which items the Human Lead tagged for unattended work.
- [default-publish-area.md](./default-publish-area.md): what the default publish area is, the folder `publish/` of the Space repository with its folder `specs/` for the agreed specs, and its mirror.
