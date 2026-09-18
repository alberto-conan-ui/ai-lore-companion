/**
 * The dialog broker of one Space: tickets, the requests that wait for the
 * Human Lead, and their answers. Phase M4.3.
 *
 * The broker has two sides, and they are two different objects.
 *
 * - The session side is `broker.forSession(sessionId)`. Its methods take no
 *   session id, so whoever holds it can act for that one session only. It can
 *   ask for a dialog, wait for the answer to a ticket it owns, and leave
 *   Writing. It cannot answer a ticket, and a ticket of another session reads
 *   as a ticket that does not exist.
 * - The companion side is the rest of `DialogBroker`. The dialogs of phase
 *   M4.5 attach to it: `subscribe` tells them of a new request, `pending` and
 *   `describeWriting` give them what to show, and `answerWriting`,
 *   `answerGate` and `cancel` take the Human Lead's answer. A headless test
 *   calls the same methods in place of a dialog.
 *
 * The broker is the only writer of the desk on these paths. A confirmed
 * request to enter Writing is applied with `enterWriting` before the answer is
 * released, so a session that reads "granted" is already allowed by the
 * write-guard. A declined or refused request writes nothing. A gate's answer
 * is written with `recordGateAnswer` before it is released. Leaving Writing
 * reads the present commit of each held root first and passes them to core's
 * `leaveWriting`, which writes the mode, then one session close per root, then
 * releases the claims.
 *
 * The broker knows nothing about MCP or HTTP. `tools.ts` is the adapter.
 */

import { randomBytes } from 'node:crypto';
import {
  type Claim,
  type ClaimablePayloads,
  type ClaimableTarget,
  type Desk,
  type DeskFailure,
  type Failure,
  type GateAnswer,
  type RequestedTarget,
  type Result,
  type SessionCloseCommit,
  type SessionRecord,
  type WriteTarget,
  type WritingRefusal,
  decideWritingRequest,
  describeWriteTarget,
  enterWriting,
  fail,
  getSession,
  leaveWriting,
  listClaimableTargets,
  listClaims,
  listSessions,
  ok,
  recordGateAnswer,
} from '@ai-lore-companion/core';
import type { SpaceLog } from '../log.js';
import {
  ANSWERED_TICKET_TTL_MS,
  MAX_DIALOG_REQUESTS_PER_WINDOW,
  MAX_PENDING_TICKETS_PER_SESSION,
  MAX_TARGETS_PER_REQUEST,
  MAX_TEXT_LENGTH,
  MAX_TICKETS_PER_SESSION,
  MAX_WAITERS_PER_SESSION,
  PENDING_TICKET_TTL_MS,
  RATE_WINDOW_MS,
} from './constants.js';
import { createRateLimit } from './rate-limit.js';

/** Why a ticket ended without the Human Lead's answer. */
export type CancelReason = 'companion-closed' | 'session-ended' | 'expired' | 'dismissed';

/** What a session asks for with `request_writing`. */
export type WritingRequestInput = {
  targets: readonly RequestedTarget[];
  item?: number;
  reason: string;
};

/** What a session asks for with `request_gate`. */
export type GateRequestInput = {
  process: string;
  step: string;
  question: string;
  bearsOn?: string;
};

/** A request that waits for the Human Lead: what a dialog shows. */
export type DialogRequest =
  | ({ kind: 'writing'; ticket: string; sessionId: string; askedAt: string } & WritingRequestInput)
  | ({ kind: 'gate'; ticket: string; sessionId: string; askedAt: string } & GateRequestInput);

/** The answer to a request to enter Writing, as the session reads it. */
export type WritingAnswer =
  | { status: 'answered'; granted: true; claims: Claim[] }
  | {
      status: 'answered';
      granted: false;
      /** `held`: another session holds a target. `declined`: the Human Lead said no. `refused`: the claim rules refused it. `failed`: the desk could not be written. */
      reason: 'held' | 'declined' | 'refused' | 'failed';
      /**
       * For `held`: words that name the holding session for the Human Lead (its
       * engine, its item, when it started). Never the holder's session id: a
       * session is told nothing that addresses another session.
       */
      heldBy?: string;
      message: string;
    }
  | { status: 'cancelled'; granted: false; reason: CancelReason; message: string };

