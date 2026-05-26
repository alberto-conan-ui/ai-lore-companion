---
name: ai-lore-close-session
description: Session close — write the journal, handover, status, and surface any drift
---

# close-session

`close-session` is the **session-closing bookend.** It leaves the session in a state the next session can pick up from. The session runs `close-session` on itself at the end of every session; the Human Lead does not invoke it.

## What close-session leaves behind

- **A journal entry for this session.** `journal/live/YYYY-MM-DD_NN.md`, with frontmatter (`date`, `session`, `focus`, `dials`, `posture`), a body covering the work done, and a **handover** section last — where the work stands, what the next session does first, what to watch.
- **An updated status.** `status/status.index.md` reflects the active focus, the posture, the relevant journal reference, and the next step.
- **An honest drift signal.** `git status` re-checked on both repos at the right paths (`git -C <lore>/memory status` and `git -C <project> status`). If either is dirty, the unacknowledged changes are named — the Human Lead can [`ack`](./ack.md), [`save-point`](./save-point.md), or close the session knowing work is uncommitted. The session does not self-ack.

Every Memory write goes through [`write-lore`](./write-lore.md). If insights from this session are immediately clear and well-placed, the session may also write them into the knowledge tree; if not, the journal carries them and they are placed deliberately later. Links in new files are verified to resolve.

An engine binding may reinforce `close-session` with a SessionEnd hook so a session cannot close without it; the methodology does not depend on the reinforcement.
