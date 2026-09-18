---
type: verb
name: corpus-add
pillar: shaping
mode: writing
invoked_by:
  - human-lead
---

# corpus-add

This verb writes one new corpus entry into the Lore. The corpus says what the words mean in this Space, with one entry per concept. A session reads an entry when it meets the word in the Lore, on the GitHub Project or in the conversation. The new entry is one of the Space's own files.

## When it is invoked

The Human Lead invokes it when the Space uses a word that a new session would not understand, or would understand differently: a name of the product, a convention of a client, a term of the subject that the Space is about. They also invoke it when they want the Space's own version of a default entry, for example after they have changed the Project layout.

It is not the verb for the terms that AI-Lore itself defines. Those are the entries in `lore/corpus/core/`, and they have the same meaning in every Space.

## What it reads

- `lore/corpus/core/card.md`, for the frontmatter keys of a corpus entry and for how an entry's file is named.
- `lore/corpus/core/frontmatter.md`, for how frontmatter is written.
- `lore/corpus/index.md`, `lore/corpus/core/index.md` and `lore/corpus/default/index.md`, for the terms that already have an entry.
- The default entry, when the new entry replaces a default.
- What the entry describes, when that is a file, a section of a mirror, an issue or a page, so that the entry says what is true of it now.

## What it writes and the mode it needs

It writes the new entry, `lore/corpus/<file>.md`, and one new line in `lore/corpus/index.md`. The file is named after the term, in lower case, with each space replaced by a hyphen. Both files are in the Lore, so the session must be in Writing with a claim that covers the Lore.

## Steps

1. Settle the entry with the Human Lead before writing anything. The points to settle are: the term, written as it is written in prose; what it means in this Space; where the thing that it names is kept, which is the Lore, the Workbench, GitHub or the desk; which verbs and processes act on it; and what the entry points at. The meaning comes from the Human Lead. When the entry needs a detail that the Human Lead has not given, ask for it and do not fill it in.
2. Check the term against the three indexes. If an entry in `lore/corpus/core/` has the same file name, refuse, and tell the Human Lead what the core entry says. If an entry in `lore/corpus/default/` has the same file name, tell the Human Lead that the new entry will be used instead of that default, and go on only when that is what they want. In that case read the default entry and start from its text. If one of the Space's own entries already has the file name, stop: this verb only adds, and changing an existing own entry is an ordinary write with the Lore claimed.
3. Enter Writing with the Lore as the target, as the next section says.
4. Write `lore/corpus/<file>.md`. The frontmatter has the keys `type`, `term` and `points_at`, as `lore/corpus/core/card.md` describes them. `points_at` lists what the entry describes, so that a later review can tell which entries describe something that has changed or gone. When the entry describes nothing that has a path or a web address, the list is written `[]`. The prose says what the term means, where the thing is kept, and which verbs and processes act on it. The entries in `lore/corpus/core/` show the form.
5. Add the entry's line to `lore/corpus/index.md`, in the form `- [<file>.md](./<file>.md): one sentence.` The sentence says what the term is, so that a session that reads only the index knows whether to open the entry.
6. The AI engine runs the check of the contract lore-integrity after each write to the Lore. Until step 5 is done, the check reports that the index does not list the new entry. Fix every other failure, and every failure that remains after step 5, before leaving Writing.
7. Commit the new entry and the changed index in the Space repository, and push the commit, so that the other desks of the Space get the change.
8. If the session was in Read only when this verb was invoked, call the tool `leave_writing` to return to Read only. If the session was already in Writing, stay in Writing.
9. Tell the Human Lead the path of the new entry.

## Entering Writing

If the session already has a claim that covers the Lore, continue with step 4. If it does not, ask the companion for the claim:

1. Call the tool `request_writing`. Give `targets` with one target, the Lore, written `{ "kind": "lore" }`, and give `reason` with one sentence that says what will be written. The tool returns a ticket at once, and the companion shows the Human Lead the entering-Writing dialog.
2. Call the tool `await_answer` with the ticket. When it returns `{ "status": "pending" }`, the Human Lead has not answered yet, so call it again.
3. When the answer has `granted: true`, the session is in Writing and the companion has recorded the claim on the desk. When the answer has `granted: false`, its `reason` is `held` or `declined`. `held` means that another session holds the Lore, and `heldBy` names that session. `declined` means that the Human Lead said no. In both cases the session stays in Read only: tell the Human Lead what the answer was, and write nothing to the Lore.
4. After an answer with `granted: true`, read the column Writing of the Agents board again with `gh`. If an issue that was created earlier claims the same target, call the tool `leave_writing`, tell the Human Lead which session holds the target, and write nothing. If GitHub cannot be reached, other desks cannot be checked: say so and go on.

The tools belong to the local server that the companion runs for the session. In Claude Code their names begin with `mcp__ailore__`, as in `mcp__ailore__request_writing`. A session that does not have these tools was not started by the companion and cannot enter Writing. In that case say so and stop.

## Contracts

- write-guard, `lore/contracts/core/write-guard.md`. Before each write, its check refuses a write to the Lore from a session in Read only, and a write outside the claimed targets from a session in Writing.
- lore-integrity, `lore/contracts/core/lore-integrity.md`. Before a write, its check refuses a path under a `core/` or a `default/` folder. After a write, it checks that every file's frontmatter parses, that every reference resolves, and that every index lists exactly its children. Each path in `points_at` is such a reference, so it must name a file that exists.

## What it refuses

- A term whose file name a file in `lore/corpus/core/` has.
- An entry written under `lore/corpus/core/` or `lore/corpus/default/`.
- A path in `points_at` that names no existing file.
- A meaning that the Human Lead has not given or confirmed.
- Changing or removing an existing entry. There is no verb for that: with the Lore claimed, editing or deleting one of the Space's own entries is an ordinary write.
- Any write before the Human Lead has confirmed the claim on the Lore.

## Choices recorded here

The session that wrote this card on 2026-09-18 made the following choices. Each is open to the Human Lead's review.

- The product document says that this verb writes one new card with the frontmatter of its kind, that it needs Writing with the Lore as its target, and what an entry states. It does not give the steps. Steps 1, 2 and 9 are the smallest steps that follow from that.
- The product document says that the Lore is kept in git and is the same on every desk. It does not say which step commits a change to the Lore. Step 7 follows from that statement.
- The product document does not say whether a verb leaves Writing when it ends. Step 8 returns the session to the mode it was in before the verb.
- The product document has a session read the column Writing again after its claim. The architecture document of the first build leaves that reading out. Step 4 of the section "Entering Writing" follows the product document.
- The names of the tools, their arguments and their answers come from the architecture document of the first build, where they are a proposal that the Human Lead has not yet accepted.
