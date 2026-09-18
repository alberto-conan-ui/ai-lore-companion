---
type: corpus
term: Agents board
points_at: []
---

# Agents board

## What it means

The Agents board is where the sessions of a Space coordinate. It has one issue per session that writes. A session creates its issue when it first enters Writing, in the same step as its claim. A session that only reads has no issue. The Human Lead sees on the board every session that writes, on every desk of the Space.

The board has four columns:

- **Read only.** A session that has written and gone back to reading. A session here may not change any payload or the Lore.
- **Writing.** When a session is about to write, its issue is placed here and names its [write targets](./write-target.md). The session then reads the column again. If another issue already claims the same target and was created earlier, the session returns to Read only and says so.
- **Blocked.** An unattended session that has stopped at a gate, keeps its targets, and waits for the Human Lead's answer.
- **Done.** The session has finished.

The same session can move from Read only to Writing and back more than once, and can change its write targets while in Writing, as long as it never holds a target that another session holds. The history of these moves is kept on the issue, so the issues of the board are the record of who wrote what, and when.

A session issue that stays in Writing or Blocked without activity for a long time is shown as stale on the board. Its targets are never released automatically. Taking them over is the Human Lead's decision, recorded on the issue.

## Where it is kept

The Agents board is on GitHub. The session issues are issues of the Space repository, and the board is a view of the Space's GitHub Project that shows the session issues by column. Which fields a session issue has is part of the Project layout, which the Lore of the Space describes.

## What acts on it

A session's issue is placed in Writing when the Human Lead confirms its claim, and it is created then if the session has none. The companion does this, after it has recorded the claim on the desk, and it moves the issue to Read only when the session leaves Writing. With the default set, the verb session-orient reads the board for the sessions in Writing or Blocked and their targets, and the verb session-close writes the handover as the last comment on the session's issue, asks the companion to release the session's write targets, and moves the issue to Done.

## Choices recorded here

- The product document of AI-Lore 1.0 proposes that the Agents board is a view of the Space's own Project and not a second Project, and leaves the point open. The focus of the first build says that the sessions that write appear on the Space's Project. This entry follows both.
- The product document says in one place that a session creates its issue, and in another that the issue is created when the Human Lead confirms the dialog. The architecture document of the first build has the companion create and move the issue. This entry follows the architecture document on that point.
- The product document has the session read the column Writing again after its claim. The architecture document of the first build leaves that reading out. This entry follows the product document.
- The product document leaves open how long an issue is without activity before it is shown as stale, so this entry gives no length of time.