/** The answer to a gate, as the session reads it: the record the companion wrote, or a cancellation. */
export type GateTicketAnswer =
  | ({ status: 'answered' } & GateAnswer)
  | { status: 'cancelled'; reason: CancelReason; message: string };

export type TicketAnswer = WritingAnswer | GateTicketAnswer;

/** What `await_answer` gives. */
export type AwaitedAnswer = { status: 'pending' } | TicketAnswer;

export type BrokerFailureKind =
  | 'unknown-ticket'
  | 'already-answered'
  | 'wrong-kind'
  | 'invalid-request'
  | 'refused'
  | 'session-unknown'
  | 'rate-limited'
  | 'too-many-tickets'
  | 'desk-failed'
  | 'closed';

export type BrokerFailure = Failure<BrokerFailureKind>;

/** The session side: everything one session may do, and nothing for another session. */
export type SessionPort = {
  requestWriting(input: WritingRequestInput): Result<{ ticket: string }, BrokerFailure>;
  requestGate(input: GateRequestInput): Result<{ ticket: string }, BrokerFailure>;
  /** The answer, or pending after at most `waitMs`. `signal` ends the wait when the caller went away. */
  awaitAnswer(
    ticket: string,
    options: { waitMs: number; signal?: AbortSignal },
  ): Promise<Result<AwaitedAnswer, BrokerFailure>>;
  leaveWriting(): Promise<Result<WritingLeftAnswer, BrokerFailure>>;
};

/** What leaving Writing answers. */
export type WritingLeftAnswer = { mode: 'read-only'; released: WriteTarget[] };

/** What the broker tells its subscribers. */
export type BrokerEvent =
  | { kind: 'requested'; request: DialogRequest }
  | { kind: 'settled'; request: DialogRequest; answer: TicketAnswer }
  | { kind: 'left-writing'; sessionId: string; released: WriteTarget[] };

/**
 * The Human Lead's answer in the entering-Writing dialog. `targets`, when given,
 * is what the Human Lead confirmed: some or all of the requested targets, each
 * named as the request named it, a repository on the requested branch or on
 * another. A target the session did not ask for is not accepted.
 */
export type WritingDecision =
  | { confirm: true; targets?: readonly RequestedTarget[] }
  | { confirm: false };

/** What the entering-Writing dialog shows for a ticket, read from the desk now. */
export type WritingDialogView = {
  request: Extract<DialogRequest, { kind: 'writing' }>;
  /** Every target of the Space and who holds it. */
  claimable: ClaimableTarget[];
  /** Why the request as asked would be refused now, or `null` when it would be granted. */
  refusal: WritingRefusal | null;
};

export type DialogBroker = {
  forSession(sessionId: string): SessionPort;
  /** The requests that wait for an answer, oldest first. The Dashboard's Needs you reads it. */
  pending(): DialogRequest[];
  describeWriting(ticket: string): Result<WritingDialogView, BrokerFailure>;
  subscribe(listener: (event: BrokerEvent) => void): () => void;
  /** Apply the Human Lead's answer to a request to enter Writing. The value is what the session will read. */
  answerWriting(ticket: string, decision: WritingDecision): Result<WritingAnswer, BrokerFailure>;
  /** Record the Human Lead's answer to a gate. When the desk cannot be written the ticket stays pending. */
  answerGate(ticket: string, answer: GateAnswer['answer']): Result<GateAnswer, BrokerFailure>;
  /** End a pending ticket without an answer. */
  cancel(ticket: string, reason?: CancelReason): Result<void, BrokerFailure>;
  /** Return a session to Read only: the header's Leave Writing action. The same step as the tool `leave_writing`. */
  leaveWriting(sessionId: string): Promise<Result<WritingLeftAnswer, BrokerFailure>>;
  /** The session ended: its pending tickets are cancelled and its tickets are forgotten. */
  sessionEnded(sessionId: string): void;
  /** Cancel every pending ticket as `companion-closed`. Every later request is refused. */
  close(): void;
};

export type DialogBrokerOptions = {
  /** The Space's desk. A failure refuses the request. */
  desk: () => Result<Desk, DeskFailure>;
  /** The payloads a claim may name, from the manifest as it is now. */
  manifest: () => ClaimablePayloads;
  /**
   * The present commit of each root the session holds, read before the session
   * leaves Writing (core's `readSessionCloseCommits`). The desk records one
   * session close for each. Without it no session close is recorded.
   */
  closeCommits?: (desk: Desk, sessionId: string) => Promise<SessionCloseCommit[]>;
  log: SpaceLog;
  now?: () => number;
  limits?: Partial<BrokerLimits>;
};

