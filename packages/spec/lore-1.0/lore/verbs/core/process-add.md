---
type: verb
name: process-add
pillar: shaping
mode: writing
invoked_by:
  - human-lead
---

# process-add

This verb writes one new process card into the Lore. A process is a sequence of verbs and decisions. Its card names its steps in order, says which steps are gates, and says whether the process may run unattended. The new card is one of the Space's own files. It either adds a sequence that no default covers, or it has the name of a default process and is then used instead of that default.

## When it is invoked

The Human Lead invokes it when they want a new sequence of work in this Space, or when they want the Space's own version of one of the default processes specify, plan and work.

It is not the verb for a single action, which is written with verb-add. It is not the verb for a rule about what must never happen, which is written with contract-add.

## What it reads

- `lore/corpus/core/card.md`, for the frontmatter keys of a process and for how a card's file is named.
- `lore/corpus/core/frontmatter.md`, for how frontmatter is written.
- `lore/processes/index.md`, `lore/processes/core/index.md` and `lore/processes/default/index.md`, for the names that are already taken.
- `lore/verbs/index.md` and the two indexes below it, for the verbs that the steps can run.
- The default card, when the new process replaces a default.

## What it writes and the mode it needs

It writes the new card, `lore/processes/<name>.md`, and one new line in `lore/processes/index.md`. Both are in the Lore, so the session must be in Writing with a claim that covers the Lore.

## Steps

1. Settle the process with the Human Lead before writing anything. The points to settle are: its name, which is one word; the pillar it serves; its steps, by name and in the order in which they run; for each step, the verb it runs or what the session does in it; which steps are gates; and whether the process may run unattended. A gate is a step that needs the Human Lead's yes, and a step that is not a gate runs without asking. For each gate, settle the question that the Human Lead is asked. If the process reads or writes fields of the GitHub Project, settle which fields, because a process and the Project layout it uses are replaced together.
2. Check the name against the three indexes. If a file in `lore/processes/core/` has the name, refuse. If a file in `lore/processes/default/` has the name, tell the Human Lead that the new card will be used instead of that default, and go on only when that is what they want. In that case read the default card and start from its text. If one of the Space's own processes already has the name, stop: this verb only adds, and changing an existing own card is an ordinary write with the Lore claimed.
3. Check that every verb that a step runs has a card in `lore/verbs/`. If one is missing, tell the Human Lead. The missing verb is written with verb-add.
4. Enter Writing with the Lore as the target, as the next section says.
5. Write `lore/processes/<name>.md`. The frontmatter has the keys `type`, `name`, `pillar`, `steps`, `gates` and `unattended`, as `lore/corpus/core/card.md` describes them. Every item of `gates` is also an item of `steps`, and a process with no gate has `gates: []`. The prose describes each step under the name it has in `steps`. For a gate, the prose gives the question that the Human Lead is asked, and says that the session asks it by calling the tool `request_gate` and then the tool `await_answer`.
6. Add the process's line to `lore/processes/index.md`, in the form `- [<name>.md](./<name>.md): one sentence.` The companion uses this sentence as the description of the skill when it installs the process into the AI engine. The sentence therefore says when to run the process, and it can be understood without the rest of the index.
7. The AI engine runs the check of the contract lore-integrity after each write to the Lore. Until step 6 is done, the check reports that the index does not list the new card. Fix every other failure, and every failure that remains after step 6, before leaving Writing.
8. Commit the new card and the changed index in the Space repository, and push the commit, so that the other desks of the Space get the change.
9. If the session was in Read only when this verb was invoked, call the tool `leave_writing` to return to Read only. If the session was already in Writing, stay in Writing.
10. Tell the Human Lead the path of the new card, its gates, and whether it replaces a default.

## Entering Writing

If the session already has a claim that covers the Lore, continue with step 5. If it does not, ask the companion for the claim:

1. Call the tool `request_writing`. Give `targets` with one target, the Lore, written `{ "kind": "lore" }`, and give `reason` with one sentence that says what will be written. The tool returns a ticket at once, and the companion shows the Human Lead the entering-Writing dialog.
2. Call the tool `await_answer` with the ticket. When it returns `{ "status": "pending" }`, the Human Lead has not answered yet, so call it again.
3. When the answer has `granted: true`, the session is in Writing and the companion has recorded the claim on the desk. When the answer has `granted: false`, its `reason` is `held` or `declined`. `held` means that another session holds the Lore, and `heldBy` names that session. `declined` means that the Human Lead said no. In both cases the session stays in Read only: tell the Human Lead what the answer was, and write nothing to the Lore.
4. After an answer with `granted: true`, read the column Writing of the Agents board again with `gh`. If an issue that was created earlier claims the same target, call the tool `leave_writing`, tell the Human Lead which session holds the target, and write nothing. If GitHub cannot be reached, other desks cannot be checked: say so and go on.

The tools belong to the local server that the companion runs for the session. In Claude Code their names begin with `mcp__ailore__`, as in `mcp__ailore__request_writing`. A session that does not have these tools was not started by the companion and cannot enter Writing. In that case say so and stop.

## Contracts

- write-guard, `lore/contracts/core/write-guard.md`. Before each write, its check refuses a write to the Lore from a session in Read only, and a write outside the claimed targets from a session in Writing.
- lore-integrity, `lore/contracts/core/lore-integrity.md`. Before a write, its check refuses a path under a `core/` or a `default/` folder. After a write, it checks that every file's frontmatter parses, that every reference resolves, and that every index lists exactly its children.
- stage-gate, `lore/contracts/core/stage-gate.md`. Its rule is that moving a unit of work from one stage to the next is the Human Lead's explicit yes. A process that moves a stage therefore has a gate before the move.

## What it refuses

- A name that a file in `lore/processes/core/` has.
- A card written under `lore/processes/core/` or `lore/processes/default/`.
- A name of more than one word.
- A process in which a step moves a unit of work to its next stage and no gate comes before that step.
- Changing or removing an existing process. There is no verb for that: with the Lore claimed, editing or deleting one of the Space's own cards is an ordinary write.
- Any write before the Human Lead has confirmed the claim on the Lore.

## Choices recorded here

The session that wrote this card on 2026-09-18 made the following choices. Each is open to the Human Lead's review.

- The product document says that this verb writes one new card with the frontmatter of its kind, and that it needs Writing with the Lore as its target. It does not give the steps. Steps 1, 2, 3 and 10 are the smallest steps that follow from the rules for names, layers and gates.
- The refusal of a stage move with no gate before it follows from the rule of the contract stage-gate. The product document does not state it as a refusal of this verb.
- The product document says that the Lore is kept in git and is the same on every desk. It does not say which step commits a change to the Lore. Step 8 follows from that statement.
- The product document does not say whether a verb leaves Writing when it ends. Step 9 returns the session to the mode it was in before the verb.
- The product document has a session read the column Writing again after its claim. The architecture document of the first build leaves that reading out. Step 4 of the section "Entering Writing" follows the product document.
- The names of the tools, their arguments and their answers come from the architecture document of the first build, where they are a proposal that the Human Lead has not yet accepted.
