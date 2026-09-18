---
type: space
format: 1
name: ""
github:
  repository: ""
  project: 0
repositories: []
publish_areas:
  - name: publish
    path: publish
---

# The Space's manifest

This file names the Space, its place on GitHub and its payloads. It holds no state: nothing in it says what a session is doing, what is claimed or what has changed. The companion app reads it to know which repositories and publish areas the Space has, and it recognises a folder as a Space of AI-Lore 1.0 when this file exists and its frontmatter has `type: space`.

The frontmatter follows the rules in the corpus entry [frontmatter](./corpus/core/frontmatter.md).

## The keys

- `type` is always `space`.
- `format` is the version of this file's layout. It is `1`.
- `name` is the name of the Space.
- `github` has two keys. `repository` is the Space repository on GitHub, written as owner and name with a slash between them. `project` is the number of the Space's GitHub Project under that owner.
- `repositories` has one item per repository of the Space. `name` is the repository's name in the Space, and its checkout is always the folder `repos/<name>`. `github` is the repository on GitHub, written as owner and name.
- `publish_areas` has one item per publish area. `name` is the publish area's name in the Space. `path` is its folder, written relative to the Space's folder, and it is present only when the publish area is inside the Space's folder. A publish area outside the Space's folder has no `path` here, because that path differs from one desk to another. The companion app keeps it with the desk's records.

A payload's name is also the name of its mirror: the payload `publish` is described by `lore/mirrors/publish.md`.

## Who writes this file

Setup writes it when the Space is created, and the verb payload-add changes it when a payload is added. A change to this file is a write to the Lore, so it needs a session in Writing with the Lore as its target.

In the template that AI-Lore ships, `name` and `repository` are empty, `project` is `0`, and `repositories` is an empty list. Setup replaces these values with the real ones. The one publish area listed is the folder `publish/`, which every new Space has.

## Example

A Space with one repository, the default publish area, and a second publish area outside the Space's folder:

```yaml
type: space
format: 1
name: example-space
github:
  repository: example-owner/example-space
  project: 1
repositories:
  - name: example-app
    github: example-owner/example-app
publish_areas:
  - name: publish
    path: publish
  - name: handbook
```

## Choices recorded here

The product document of AI-Lore 1.0 proposes a manifest and leaves its place and its keys open. The place `lore/space.md` and the key names come from the architecture document of the first build, where they are a proposal that the Human Lead has not yet accepted. The session that wrote this template on 2026-09-18 made one further choice: the template carries empty values and `0` where setup writes the real values, so that the file parses before setup has run.
