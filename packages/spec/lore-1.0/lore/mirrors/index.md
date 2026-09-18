---
type: index
---

# Mirrors

A mirror describes one payload: what it looks like and where things go in it. Every payload of the Space has one mirror. Read a payload's mirror before you write to that payload. A mirror has two parts: a skeleton, which a script can regenerate from the payload, and prose, which describes the payload in words. A mirror is current when its stored skeleton is the same as one regenerated from the payload, and out of date when the two differ. That state is computed when it is needed and is stored nowhere.

A mirror is reviewed after work is merged, not while work is in progress.

This part has no `core/` folder and no `default/` folder, because mirrors describe the Space's own payloads. Every mirror is a file in this folder, named after its payload, and each has a line here. The verb payload-add writes a payload's mirror with a first skeleton.

- [generators/](./generators/index.md): the scripts that generate a payload's skeleton.
