---
type: index
---

# Verbs: default

The verbs that ship with AI-Lore. These files are not edited in place, and an upgrade of AI-Lore replaces them as a whole. To change one, write a file with the same name in the folder above this one, and add its line to that folder's index. The Space's file is then used instead of the default.

- [spec-draft.md](./spec-draft.md): use when the Human Lead wants to start or continue writing a spec, a document that says what is wanted before it is built; it writes only the draft in the Workbench, so it runs in Read only.
- [spec-agree.md](./spec-agree.md): use in the process specify, after the Human Lead has declared a draft spec agreed and named its publish area; it publishes the spec there, removes the draft from the Workbench and links the spec from its unit of work, and needs Writing with the publish area claimed.
- [plan-break-down.md](./plan-break-down.md): use when a unit of work on the Space's GitHub Project needs its breakdown made or changed; it proposes the pieces of work with acceptance criteria drawn from the agreed spec, and writes them to GitHub after the Human Lead has confirmed the list, in Read only.
- [session-orient.md](./session-orient.md): use at the start of every AI session in this Space, run by the session on itself; it reads the Lore's indexes, the contracts, the mirrors, the plan, the Agents board and the last handover, writes nothing, and states where the work stands.
- [session-close.md](./session-close.md): use when the Human Lead closes the AI session or tells it to stop; it writes the session's journal entry in the Workbench, ending with the handover for the next session, writes the handover on the session's issue on the Agents board, leaves Writing so that its write targets are released, and moves the issue to Done.
- [work-report.md](./work-report.md): use when a piece of work is to be reported against its acceptance criteria, in the process work or when the Human Lead asks; it states each criterion as met with evidence, not met, or changed with a reason, and writes the report to GitHub, in Read only.
- [mirror-review.md](./mirror-review.md): use when the Human Lead asks for a mirror that is out of date to be reviewed, after the work on its payload is merged; it generates the payload's skeleton again, proposes changes to the mirror's prose for the Human Lead to confirm, and writes the mirror, and needs Writing with the Lore claimed.
