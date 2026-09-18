/**
 * `gate-answers.json`: what the Human Lead answered at each gate of a process.
 *
 * An answer is a record of what happened, so it is appended and never edited
 * or removed: this module has no function that changes or deletes one.
 */

import { randomUUID } from 'node:crypto';
import { type Result, ok } from '../result.js';
import type { Desk, DeskFailure } from './desk.js';
import { isGateAnswer } from './guards.js';
import { type DeskRecordFile, appendDeskRecord, readDeskRecords } from './store.js';
import type { GateAnswer, GateAnswerInput } from './types.js';

/** The record file of the gate answers. */
export const GATE_ANSWERS_FILE: DeskRecordFile<GateAnswer> = {
  name: 'gateAnswers',
  guard: isGateAnswer,
};

/** The gate answers of the session `sessionId`, oldest first; of every session when left out. */
export function listGateAnswers(desk: Desk, sessionId?: string): Result<GateAnswer[], DeskFailure> {
  const answers = readDeskRecords(desk, GATE_ANSWERS_FILE);
  if (!answers.ok || sessionId === undefined) return answers;
  return ok(answers.value.filter((answer) => answer.sessionId === sessionId));
}

/** Record an answer. The desk gives it an id and the time. */
export function recordGateAnswer(
  desk: Desk,
  input: GateAnswerInput,
): Result<GateAnswer, DeskFailure> {
  return appendDeskRecord(desk, GATE_ANSWERS_FILE, {
    id: randomUUID(),
    sessionId: input.sessionId,
    process: input.process,
    step: input.step,
    question: input.question,
    answer: input.answer,
    answeredAt: desk.now().toISOString(),
  });
}
