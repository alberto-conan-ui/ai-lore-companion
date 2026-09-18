---
type: index
---

# Processes: default

The processes that ship with AI-Lore. These files are not edited in place, and an upgrade of AI-Lore replaces them as a whole. To change one, write a file with the same name in the folder above this one, and add its line to that folder's index. The Space's file is then used instead of the default.

There is one process for each of the pillars Specifying, Planning and Working. The Human Lead starts each one by its name, and no process runs another.

- [specify.md](./specify.md): start this process when an idea should become an agreed spec; it opens or takes a unit of work on the plan, drafts the spec with the Human Lead in the Workbench, asks the Human Lead to declare the draft agreed, and publishes the agreed spec in a publish area.
- [plan.md](./plan.md): start this process when a unit of work has an agreed spec and needs its breakdown; it proposes the pieces of work with acceptance criteria drawn from the spec, asks the Human Lead to confirm the list, and writes it to the plan on the Space's GitHub Project.
- [work.md](./work.md): start this process when one item of the plan is to be built; it claims the write targets and enters Writing with the Human Lead's confirmation, works on a branch created from the item's issue, reports each acceptance criterion with its evidence, opens a pull request and returns to Read only.
