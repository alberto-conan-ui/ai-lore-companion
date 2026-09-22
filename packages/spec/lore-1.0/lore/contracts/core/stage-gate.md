---
type: contract
name: stage-gate
pillar: planning
target: plan
check: null
when: null
---

# stage-gate

This contract guards the pillar Planning. Its target is the plan: more exactly, whatever records the stage of a unit of work on the Space's plan on GitHub. What that is, and which unit of work carries it, is the Space's to say — this card does not name a field or a kind of issue, because a core card that describes a layout a Space may replace goes stale where no Space can correct it. This contract has only a rule. It has no check script, so nothing refuses a write that breaks it. A session treats it as advice that it can be asked to justify, and not as something that is enforced.

## The rule

Moving a unit of work from one stage to the next is the Human Lead's explicit yes. It is never a session's own decision.

### A stage move that records a fact

A stage whose entry condition is a fact anyone can check — every piece of work closed, say — is entered by recording that fact, not by deciding anything. The Human Lead may give the yes for such a move **once, in the Space's Lore, for every unit of work**, instead of one at a time. A Space that does so names the move and says what the fact is.

That is still this rule's explicit yes: given in advance, for a defined move, written where every session reads it. It is not a session deciding, because the session judges nothing beyond whether the fact holds.

This does not reach a move that lets the next stage's work begin, whatever a Space calls it. The reason is under "Why it is core": the Human Lead must not learn of such a move after the work it authorises has started. A standing yes for a move like that would be the Human Lead agreeing in advance to be told afterwards.

## What a session does

A process declares the steps that need the Human Lead's yes as its gates. When a session reaches a gate, it asks the Human Lead through the companion app and not in the conversation. The companion app shows the gate's dialog, the Human Lead answers it, and the companion app writes the answer to the desk's records and returns it to the session. The answer is yes, no or take over.

A session moves the stage of a unit of work only after a yes to the gate that comes before that move in the process it is running. After a no or a take over it does not move the stage. When the Human Lead asks for a stage move outside any process, that request is the explicit yes.

An unattended session that reaches a gate stops there until the Human Lead answers.

A yes that the Human Lead gives outside the companion app, for example in the conversation, is not written to the desk's records. It is a yes under this rule all the same, and the session can be asked to show where it was given.

## Why it has no check

The product document of AI-Lore 1.0 describes a check for this contract: when a session moves the stage, a script reads the desk's records for the Human Lead's yes to this move, and refuses the move without it. The check is possible because the companion app writes that record and a session cannot write it, although a session writes to GitHub as the Human Lead's own account. The first build of AI-Lore 1.0 records the gate answers on the desk and does not include the script, by the Human Lead's decision on the scope of the first build. Until the script exists, `check` and `when` are `null`.

## Why it is core

The gates are the places where the Human Lead decides whether a unit of work goes on. This matters most for unattended sessions, which work without the Human Lead watching. If a session could move a stage on its own decision, the Human Lead would learn of the move after the work of the next stage had started.

## Choices recorded here

The product document fixes the rule and the check that it describes. The session that wrote this card on 2026-09-18 made the following choices. Each is open to the Human Lead's review.

- The product document says that in an unattended session a refused move puts the session in Blocked. Unattended sessions and the Blocked state are outside the first build, so this card says only that an unattended session stops at a gate.
- The sentence about a stage move that the Human Lead asks for outside any process is this card's. The product document says that the Human Lead can ask a session for anything at any moment, and the rule asks for the Human Lead's explicit yes, which such a request is.
- The last sentence under "Why it is core" is this card's wording of the product document's reason, which is that the gates are where the Human Lead stays in charge of unattended work.
