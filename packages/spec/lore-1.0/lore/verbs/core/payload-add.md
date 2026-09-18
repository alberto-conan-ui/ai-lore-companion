---
type: verb
name: payload-add
pillar: shaping
mode: writing
invoked_by:
  - human-lead
---

# payload-add

This verb adds one payload to the Space. A payload is what the sessions of a Space produce, and there are two kinds. A repository holds code: it is a GitHub repository other than the Space repository, and its checkout on the desk is the folder `repos/<name>`. A publish area holds documents: it is a folder, either inside the Space's folder or in another place on the same computer. The verb records the payload in `lore/space.md`, creates or checks out its folder, and writes its mirror with a first skeleton.

## When it is invoked

The Human Lead invokes it when the Space starts to work on another repository, or when the Space needs another publish area.

It is not the verb for changing how an existing payload is described. A mirror that no longer matches its payload is brought up to date with mirror-review.

## What it reads

- `lore/space.md`, for the payloads that the Space already has and for the keys of the manifest.
- `lore/corpus/core/card.md`, for the frontmatter keys of a mirror, and `lore/corpus/core/frontmatter.md`, for how frontmatter is written.
- `lore/mirrors/index.md` and `lore/mirrors/generators/index.md`, for the mirrors that exist and for the two skeleton generators.
- The payload itself, after it is checked out or created, so that the mirror's prose describes what is there.

## What it writes and the mode it needs

In the Lore it changes `lore/space.md`, writes the new mirror `lore/mirrors/<name>.md`, and adds one line to `lore/mirrors/index.md`. The session must therefore be in Writing with a claim that covers the Lore.

Outside the Lore it creates the payload's folder. For a repository it clones the repository into `repos/<name>`, a folder that the Space repository git-ignores. For a publish area it creates the folder when the folder does not exist yet. It writes nothing else into the payload.

## Steps

1. Settle the payload with the Human Lead before writing anything. The points to settle are: its kind, repository or publish area; its name in the Space; for a repository, its address on GitHub, written as owner and name with a slash between them; for a publish area, its folder. The name is written in lower-case letters, digits and hyphens, because the mirror's file is named after it.
2. Check the name against `lore/space.md` and `lore/mirrors/index.md`. If a payload or a mirror already has the name, stop and say so. If the repository is the Space repository itself, refuse: the Space repository is not a payload.
3. Enter Writing with the Lore as the target, as the next section says.
4. Record the payload in the frontmatter of `lore/space.md`, as that file describes its keys. A repository is a new item of `repositories` with `name` and `github`. A publish area is a new item of `publish_areas` with `name`, and with `path` only when its folder is inside the Space's folder. The path of a publish area outside the Space's folder differs from one desk to another. It is kept in the desk's records, which the companion writes and a session cannot write. Tell the Human Lead that the companion must be given that path on this desk.
5. Create or check out the folder. For a repository, clone it from GitHub into `repos/<name>`. For a publish area, create the folder if it does not exist.
6. Generate the first skeleton. For a repository, run `python3 lore/mirrors/generators/repository-skeleton.py repos/<name>`, which lists the repository's default branch. For a publish area, run `python3 lore/mirrors/generators/folder-skeleton.py <folder>`, which lists the folder. Each script prints the skeleton, one line per file or folder, and writes no file.
7. Read the payload, and write `lore/mirrors/<name>.md`. The frontmatter has the keys `type`, `payload`, `generator` and `skeleton`, as `lore/corpus/core/card.md` describes them. `generator` holds the path of the script that was run in step 6, and `skeleton` holds the lines that it printed, one list item per line. The prose says what the payload looks like and where things go in it. It describes what is in the payload now. When the prose needs a rule for how the payload is written, and the Human Lead has not given that rule, ask for it and do not fill it in.
8. Add the mirror's line to `lore/mirrors/index.md`, in the form `- [<name>.md](./<name>.md): one sentence.`
9. The AI engine runs the check of the contract lore-integrity after each write to the Lore. Until step 8 is done, the check reports that the index does not list the new mirror. Fix every other failure, and every failure that remains after step 8, before leaving Writing.
10. Commit the changed manifest, the new mirror and the changed index in the Space repository, and push the commit, so that the other desks of the Space get the change.
11. If the session was in Read only when this verb was invoked, call the tool `leave_writing` to return to Read only. If the session was already in Writing, stay in Writing.
12. Tell the Human Lead the name of the payload, the path of its folder and the path of its mirror. From then on a session writes to the payload only in Writing with that payload as its write target.

