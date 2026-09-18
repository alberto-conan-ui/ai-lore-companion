---
type: mirror
payload: publish
generator: lore/mirrors/generators/folder-skeleton.py
skeleton:
  - "specs/"
  - "specs/index.md"
---

# The publish area `publish`

This mirror describes the default publish area of the Space: the folder `publish/` in the Space repository. A new Space has this publish area from setup. It is versioned with the Space, so every desk that clones the Space has the same folder and reads the same specs.

Read this mirror before you write to `publish/`, and before you draft a spec. The verb spec-draft reads it to know how a spec is written.

## What the folder holds

```
publish/
└── specs/
    ├── index.md      one line per agreed spec
    └── <spec>.md     one file per agreed spec
```

`specs/` holds the agreed specs of the Space. Every agreed spec is one file in `specs/`. `specs/index.md` lists them, with one line per spec in this form:

```
- [file-name.md](./file-name.md): one sentence that says what the spec is about.
```

The files of this publish area are markdown files without frontmatter.

A spec that is not agreed is not in this folder. It is a draft, and drafts are kept in the Workbench.

## How a spec gets here

A spec is written with the Human Lead as a draft in the Workbench, with the verb spec-draft, over as many sessions as it takes. When the Human Lead declares the draft agreed, the process specify reaches its gate, and the Human Lead confirms the publish area, with `specs/` selected unless the Human Lead names another folder. The verb spec-agree then enters Writing with this publish area as its target, publishes the spec as one file in `specs/` with its line in `specs/index.md`, removes the draft from the Workbench, and links the published spec from its unit of work.

A write to `publish/` needs a session in Writing with this publish area as its target.

## How a spec is written

These four rules apply to every sentence of a spec.

- It is written in literal statements.
- It has no metaphor.
- It has no sentence written for effect.
- It has no detail that the Human Lead did not give.

## The sections of a spec

This section is a placeholder. The sections of a spec are not decided: the product document of AI-Lore 1.0 leaves them open, and the Human Lead chose not to fix them when this default set was written.

The Human Lead writes the sections here. Until they are written here, this mirror names no section, and the sections of a spec are the ones that the Human Lead gives for that spec.

## Changing this publish area

The Human Lead may add folders to `publish/` for the other documents that the Space produces, arrange them, or move `specs/`. Sessions learn the structure of `publish/` from this mirror, so a change to the folders is followed by a change to this mirror. The Human Lead changes how a spec is written in this Space by editing this file.

## The skeleton

The skeleton of this mirror is the listing of the folder `publish/`. The generator for folders prints it when it is run from the Space's folder:

```
python3 lore/mirrors/generators/folder-skeleton.py publish
```

This mirror is current when the lines that this command prints are the same as the items of `skeleton` in the frontmatter above, and out of date when they differ. Every published spec adds a file to `specs/`, so this mirror is out of date after a spec is published, until the verb mirror-review writes the new skeleton.

## Choices recorded here

The session that wrote this mirror on 2026-09-18 made the following choices. Each is open to the Human Lead's review.

- The sentence that says which sections a spec has until the Human Lead writes them here.
- The files of this publish area have no frontmatter. The corpus entry frontmatter leaves this to the mirror of each publish area, and the product document does not give a spec any frontmatter.
- The stored skeleton is generated without the option `--depth`, so it lists every file in `publish/`.
