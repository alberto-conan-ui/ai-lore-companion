---
type: verb
name: verb-add
pillar: shaping
mode: writing
invoked_by:
  - human-lead
---

# verb-add

This verb writes one new verb card into the Lore. A verb is one action that the AI Agent performs when asked. The new card is one of the Space's own files. It either adds an action that no default covers, or it has the name of a default verb and is then used instead of that default.

## When it is invoked

The Human Lead invokes it when they want the AI Agent to be able to perform a new action on request in this Space, or when they want the Space's own version of a default verb.

It is not the verb for a sequence of steps with gates, which is written with process-add. It is not the verb for a rule about what must never happen, which is written with contract-add. It is not the verb for the meaning of a word, which is written with corpus-add.

## What it reads

- `lore/corpus/core/card.md`, for the frontmatter keys of a verb and for how a card's file is named.
- `lore/corpus/core/frontmatter.md`, for how frontmatter is written.
- `lore/verbs/index.md`, `lore/verbs/core/index.md` and `lore/verbs/default/index.md`, for the names that are already taken.
- The default card, when the new verb replaces a default.

## What it writes and the mode it needs

It writes the new card, `lore/verbs/<name>.md`, and one new line in `lore/verbs/index.md`. Both are in the Lore, so the session must be in Writing with a claim that covers the Lore.

## Steps

1. Settle the verb with the Human Lead before writing anything. The points to settle are: its name; the pillar it serves; when it is invoked and what invokes it; what it reads; what it writes; the steps a session follows; and what it refuses. The name is hyphenated, with the object first and the action second, as in spec-draft. The mode follows from what the verb writes: a verb that writes to the Lore or to a payload needs `writing`, and a verb that writes only to the Workbench or to the GitHub Project needs `read-only`.
2. Check the name against the three indexes. If a file in `lore/verbs/core/` has the name, refuse. If a file in `lore/verbs/default/` has the name, tell the Human Lead that the new card will be used instead of that default, and go on only when that is what they want. In that case read the default card and start from its text. If one of the Space's own verbs already has the name, stop: this verb only adds, and changing an existing own card is an ordinary write with the Lore claimed.
3. Enter Writing with the Lore as the target, as the next section says.
4. Write `lore/verbs/<name>.md`. The frontmatter has the keys `type`, `name`, `pillar`, `mode` and `invoked_by`, as `lore/corpus/core/card.md` describes them. The prose says when the verb is invoked, what it reads, what it writes and in which mode, the steps, the contracts that apply, and what it refuses. If the verb writes to the Lore or to a payload, its prose says that the session must be in Writing with a claim that covers the target, and names the tool `request_writing`.
5. Add the verb's line to `lore/verbs/index.md`, in the form `- [<name>.md](./<name>.md): one sentence.` The companion uses this sentence as the description of the skill when it installs the verb into the AI engine. The sentence therefore says when to use the verb, and it can be understood without the rest of the index.
6. The AI engine runs the check of the contract lore-integrity after each write to the Lore. Until step 5 is done, the check reports that the index does not list the new card. Fix every other failure, and every failure that remains after step 5, before leaving Writing.
7. Commit the new card and the changed index in the Space repository, and push the commit, so that the other desks of the Space get the change.
8. If the session was in Read only when this verb was invoked, call the tool `leave_writing` to return to Read only. If the session was already in Writing, stay in Writing.
9. Tell the Human Lead the path of the new card, and whether it replaces a default.

## Entering Writing

If the session already has a claim that covers the Lore, continue with step 4. If it does not, ask the companion for the claim:

1. Call the tool `request_writing`. Give `targets` with one target, the Lore, written `{ "kind": "lore" }`, and give `reason` with one sentence that says what will be written. The tool returns a ticket at once, and the companion shows the Human Lead the entering-Writing dialog.
2. Call the tool `await_answer` with the ticket. When it returns `{ "status": "pending" }`, the Human Lead has not answered yet, so call it again.
3. When the answer has `granted: true`, the session is in Writing and the companion has recorded the claim on the desk. When the answer has `granted: false`, its `reason` is `held` or `declined`. `held` means that another session holds the Lore, and `heldBy` names that session. `declined` means that the Human Lead said no. In both cases the session stays in Read only: tell the Human Lead what the answer was, and write nothing to the Lore.
4. After an answer with `granted: true`, read the column Writing of the Agents board again with `gh`. If an issue that was created earlier claims the same target, call the tool `leave_writing`, tell the Human Lead which session holds the target, and write nothing. If GitHub cannot be reached, other desks cannot be checked: say so and go on.

The tools belong to the local server that the companion runs for the session. In Claude Code their names begin with `mcp__ailore__`, as in `mcp__ailore__request_writing`. A session that does not have these tools was not started by the companion and cannot enter Writing. In that case say so and stop.

## Contracts

- write-guard, `lore/contracts/core/write-guard.md`. Before each write, its check refuses a write to the Lore from a session in Read only, and a write outside the claimed targets from a session in Writing.
- lore-integrity, `lore/contracts/core/lore-integrity.md`. Before a write, its check refuses a path under a `core/` or a `default/` folder. After a write, it checks that every file's frontmatter parses, that every reference resolves, and that every index lists exactly its children.

## What it refuses

- A name that a file in `lore/verbs/core/` has.
- A card written under `lore/verbs/core/` or `lore/verbs/default/`.
- A name that is not hyphenated.
- Changing or removing an existing verb. There is no verb for that: with the Lore claimed, editing or deleting one of the Space's own cards is an ordinary write.
- Any write before the Human Lead has confirmed the claim on the Lore.

## Choices recorded here

The session that wrote this card on 2026-09-18 made the following choices. Each is open to the Human Lead's review.

- The product document says that this verb writes one new card with the frontmatter of its kind, and that it needs Writing with the Lore as its target. It does not give the steps. Steps 1, 2 and 9 are the smallest steps that follow from the rules for names and layers.
- The product document says that the Lore is kept in git and is the same on every desk. It does not say which step commits a change to the Lore. Step 7 follows from that statement.
- The product document does not say whether a verb leaves Writing when it ends. Step 8 returns the session to the mode it was in before the verb.
- The product document has a session read the column Writing again after its claim. The architecture document of the first build leaves that reading out. Step 4 of the section "Entering Writing" follows the product document.
- The names of the tools, their arguments and their answers come from the architecture document of the first build, where they are a proposal that the Human Lead has not yet accepted.
