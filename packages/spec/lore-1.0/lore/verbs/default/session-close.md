---
type: verb
name: session-close
pillar: working
mode: read-only
invoked_by:
  - human-lead
  - ai-session
---

# session-close

This verb is what a session does last. It writes the session's journal entry in the Workbench. The entry ends with the handover: what was done, what is in progress, and what the next session should do. The next session reads that handover when it orients, so the Human Lead does not have to explain the work again. If the session has an issue on the Agents board, the handover is also written there, the session's write targets are released, and the issue moves to Done.

## When it is invoked

The Human Lead invokes it to close the session. The session also runs it on itself when the Human Lead tells it to stop.

Every session closes with this verb, whatever it did, including a session that never entered Writing.

## What it reads

- The conversation and the work of this session: what was asked, what was done, what was decided, what is unfinished.
- The state of each claimed target, when the session is in Writing: for a repository, the branch and whether it has changes that are not committed.
- `workbench/journal/`, for the names of the entries that exist.
- The Agents board, read with `gh`, for the session's issue, when the session has entered Writing at any time.

## What it writes and the mode it needs

It writes one new file in `workbench/journal/`. When the session has an issue, it also writes one comment on that issue on GitHub and moves the issue to Done. The Workbench is always writable, and a session in Read only may update the GitHub Project, so the verb runs in Read only. It does not ask for Writing.

When the session is in Writing, the verb ends Writing by calling the tool `leave_writing`.

## Steps

1. When the session is in Writing and the Lore is one of its targets, look at the last report of the check of lore-integrity. If it reported a failure that is not yet fixed, fix it now, before leaving Writing.
2. Write the journal entry as one new file in `workbench/journal/`. Read the notes that the session kept in `workbench/scratch/`, when it kept any, and write the entry complete, in one write. The file's name has four parts with hyphens between them, and ends in `.md`: the date, the time as four digits, two or three words that say what the session was about, and the session's id. An example is `2026-09-18-1430-verb-cards-<session id>.md`. The date and the time come first so that the names sort in the order in which the entries were written. The id comes last because the check of the contract journal-append-forward knows the entry of the current session by the end of its file's name: it allows this session to write that file again, and it refuses a write to every other entry that exists. The session's id is the id that the companion gave the session. The companion's answer to `request_writing` holds the session's claims, and each claim names the id. A session that does not know its id, because it never entered Writing or because the companion did not start it, leaves the id and its hyphen out of the name. The check then allows the first write of the file and no later one. The entry says:
   - which unit of work or item the session was on, with its address on GitHub, or that it was on none;
   - what the session did;
   - what it learned that a later session needs;
   - a correction to an earlier entry, when one is needed. An earlier entry is never changed.
3. End the entry with the handover, under a heading of its own. The handover has three parts:
   - what was done;
   - what is in progress: work that is started and not finished, where it is, and which changes are not committed;
   - what the next session should do, in the order in which to do it.
4. When the session has an issue on the Agents board, write the handover as a comment on that issue with `gh`, so that a colleague on another desk sees it. If GitHub cannot be reached, the comment is not written and nothing queues it. Say so to the Human Lead.
5. When the session is in Writing, call the tool `leave_writing`. It takes no arguments. The companion releases the session's write targets and returns the session to Read only. A session cannot release its targets in another way, because the claims are in the desk's records, which only the companion writes. In Claude Code the tool's name is `mcp__ailore__leave_writing`.
6. When the session has an issue on the Agents board, move it to the column Done with `gh`. If GitHub cannot be reached, say so to the Human Lead.
7. Tell the Human Lead the path of the journal entry, and repeat the third part of the handover. The session then writes nothing more.

## Contracts

- journal-append-forward, `lore/contracts/core/journal-append-forward.md`. Its check refuses a write to a journal entry of an earlier session. Its rule is that a correction to a past entry is recorded in the current session's entry.
- write-guard, `lore/contracts/core/write-guard.md`. Its check allows every write under `workbench/`.
- lore-integrity, `lore/contracts/core/lore-integrity.md`. A failure that its check reported is fixed before the session leaves Writing.

## What it refuses

- Changing or removing a journal entry of an earlier session.
- Closing without a handover.
- A handover that states as done something that is not done. What is unfinished is written under what is in progress.
- Any write to the Lore or to a payload as part of closing, other than the fix of step 1.
- Reviewing a mirror. Mirrors are not reviewed at close. A mirror is reviewed after the work is merged, with the verb mirror-review.

## Choices recorded here

The session that wrote this card on 2026-09-18 made the following choices. Each is open to the Human Lead's review.

- The product document says that this verb writes the handover as the last comment on the session's issue, moves the issue to Done and releases the write targets. The architecture document of the first build has the companion do all three when the session closes, and does not say where the companion gets the text of the handover. This card follows the product document: the verb writes the comment and moves the issue to Done. It releases the targets by calling `leave_writing`, because the claims are in the desk's records and only the companion writes them. The Human Lead is asked to settle which of the two writes the comment and moves the issue, so that neither is done twice.
- The product document says that a session journals in the Workbench while it works, and that a session adds one journal entry when it closes. This card writes the entry once, at close. Keeping notes in `workbench/scratch/` until then is this card's.
- The product document does not say how a journal entry's file is named. The name in step 2 is this card's: the date, the time, a few words and the session's id. The id is at the end because the check script of journal-append-forward, as it was written for the first build, allows a second write to an entry only when the file's name ends with a hyphen, the id of the current session and `.md`.
- The architecture document of the first build gives one place where a session is told its id: the claims in the answer to `request_writing`, which is a proposal there that the Human Lead has not yet accepted. It names no way for a session that stays in Read only to learn its id. Such a session leaves the id out of the name, and its entry can then be written once. The Human Lead is asked whether the companion tells every session its id when it starts it.
- What the entry and the handover say in detail, beyond the three parts that the product document names, is this card's.
- The name of the tool `leave_writing` comes from the architecture document of the first build, where it is a proposal that the Human Lead has not yet accepted.