## Entering Writing

If the session already has a claim that covers the Lore, continue with step 4. If it does not, ask the companion for the claim:

1. Call the tool `request_writing`. Give `targets` with one target, the Lore, written `{ "kind": "lore" }`, and give `reason` with one sentence that says what will be written. The tool returns a ticket at once, and the companion shows the Human Lead the entering-Writing dialog.
2. Call the tool `await_answer` with the ticket. When it returns `{ "status": "pending" }`, the Human Lead has not answered yet, so call it again.
3. When the answer has `granted: true`, the session is in Writing and the companion has recorded the claim on the desk. When the answer has `granted: false`, its `reason` is `held` or `declined`. `held` means that another session holds the Lore, and `heldBy` names that session. `declined` means that the Human Lead said no. In both cases the session stays in Read only: tell the Human Lead what the answer was, and write nothing.
4. After an answer with `granted: true`, read the column Writing of the Agents board again with `gh`. If an issue that was created earlier claims the same target, call the tool `leave_writing`, tell the Human Lead which session holds the target, and write nothing. If GitHub cannot be reached, other desks cannot be checked: say so and go on.

The tools belong to the local server that the companion runs for the session. In Claude Code their names begin with `mcp__ailore__`, as in `mcp__ailore__request_writing`. A session that does not have these tools was not started by the companion and cannot enter Writing. In that case say so and stop.

## Contracts

- write-guard, `lore/contracts/core/write-guard.md`. Before each write, its check refuses a write to the Lore from a session in Read only, and a write outside the claimed targets from a session in Writing.
- lore-integrity, `lore/contracts/core/lore-integrity.md`. After a write to the Lore, its check requires that every file's frontmatter parses, that every reference resolves, and that every index lists exactly its children. The key `generator` of the new mirror is such a reference.

## What it refuses

- A name that a payload or a mirror of the Space already has.
- The Space repository as a payload.
- Writing files into the new payload. That is work on the payload, and it needs a claim on the payload.
- Removing or renaming a payload. There is no verb for that: with the Lore claimed, editing `lore/space.md` and the mirror is an ordinary write.
- Any write before the Human Lead has confirmed the claim on the Lore.

## Choices recorded here

The session that wrote this card on 2026-09-18 made the following choices. Each is open to the Human Lead's review.

- The product document says that this verb records the payload, creates or checks out its folder, and writes its mirror with a first skeleton, and that it needs Writing with the Lore as its target. The order of steps 4 to 8, and steps 1, 2 and 12, are the smallest steps that follow from that.
- The product document proposes that the path of a publish area outside the Space's folder is kept with the desk's records. The sources name no way for a session to give that path to the companion. Step 4 therefore tells the Human Lead and does nothing else about that path.
- The product document says that the Lore is kept in git and is the same on every desk. It does not say which step commits a change to the Lore. Step 10 follows from that statement.
- The product document does not say whether a verb leaves Writing when it ends. Step 11 returns the session to the mode it was in before the verb.
- The product document has a session read the column Writing again after its claim. The architecture document of the first build leaves that reading out. Step 4 of the section "Entering Writing" follows the product document.
- The names of the tools, their arguments and their answers come from the architecture document of the first build, where they are a proposal that the Human Lead has not yet accepted. The place of the manifest, `lore/space.md`, comes from the same document and has the same standing.
