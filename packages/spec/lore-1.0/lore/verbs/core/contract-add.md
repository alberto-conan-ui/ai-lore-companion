---
type: verb
name: contract-add
pillar: shaping
mode: writing
invoked_by:
  - human-lead
---

# contract-add

This verb writes one new contract card into the Lore, and its check script when the contract has one. A contract says what must never happen when a session writes. It names its target and has two halves. The check is a script that the AI engine runs before or after a write to the target. The rule is the prose for what no script can cover. A contract may have only a rule, and then its card says so.

## When it is invoked

The Human Lead invokes it when the Space has learned something that must never happen here: for example a kind of file that must never be written to a repository, or a condition that every write to a payload must meet.

It is not the verb for an action, which is written with verb-add. It is not the verb for a sequence of steps, which is written with process-add. A contract says what must hold, and not how to act.

## What it reads

- `lore/corpus/core/card.md`, for the frontmatter keys of a contract, for how a card's file is named, and for where a check script is kept.
- `lore/corpus/core/frontmatter.md`, for how frontmatter is written.
- `lore/contracts/index.md` and `lore/contracts/core/index.md`, for the names that are already taken.
- `lore/space.md`, when the contract guards one payload, for that payload's name.
- The core contract cards that have a check, for the command line that the AI engine gives a check script and for how a script allows or refuses a write.

## What it writes and the mode it needs

It writes the new card, `lore/contracts/<name>.md`. When the contract has a check it also writes the script, `lore/contracts/<name>.py`. It adds one line to `lore/contracts/index.md` for each of the two files. All of these are in the Lore, so the session must be in Writing with a claim that covers the Lore.

## Steps

1. Settle the contract with the Human Lead before writing anything. The points to settle are: its name, which is hyphenated; the pillar it guards; its target, which is one of `everything`, `lore`, `journal`, `plan` and `payload`; the one payload it guards, when the target is `payload` and the contract is not for every payload; the rule, as a sentence that a reader can test a write against; and whether a script can check the rule. When a script can check it, settle whether the check runs before the write, after it, or both.
2. Check the name against the two indexes. If a file in `lore/contracts/core/` has the name, refuse. If one of the Space's own contracts already has the name, stop: this verb only adds, and changing an existing own card is an ordinary write with the Lore claimed.
3. Read the core contracts and tell the Human Lead if the new rule contradicts one of them. A core contract cannot be replaced, so a contradiction is settled by changing the new rule.
4. Enter Writing with the Lore as the target, as the next section says.
5. When the contract has a check, write the script first, as `lore/contracts/<name>.py`, in the same folder as the card. The script is written before the card because the card names it, and lore-integrity checks after each write that every reference resolves. The script is Python 3 and imports only the standard library. It takes the same command line as the check scripts of the core contracts, and it allows or refuses a write in the same way as they do.
6. Write `lore/contracts/<name>.md`. The frontmatter has the keys `type`, `name`, `pillar`, `target`, `check` and `when`, and the key `payload` when the contract guards one payload, as `lore/corpus/core/card.md` describes them. The key `check` holds the script's path, written relative to the Space's folder. A contract that has only a rule has `check: null` and `when: null`. The prose states the rule, says what the check does when there is one, and says why the contract exists. A contract that has only a rule says so in its prose.
7. Add one line to `lore/contracts/index.md` for the card, and one line for the script when there is one. Each line has the form `- [<file>](./<file>): one sentence.`
8. The AI engine runs the check of the contract lore-integrity after each write to the Lore. Until step 7 is done, the check reports that the index does not list the new files. Fix every other failure, and every failure that remains after step 7, before leaving Writing.
9. Commit the new files and the changed index in the Space repository, and push the commit, so that the other desks of the Space get the change.
10. If the session was in Read only when this verb was invoked, call the tool `leave_writing` to return to Read only. If the session was already in Writing, stay in Writing.
11. Tell the Human Lead the path of the new card, and whether the contract has a check or only a rule. The companion installs a check into the AI engine as a hook. A contract that has only a rule is not enforced, and a session treats it as advice that it can be asked to justify.

## Entering Writing

If the session already has a claim that covers the Lore, continue with step 5. If it does not, ask the companion for the claim:

1. Call the tool `request_writing`. Give `targets` with one target, the Lore, written `{ "kind": "lore" }`, and give `reason` with one sentence that says what will be written. The tool returns a ticket at once, and the companion shows the Human Lead the entering-Writing dialog.
2. Call the tool `await_answer` with the ticket. When it returns `{ "status": "pending" }`, the Human Lead has not answered yet, so call it again.
3. When the answer has `granted: true`, the session is in Writing and the companion has recorded the claim on the desk. When the answer has `granted: false`, its `reason` is `held` or `declined`. `held` means that another session holds the Lore, and `heldBy` names that session. `declined` means that the Human Lead said no. In both cases the session stays in Read only: tell the Human Lead what the answer was, and write nothing to the Lore.
4. After an answer with `granted: true`, read the column Writing of the Agents board again with `gh`. If an issue that was created earlier claims the same target, call the tool `leave_writing`, tell the Human Lead which session holds the target, and write nothing. If GitHub cannot be reached, other desks cannot be checked: say so and go on.

The tools belong to the local server that the companion runs for the session. In Claude Code their names begin with `mcp__ailore__`, as in `mcp__ailore__request_writing`. A session that does not have these tools was not started by the companion and cannot enter Writing. In that case say so and stop.

## Contracts

- write-guard, `lore/contracts/core/write-guard.md`. Before each write, its check refuses a write to the Lore from a session in Read only, and a write outside the claimed targets from a session in Writing.
- lore-integrity, `lore/contracts/core/lore-integrity.md`. Before a write, its check refuses a path under a `core/` or a `default/` folder. After a write, it checks that every file's frontmatter parses, that every reference resolves, and that every index lists exactly its children. The key `check` of the new card is such a reference, so the script must exist when the card names it.

## What it refuses

- A name that a file in `lore/contracts/core/` has.
- A card or a script written under `lore/contracts/core/`.
- A contract that says how to act and not what must hold. That is a verb or a process.
- A card that names a check script that does not exist.
- A card that has only a rule and does not say so.
- Changing or removing an existing contract. There is no verb for that: with the Lore claimed, editing or deleting one of the Space's own cards is an ordinary write.
- Any write before the Human Lead has confirmed the claim on the Lore.

## Choices recorded here

The session that wrote this card on 2026-09-18 made the following choices. Each is open to the Human Lead's review.

- The product document says that this verb writes one new card with the frontmatter of its kind, and that it needs Writing with the Lore as its target. It does not give the steps. Steps 1, 2, 3 and 11 are the smallest steps that follow from what it says about contracts and layers.
- This card does not repeat the command line of a check script. It points at the core contract cards, which state it.
- The product document says that the Lore is kept in git and is the same on every desk. It does not say which step commits a change to the Lore. Step 9 follows from that statement.
- The product document does not say whether a verb leaves Writing when it ends. Step 10 returns the session to the mode it was in before the verb.
- The product document has a session read the column Writing again after its claim. The architecture document of the first build leaves that reading out. Step 4 of the section "Entering Writing" follows the product document.
- The names of the tools, their arguments and their answers come from the architecture document of the first build, where they are a proposal that the Human Lead has not yet accepted.