export type BrokerLimits = {
  pendingTicketTtlMs: number;
  answeredTicketTtlMs: number;
  maxPendingPerSession: number;
  maxTicketsPerSession: number;
  maxWaitersPerSession: number;
  maxDialogRequestsPerWindow: number;
  rateWindowMs: number;
};

const DEFAULT_LIMITS: BrokerLimits = {
  pendingTicketTtlMs: PENDING_TICKET_TTL_MS,
  answeredTicketTtlMs: ANSWERED_TICKET_TTL_MS,
  maxPendingPerSession: MAX_PENDING_TICKETS_PER_SESSION,
  maxTicketsPerSession: MAX_TICKETS_PER_SESSION,
  maxWaitersPerSession: MAX_WAITERS_PER_SESSION,
  maxDialogRequestsPerWindow: MAX_DIALOG_REQUESTS_PER_WINDOW,
  rateWindowMs: RATE_WINDOW_MS,
};

const CANCEL_MESSAGES: Record<CancelReason, string> = {
  'companion-closed':
    'The companion closed the Space before the Human Lead answered. The companion is gone: nothing was granted or recorded, and the session stays in the mode it had.',
  'session-ended': 'The session ended before the Human Lead answered.',
  expired: 'The request waited too long without an answer and was cancelled. Ask again.',
  dismissed: 'The request was dismissed without an answer.',
};

type Ticket = {
  request: DialogRequest;
  createdAt: number;
  answer: TicketAnswer | null;
  settledAt: number | null;
  /** Wake the `await_answer` calls that wait on this ticket. */
  waiters: Set<() => void>;
};

/** The part of a ticket's id that a log line carries. */
function shortTicket(ticket: string): string {
  return ticket.slice(0, 8);
}

function isText(value: unknown, allowEmpty = false): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_TEXT_LENGTH &&
    (allowEmpty || value.trim().length > 0)
  );
}

function isRefusal(error: DeskFailure | WritingRefusal): error is WritingRefusal {
  return 'reasons' in error && Array.isArray(error.reasons);
}

/** A target as plain data with only the fields the rules read, so nothing else a session sent is kept. */
function plainTargets(targets: unknown): RequestedTarget[] | null {
  if (!Array.isArray(targets) || targets.length > MAX_TARGETS_PER_REQUEST) return null;
  const plain: RequestedTarget[] = [];
  for (const entry of targets) {
    if (typeof entry !== 'object' || entry === null) return null;
    const { kind, name, branch } = entry as Record<string, unknown>;
    if (typeof kind !== 'string' || kind.length > 64) return null;
    if (name !== undefined && (typeof name !== 'string' || name.length > 256)) return null;
    if (branch !== undefined && (typeof branch !== 'string' || branch.length > 256)) return null;
    plain.push({
      kind,
      ...(name !== undefined ? { name } : {}),
      ...(branch !== undefined ? { branch } : {}),
    });
  }
  return plain;
}

/** Whether two targets are one target: the kind and the name. The branch is not part of it. */
function sameTargetName(a: RequestedTarget, b: RequestedTarget): boolean {
  return a.kind === b.kind && (a.name ?? '') === (b.name ?? '');
}

/**
 * How a session is told of the session that holds a target: by what the Human
 * Lead sees in that session's header, and never by its id.
 */
function holderLabel(record: SessionRecord | null): string {
  if (record === null) return 'another session';
  const item = record.item === undefined ? '' : ` on the item #${record.item.number}`;
  return `the ${record.engine} session${item} that started at ${record.startedAt}`;
}

export function createDialogBroker(options: DialogBrokerOptions): DialogBroker {
  const { log } = options;
  const now = options.now ?? (() => Date.now());
  const limits: BrokerLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const tickets = new Map<string, Ticket>();
  const listeners = new Set<(event: BrokerEvent) => void>();
  const waiting = new Map<string, number>();
  const dialogRate = createRateLimit({
    max: limits.maxDialogRequestsPerWindow,
    windowMs: limits.rateWindowMs,
    now,
  });
  let closed = false;

  const emit = (event: BrokerEvent): void => {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (caught) {
        log.warn('dialog-broker-listener-failed', {
          message: caught instanceof Error ? caught.message : String(caught),
        });
      }
    }
  };

  const settle = (ticket: Ticket, answer: TicketAnswer): void => {
    ticket.answer = answer;
    ticket.settledAt = now();
    for (const wake of [...ticket.waiters]) wake();
    ticket.waiters.clear();
    emit({ kind: 'settled', request: ticket.request, answer });
  };

  const cancelled = (ticket: Ticket, reason: CancelReason): TicketAnswer =>
    ticket.request.kind === 'writing'
      ? { status: 'cancelled', granted: false, reason, message: CANCEL_MESSAGES[reason] }
      : { status: 'cancelled', reason, message: CANCEL_MESSAGES[reason] };

  const cancelTicket = (ticket: Ticket, reason: CancelReason): void => {
    log.info('dialog-cancelled', {
      session: ticket.request.sessionId,
      kind: ticket.request.kind,
      ticketId: shortTicket(ticket.request.ticket),
      reason,
    });
    settle(ticket, cancelled(ticket, reason));
  };

  /** Cancel what waited too long, and forget what was answered long ago. */
  const sweep = (): void => {
    const time = now();
    for (const [id, ticket] of tickets) {
      if (ticket.answer === null) {
        if (time - ticket.createdAt >= limits.pendingTicketTtlMs) cancelTicket(ticket, 'expired');
      } else if (time - (ticket.settledAt ?? time) >= limits.answeredTicketTtlMs) {
        tickets.delete(id);
      }
    }
  };

  const ticketsOf = (sessionId: string): Ticket[] =>
    [...tickets.values()].filter((ticket) => ticket.request.sessionId === sessionId);

  const CLOSED = fail(
    'closed',
    'The companion closed this Space. The companion is gone for this session: nothing can be asked.',
  );

  /** Whether the session may open one more ticket; makes room among its answered tickets when it can. */
  const admitTicket = (sessionId: string): Result<void, BrokerFailure> => {
    if (closed) return CLOSED;
    sweep();
    if (!dialogRate.take(sessionId)) {
      log.warn('dialog-request-rate-limited', { session: sessionId });
      return fail('rate-limited', 'Too many requests for a dialog in a short time. Wait a minute.');
    }
    const own = ticketsOf(sessionId);
    if (own.filter((ticket) => ticket.answer === null).length >= limits.maxPendingPerSession) {
      return fail(
        'too-many-tickets',
        'This session has too many requests that wait for the Human Lead. Wait for an answer first.',
      );
    }
    // The oldest answered tickets make room. Pending ones are under the smaller limit above.
    const answered = own
      .filter((ticket) => ticket.answer !== null)
      .sort((a, b) => (a.settledAt ?? 0) - (b.settledAt ?? 0));
    let kept = own.length;
    for (const oldest of answered) {
      if (kept < limits.maxTicketsPerSession) break;
      tickets.delete(oldest.request.ticket);
      kept -= 1;
    }
    return ok(undefined);
  };

  const open = (request: DialogRequest): { ticket: string } => {
    tickets.set(request.ticket, {
      request,
      createdAt: now(),
      answer: null,
      settledAt: null,
      waiters: new Set(),
    });
    emit({ kind: 'requested', request });
    return { ticket: request.ticket };
  };

  const newTicketId = (): string => randomBytes(16).toString('hex');

  const pendingTicket = (
    id: string,
    kind: DialogRequest['kind'],
  ): Result<Ticket, BrokerFailure> => {
    sweep();
    const ticket = tickets.get(id);
    if (!ticket) return fail('unknown-ticket', 'There is no such ticket.');
    if (ticket.request.kind !== kind) {
      return fail('wrong-kind', `The ticket is not a request of the kind "${kind}".`);
    }
    if (ticket.answer !== null) {
      return fail(
        'already-answered',
        'The ticket was answered already. A ticket is answered once.',
      );
    }
    return ok(ticket);
  };

  const deskFailed = (error: DeskFailure): { ok: false; error: BrokerFailure } =>
    fail('desk-failed', `The desk's records could not be used: ${error.message}`);

  /** A refusal as the asking session reads it: core's sentences, with each holder named by its label. */
  const refusalForSession = (
    desk: Desk,
    refused: WritingRefusal,
  ): { message: string; heldBy?: string } => {
    let heldBy: string | undefined;
    const sentences = refused.reasons.map((reason) => {
      if (reason.kind !== 'held' || reason.holder === undefined) return reason.message;
      const record = getSession(desk, reason.holder.sessionId);
      const label = holderLabel(record.ok ? record.value : null);
      heldBy ??= label;
      const target = reason.holder.target;
      const what = describeWriteTarget(target);
      const branch = target.kind === 'repository' ? ` on the branch "${target.branch}"` : '';
      return `${what.charAt(0).toUpperCase()}${what.slice(1)} is held by ${label}${branch}. One session holds a target at a time.`;
    });
    return { message: sentences.join(' '), ...(heldBy !== undefined ? { heldBy } : {}) };
  };

  /** Leave Writing for `sessionId`: the commits are read first, then core writes the mode, the closes and the release, in that order. */
  const leave = async (sessionId: string): Promise<Result<WritingLeftAnswer, BrokerFailure>> => {
    if (closed) return CLOSED;
    const desk = options.desk();
    if (!desk.ok) return deskFailed(desk.error);
    let closes: SessionCloseCommit[] = [];
    if (options.closeCommits) {
      try {
        closes = await options.closeCommits(desk.value, sessionId);
      } catch (caught) {
        // Leaving Writing never waits on a commit that cannot be read.
        log.warn('session-close-commits-not-read', {
          session: sessionId,
          message: caught instanceof Error ? caught.message : String(caught),
        });
      }
      // The Space may have closed while the commits were read; the desk is then given up.
      if (closed) return CLOSED;
    }
    const left = leaveWriting(desk.value, sessionId, { closes });
    if (!left.ok) {
      return isRefusal(left.error)
        ? fail('session-unknown', 'The desk has no session for this request.')
        : deskFailed(left.error);
    }
    if (left.value.closeFailure !== undefined) {
      log.warn('session-close-not-recorded', {
        session: sessionId,
        kind: left.value.closeFailure.kind,
      });
    }
    const released = left.value.released.map((claim) => claim.target);
    log.info('claims-released', {
      session: sessionId,
      targets: released.map(describeWriteTarget),
      closes: left.value.closes.length,
    });
    emit({ kind: 'left-writing', sessionId, released });
    return ok({ mode: 'read-only', released });
  };

  const sessionPort = (sessionId: string): SessionPort => ({
    requestWriting(input) {
      const targets = plainTargets(input.targets);
      if (
        targets === null ||
        !isText(input.reason) ||
        (input.item !== undefined && !(Number.isSafeInteger(input.item) && input.item > 0))
      ) {
        return fail(
          'invalid-request',
          'A request to enter Writing gives `targets` as a list, `reason` as one sentence, and `item`, when given, as the number of an issue.',
        );
      }
      if (closed) return CLOSED;
      const desk = options.desk();
      if (!desk.ok) return deskFailed(desk.error);
      const sessions = listSessions(desk.value);
      if (!sessions.ok) return deskFailed(sessions.error);
      const claims = listClaims(desk.value);
      if (!claims.ok) return deskFailed(claims.error);
      const decision = decideWritingRequest(
        { manifest: options.manifest(), sessions: sessions.value, claims: claims.value },
        { sessionId, targets },
      );
      // A request that only a holder stands against is shown: the dialog names the holder. A request
      // that is wrong in itself is the session's to correct, and no dialog is shown for it.
      if (!decision.ok && decision.error.reasons.some((reason) => reason.kind !== 'held')) {
        log.info('claim-refused', { session: sessionId, kind: decision.error.kind });
        return fail('refused', refusalForSession(desk.value, decision.error).message);
      }
      const admitted = admitTicket(sessionId);
      if (!admitted.ok) return admitted;
      const request: DialogRequest = {
        kind: 'writing',
        ticket: newTicketId(),
        sessionId,
        askedAt: new Date(now()).toISOString(),
        targets,
        reason: input.reason,
        ...(input.item !== undefined ? { item: input.item } : {}),
      };
      log.info('writing-requested', {
        session: sessionId,
        ticketId: shortTicket(request.ticket),
        targets: targets.map((target) => `${target.kind}:${target.name ?? ''}`),
      });
      return ok(open(request));
    },

    requestGate(input) {
      if (
        !isText(input.process) ||
        !isText(input.step) ||
        !isText(input.question) ||
        (input.bearsOn !== undefined && !isText(input.bearsOn, true))
      ) {
        return fail(
          'invalid-request',
          'A gate request gives `process`, `step` and `question` as text, and `bearsOn`, when given, as text.',
        );
      }
      if (closed) return CLOSED;
      const desk = options.desk();
      if (!desk.ok) return deskFailed(desk.error);
      const session = getSession(desk.value, sessionId);
      if (!session.ok) return deskFailed(session.error);
      if (session.value === null || session.value.closedAt !== undefined) {
        return fail('session-unknown', 'The desk has no open session for this request.');
      }
      const admitted = admitTicket(sessionId);
      if (!admitted.ok) return admitted;
      const request: DialogRequest = {
        kind: 'gate',
        ticket: newTicketId(),
        sessionId,
        askedAt: new Date(now()).toISOString(),
        process: input.process,
        step: input.step,
        question: input.question,
        ...(input.bearsOn !== undefined ? { bearsOn: input.bearsOn } : {}),
      };
      log.info('gate-asked', {
        session: sessionId,
        ticketId: shortTicket(request.ticket),
        process: input.process,
        step: input.step,
      });
      return ok(open(request));
    },

    async awaitAnswer(id, { waitMs, signal }) {
      sweep();
      const ticket = typeof id === 'string' ? tickets.get(id) : undefined;
      // A ticket of another session reads exactly as one that does not exist.
      if (!ticket || ticket.request.sessionId !== sessionId) {
        return fail('unknown-ticket', 'There is no such ticket for this session.');
      }
      if (ticket.answer !== null) return ok(ticket.answer);
      const count = waiting.get(sessionId) ?? 0;
      if (closed || waitMs <= 0 || signal?.aborted || count >= limits.maxWaitersPerSession) {
        return ok({ status: 'pending' });
      }
      waiting.set(sessionId, count + 1);
      await new Promise<void>((resolve) => {
        const done = (): void => {
          clearTimeout(timer);
          ticket.waiters.delete(done);
          signal?.removeEventListener('abort', done);
          resolve();
        };
        const timer = setTimeout(done, waitMs);
        ticket.waiters.add(done);
        signal?.addEventListener('abort', done, { once: true });
      });
      const left = (waiting.get(sessionId) ?? 1) - 1;
      if (left > 0) waiting.set(sessionId, left);
      else waiting.delete(sessionId);
      return ok(ticket.answer ?? { status: 'pending' });
    },

    leaveWriting: () => leave(sessionId),
  });

  return {
    forSession: sessionPort,

    pending() {
      sweep();
      return [...tickets.values()]
        .filter((ticket) => ticket.answer === null)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((ticket) => ticket.request);
    },

    describeWriting(id) {
      const ticket = pendingTicket(id, 'writing');
      if (!ticket.ok) return ticket;
      const request = ticket.value.request as Extract<DialogRequest, { kind: 'writing' }>;
      const desk = options.desk();
      if (!desk.ok) return deskFailed(desk.error);
      const sessions = listSessions(desk.value);
      if (!sessions.ok) return deskFailed(sessions.error);
      const claims = listClaims(desk.value);
      if (!claims.ok) return deskFailed(claims.error);
      const manifest = options.manifest();
      const decision = decideWritingRequest(
        { manifest, sessions: sessions.value, claims: claims.value },
        { sessionId: request.sessionId, targets: request.targets },
      );
      return ok({
        request,
        claimable: listClaimableTargets(manifest, claims.value, request.sessionId),
        refusal: decision.ok ? null : decision.error,
      });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    answerWriting(id, decision) {
      const found = pendingTicket(id, 'writing');
      if (!found.ok) return found;
      const ticket = found.value;
      const request = ticket.request as Extract<DialogRequest, { kind: 'writing' }>;
      const short = shortTicket(id);
      let answer: WritingAnswer;
      if (!decision.confirm) {
        answer = {
          status: 'answered',
          granted: false,
          reason: 'declined',
          message: 'The Human Lead declined the request. The session stays in Read only.',
        };
        log.info('claim-declined', { session: request.sessionId, ticketId: short });
      } else {
        const targets =
          decision.targets === undefined ? request.targets : plainTargets(decision.targets);
        if (targets === null) return fail('invalid-request', 'The targets are not a list.');
        // The Human Lead confirms what was asked, or less. The ticket stays pending.
        const outside = targets.find(
          (target) => !request.targets.some((asked) => sameTargetName(asked, target)),
        );
        if (outside !== undefined || targets.length === 0) {
          return fail(
            'invalid-request',
            'The confirmed targets are some or all of the targets the session asked for, and at least one.',
          );
        }
        const desk = options.desk();
        const entered: ReturnType<typeof enterWriting> = desk.ok
          ? enterWriting(desk.value, options.manifest(), {
              sessionId: request.sessionId,
              targets,
              reason: request.reason,
              ...(request.item !== undefined ? { item: request.item } : {}),
            })
          : desk;
        if (entered.ok) {
          // Everything the session holds now, which is more than this request when it held targets before.
          const held = desk.ok ? listClaims(desk.value) : desk;
          answer = {
            status: 'answered',
            granted: true,
            claims: held.ok
              ? held.value.filter((claim) => claim.sessionId === request.sessionId)
              : entered.value.claims,
          };
          log.info('claim-granted', {
            session: request.sessionId,
            ticketId: short,
            targets: entered.value.claims.map((claim) => describeWriteTarget(claim.target)),
          });
        } else if (isRefusal(entered.error) && desk.ok) {
          const told = refusalForSession(desk.value, entered.error);
          answer = {
            status: 'answered',
            granted: false,
            reason: told.heldBy !== undefined ? 'held' : 'refused',
            ...told,
          };
          log.info('claim-refused', {
            session: request.sessionId,
            ticketId: short,
            kind: entered.error.kind,
          });
        } else {
          // A guard that cannot decide refuses.
          answer = {
            status: 'answered',
            granted: false,
            reason: 'failed',
            message: `The claim could not be written to the desk's records: ${entered.error.message}`,
          };
          log.error('claim-failed', {
            session: request.sessionId,
            ticketId: short,
            kind: entered.error.kind,
          });
        }
      }
      settle(ticket, answer);
      return ok(answer);
    },

    answerGate(id, answer) {
      const found = pendingTicket(id, 'gate');
      if (!found.ok) return found;
      if (answer !== 'yes' && answer !== 'no' && answer !== 'take-over') {
        return fail('invalid-request', 'A gate is answered yes, no or take-over.');
      }
      const ticket = found.value;
      const request = ticket.request as Extract<DialogRequest, { kind: 'gate' }>;
      const desk = options.desk();
      if (!desk.ok) return deskFailed(desk.error);
      const recorded = recordGateAnswer(desk.value, {
        sessionId: request.sessionId,
        process: request.process,
        step: request.step,
        question: request.question,
        answer,
      });
      if (!recorded.ok) {
        log.error('gate-answer-not-recorded', {
          session: request.sessionId,
          ticketId: shortTicket(id),
          kind: recorded.error.kind,
        });
        return deskFailed(recorded.error);
      }
      log.info('gate-answered', {
        session: request.sessionId,
        ticketId: shortTicket(id),
        process: request.process,
        step: request.step,
        answer,
      });
      settle(ticket, { status: 'answered', ...recorded.value });
      return ok(recorded.value);
    },

    cancel(id, reason = 'dismissed') {
      sweep();
      const ticket = tickets.get(id);
      if (!ticket) return fail('unknown-ticket', 'There is no such ticket.');
      if (ticket.answer !== null) {
        return fail('already-answered', 'The ticket was answered already.');
      }
      cancelTicket(ticket, reason);
      return ok(undefined);
    },

    leaveWriting: leave,

    sessionEnded(sessionId) {
      for (const ticket of ticketsOf(sessionId)) {
        if (ticket.answer === null) cancelTicket(ticket, 'session-ended');
        tickets.delete(ticket.request.ticket);
      }
      dialogRate.forget(sessionId);
    },

    close() {
      if (closed) return;
      closed = true;
      for (const ticket of tickets.values()) {
        if (ticket.answer === null) cancelTicket(ticket, 'companion-closed');
      }
      dialogRate.clear();
    },
  };
}
