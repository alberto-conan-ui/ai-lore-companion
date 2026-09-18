/**
 * The handlers of the two dialogs (`shared/ipc/space/dialogs.contract.ts`).
 * Phase M4.5.
 *
 * The dialogs attach to the dialog broker of the Space's session server
 * (`../session-server/broker.ts`). The service `spaceDialogs` below subscribes
 * to the broker once per Space and pushes the list of pending requests to the
 * windows of that Space whenever a request is asked, answered or cancelled.
 * The first `spaceDialogsPending` call of a Space, which the Space window makes
 * when it mounts its dialogs, starts it.
 *
 * Every handler accepts a call only from the own web contents of a window of an
 * open Space (`deps.space.contextFor`), and validates its argument with
 * `parseArg`. An answer is accepted only from the Space window of that Space
 * (`deps.space.windowFor`, mode `space`): a Files window, and a page in an
 * embedded browser tab, cannot answer. The renderer sends the ticket and the
 * Human Lead's choice; main reads the request back from the broker, refuses a
 * target another session holds and a branch git does not accept, and leaves the
 * request pending in both cases. The broker then writes the desk: the claim and
 * the mode with `enterWriting`, a gate answer with `recordGateAnswer`.
 *
 * A session is never named by its id here: the dialog shows the engine, the
 * start time and the item.
 */

import {
  type Desk,
  type RequestedTarget,
  type SessionRecord,
  type WriteTarget,
  branchNameProblem,
  describeWriteTarget,
  getSession,
} from '@ai-lore-companion/core';
import { z } from 'zod';
import { SPACE_DIALOGS_CONTRACT } from '../../../shared/ipc/space/dialogs.contract.js';
import type {
  ConfirmedTarget,
  DialogAsker,
  DialogGitHubState,
  DialogTargetKind,
  PendingDialog,
  PendingDialogs,
  SettledDialog,
  SpaceDialogsFailure,
  SpaceDialogsFailureKind,
  SpaceDialogsResult,
  WritingDialogView,
  WritingTargetRow,
} from '../../../shared/ipc/space/dialogs.types.js';
import type { Deps, RegisterModule } from '../../ipc/types.js';
import { type SpaceContext, defineSpaceService } from '../context.js';
import { spaceDesk } from '../desk-service.js';
import { spaceGitHub } from '../github-service.js';
import type { SpaceIpcEvent } from '../host.js';
import {
  type BrokerEvent,
  type BrokerFailure,
  type DialogBroker,
  type DialogRequest,
  sessionServer,
} from '../session-server/index.js';
import { parseArg } from './validate.js';

/** How long the dialog waits for GitHub to answer before it says GitHub cannot be reached. */
export const GITHUB_PROBE_TIMEOUT_MS = 8000;

const PENDING_CHANNEL = SPACE_DIALOGS_CONTRACT.onSpaceDialogsPending.channel;

type Send = (channel: string, payload: unknown) => void;

/** The dialogs of one Space: the broker, and the push of its pending requests. */
export type SpaceDialogs = {
  readonly broker: DialogBroker;
  /** Where the pushes go: the windows of the Space. Set by every call, as the roots service is. */
  bind(send: Send): void;
  /** The pending requests as the dialogs show them. */
  pending(): PendingDialogs;
  dispose(): void;
};

/** What the dialogs show of a session: its header's words, never its id. */
function askerOf(record: SessionRecord | null): DialogAsker | null {
  if (record === null) return null;
  return { engine: record.engine, startedAt: record.startedAt, item: record.item?.number ?? null };
}

/** "the <engine> session on item #N that started at <time>". */
export function holderLabel(record: SessionRecord | null): string {
  if (record === null) return 'another session';
  const item = record.item === undefined ? '' : ` on item #${record.item.number}`;
  return `the ${record.engine} session${item} that started at ${record.startedAt}`;
}

function sessionOf(desk: Desk | null, sessionId: string): SessionRecord | null {
  if (desk === null) return null;
  const found = getSession(desk, sessionId);
  return found.ok ? found.value : null;
}

function openDesk(context: SpaceContext): Desk | null {
  const desk = context.service(spaceDesk).open();
  return desk.ok ? desk.value : null;
}

function isTargetKind(kind: string): kind is DialogTargetKind {
  return kind === 'lore' || kind === 'publish-area' || kind === 'repository';
}

/** A requested target as a sentence names it; a kind core does not know is named as it was asked. */
function targetWords(target: RequestedTarget): string {
  if (target.kind === 'lore') return describeWriteTarget({ kind: 'lore' });
  if (target.kind === 'publish-area' || target.kind === 'repository') {
    const base = describeWriteTarget({
      kind: target.kind,
      name: target.name ?? '',
      branch: target.branch ?? '',
    } as WriteTarget);
    return target.kind === 'repository' && target.branch !== undefined
      ? `${base} on the branch ${JSON.stringify(target.branch)}`
      : base;
  }
  return JSON.stringify(target.kind);
}

function sameTarget(a: { kind: string; name?: string | null }, b: RequestedTarget): boolean {
  return a.kind === b.kind && (a.name ?? '') === (b.name ?? '');
}

function toPending(request: DialogRequest, desk: Desk | null): PendingDialog {
  const session = askerOf(sessionOf(desk, request.sessionId));
  if (request.kind === 'writing') {
    return {
      kind: 'writing',
      ticket: request.ticket,
      askedAt: request.askedAt,
      session,
      reason: request.reason,
      item: request.item ?? null,
      targets: request.targets.map(targetWords),
    };
  }
  return {
    kind: 'gate',
    ticket: request.ticket,
    askedAt: request.askedAt,
    session,
    process: request.process,
    step: request.step,
    question: request.question,
    bearsOn: request.bearsOn ?? null,
  };
}

function settledOf(event: Extract<BrokerEvent, { kind: 'settled' }>): SettledDialog {
  const { request, answer } = event;
  if (answer.status === 'cancelled') {
    return {
      ticket: request.ticket,
      kind: request.kind,
      outcome: 'cancelled',
      message: answer.message,
    };
  }
  if ('granted' in answer) {
    return {
      ticket: request.ticket,
      kind: 'writing',
      outcome: 'answered',
      message: answer.granted
        ? grantedMessage(answer.claims.map((claim) => claim.target))
        : answer.message,
    };
  }
  return {
    ticket: request.ticket,
    kind: 'gate',
    outcome: 'answered',
    message: `The gate ${JSON.stringify(answer.step)} of the process ${JSON.stringify(answer.process)} was answered ${answer.answer}, and the companion recorded the answer.`,
  };
}

function grantedMessage(targets: readonly WriteTarget[]): string {
  const words = targets.map((target) =>
    target.kind === 'repository'
      ? `${describeWriteTarget(target)} on the branch ${JSON.stringify(target.branch)}`
      : describeWriteTarget(target),
  );
  return `Granted. The session is in Writing and holds ${words.join(', ')}.`;
}

/** The dialogs of a Space. `context.service(spaceDialogs)` builds it on first use. */
export const spaceDialogs = defineSpaceService<SpaceDialogs>({
  id: 'dialogs',
  create: (context: SpaceContext) => {
    // The session server first, so that it is disposed after this service.
    const { broker } = context.service(sessionServer);
    let send: Send | null = null;
    const pending = (): PendingDialogs => {
      const desk = openDesk(context);
      return { requests: broker.pending().map((request) => toPending(request, desk)) };
    };
    const off = broker.subscribe((event) => {
      if (event.kind === 'left-writing' || send === null) return;
      send(PENDING_CHANNEL, {
        ...pending(),
        settled: event.kind === 'settled' ? settledOf(event) : null,
      });
    });
    return {
      broker,
      bind(next) {
        send = next;
      },
      pending,
      dispose() {
        off();
        send = null;
      },
    };
  },
  dispose: (service) => service.dispose(),
});

const ticketSchema = z.string().regex(/^[0-9a-f]{16,128}$/);

const confirmedTargetSchema = z.strictObject({
  kind: z.enum(['lore', 'publish-area', 'repository']),
  name: z.string().min(1).max(256).optional(),
  branch: z.string().min(1).max(256).optional(),
});

const schemas = {
  pending: z.strictObject({}),
  ticket: z.strictObject({ ticket: ticketSchema }),
  answerWriting: z.discriminatedUnion('confirm', [
    z.strictObject({
      ticket: ticketSchema,
      confirm: z.literal(true),
      targets: z.array(confirmedTargetSchema).max(16),
    }),
    z.strictObject({ ticket: ticketSchema, confirm: z.literal(false) }),
  ]),
  answerGate: z.strictObject({
    ticket: ticketSchema,
    answer: z.enum(['yes', 'no', 'take-over']),
  }),
};

function failure<T>(kind: SpaceDialogsFailureKind, message: string): SpaceDialogsResult<T> {
  return { ok: false, error: { kind, message } };
}

function fromBroker<T>(error: BrokerFailure): SpaceDialogsResult<T> {
  const kinds: Record<BrokerFailure['kind'], SpaceDialogsFailureKind> = {
    'unknown-ticket': 'unknown-ticket',
    'already-answered': 'already-answered',
    'wrong-kind': 'wrong-kind',
    'invalid-request': 'invalid-request',
    refused: 'failed',
    'session-unknown': 'failed',
    'rate-limited': 'failed',
    'too-many-tickets': 'failed',
    'desk-failed': 'desk-failed',
    closed: 'closed',
  };
  return failure(kinds[error.kind], error.message);
}

type Call<T> = { context: SpaceContext; dialogs: SpaceDialogs; arg: T };

/**
 * The start every handler shares: the Space of the calling window, the Space
 * window check for an answer, the validated argument, and the service bound to
 * push to that Space.
 */
function begin<T>(
  deps: Deps,
  event: SpaceIpcEvent,
  schema: z.ZodType<T>,
  arg: unknown,
  answering: boolean,
): { ok: true; value: Call<T> } | { ok: false; error: SpaceDialogsFailure } {
  const context = deps.space.contextFor(event);
  if (!context) {
    return {
      ok: false,
      error: {
        kind: 'not-a-space-window',
        message: 'The request did not come from a window of an open Space.',
      },
    };
  }
  if (answering && deps.space.windowFor(event)?.init.mode !== 'space') {
    return {
      ok: false,
      error: {
        kind: 'not-the-space-window',
        message: 'A request is answered only in the Space window of its Space.',
      },
    };
  }
  const parsed = parseArg(schema, arg);
  if (!parsed.ok) return parsed;
  const dialogs = context.service(spaceDialogs);
  const spaceRoot = context.root;
  dialogs.bind((channel, payload) => deps.space.sendToSpace(spaceRoot, channel, payload));
  return { ok: true, value: { context, dialogs, arg: parsed.value } };
}

/** Ask GitHub who is signed in, as a check that it answers. */
async function probeGitHub(context: SpaceContext): Promise<DialogGitHubState> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const port = await context.service(spaceGitHub).port();
    const timeout = new Promise<{ ok: false; error: { message: string } }>((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            ok: false,
            error: {
              message: `GitHub did not answer in ${GITHUB_PROBE_TIMEOUT_MS / 1000} seconds.`,
            },
          }),
        GITHUB_PROBE_TIMEOUT_MS,
      );
    });
    const answer = await Promise.race([port.auth(), timeout]);
    return answer.ok ? { reachable: true } : { reachable: false, message: answer.error.message };
  } catch (caught) {
    return { reachable: false, message: caught instanceof Error ? caught.message : String(caught) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The rows of the entering-Writing dialog, read from the broker's view of the request and the desk. */
function writingView(
  context: SpaceContext,
  broker: DialogBroker,
  ticket: string,
  github: DialogGitHubState,
): SpaceDialogsResult<WritingDialogView> {
  const described = broker.describeWriting(ticket);
  if (!described.ok) return fromBroker(described.error);
  const { request, claimable, refusal } = described.value;
  const desk = openDesk(context);
  const targets: WritingTargetRow[] = [];
  for (const target of request.targets) {
    if (!isTargetKind(target.kind)) continue;
    const row = claimable.find((entry) => sameTarget(entry, target));
    const holder = row?.holder && !row.heldByThisSession ? row.holder : null;
    const problem =
      refusal?.reasons.find(
        (reason) =>
          reason.kind !== 'held' &&
          reason.target !== undefined &&
          sameTarget(reason.target, target),
      )?.message ?? null;
    targets.push({
      kind: target.kind,
      name: target.kind === 'lore' ? null : (target.name ?? null),
      branch: target.kind === 'repository' ? (target.branch ?? null) : null,
      heldBy: holder === null ? null : holderLabel(sessionOf(desk, holder.sessionId)),
      problem,
    });
  }
  return {
    ok: true,
    value: {
      ticket: request.ticket,
      askedAt: request.askedAt,
      session: askerOf(sessionOf(desk, request.sessionId)),
      reason: request.reason,
      item: request.item ?? null,
      targets,
      github,
    },
  };
}

/**
 * Check the Human Lead's confirmation against the broker's record of the
 * request and the desk as it is now: each target one the session asked for,
 * none held by another session, every branch a name git accepts. A refusal
 * here leaves the request pending, so the Human Lead can change the choice.
 */
function checkConfirmation(
  context: SpaceContext,
  broker: DialogBroker,
  ticket: string,
  confirmed: readonly ConfirmedTarget[],
): SpaceDialogsResult<RequestedTarget[]> {
  const view = writingView(context, broker, ticket, { reachable: true });
  if (!view.ok) return view;
  if (confirmed.length === 0) {
    return failure('invalid-request', 'Confirm at least one target, or decline the request.');
  }
  const targets: RequestedTarget[] = [];
  for (const target of confirmed) {
    const row = view.value.targets.find((entry) => sameTarget(entry, target));
    if (row === undefined) {
      return failure(
        'invalid-request',
        `The session did not ask for ${targetWords(target)}. Only the requested targets can be confirmed.`,
      );
    }
    if (row.heldBy !== null) {
      return failure(
        'target-held',
        `${targetWords(target)} is held by ${row.heldBy}. One session holds a target at a time.`,
      );
    }
    if (target.kind === 'repository') {
      const branch = target.branch ?? '';
      const problem = branchNameProblem(branch);
      if (problem !== null) {
        return failure(
          'branch-invalid',
          `The branch ${JSON.stringify(branch)} of ${targetWords({ kind: 'repository', ...(row.name !== null ? { name: row.name } : {}) })} is not a name git accepts: ${problem}.`,
        );
      }
      targets.push({ kind: 'repository', name: row.name ?? '', branch });
    } else if (target.kind === 'publish-area') {
      targets.push({ kind: 'publish-area', name: row.name ?? '' });
    } else {
      targets.push({ kind: 'lore' });
    }
  }
  return { ok: true, value: targets };
}

/** A handler never rejects: what it throws is returned as a failure. */
function guarded<T>(
  context: SpaceContext,
  work: () => SpaceDialogsResult<T>,
): SpaceDialogsResult<T> {
  try {
    return work();
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    context.log.error('dialogs-handler-failed', { space: context.key, message });
    return failure('failed', message);
  }
}

export const registerSpaceDialogs: RegisterModule = (reg, deps) => {
  reg.handle('spaceDialogsPending', async (event, arg) => {
    const call = begin(deps, event, schemas.pending, arg, false);
    if (!call.ok) return call;
    const { context, dialogs } = call.value;
    return guarded(context, () => ({ ok: true, value: dialogs.pending() }));
  });

  reg.handle('spaceDialogWritingView', async (event, arg) => {
    const call = begin(deps, event, schemas.ticket, arg, false);
    if (!call.ok) return call;
    const { context, dialogs } = call.value;
    // The request is checked before GitHub is asked, so an unknown ticket costs no call to GitHub.
    const early = guarded(context, () =>
      writingView(context, dialogs.broker, call.value.arg.ticket, { reachable: true }),
    );
    if (!early.ok) return early;
    const github = await probeGitHub(context);
    return guarded(context, () =>
      writingView(context, dialogs.broker, call.value.arg.ticket, github),
    );
  });

  reg.handle('spaceDialogAnswerWriting', async (event, arg) => {
    const call = begin(deps, event, schemas.answerWriting, arg, true);
    if (!call.ok) return call;
    const { context, dialogs } = call.value;
    const answer = call.value.arg;
    return guarded(context, () => {
      if (!answer.confirm) {
        const declined = dialogs.broker.answerWriting(answer.ticket, { confirm: false });
        if (!declined.ok) return fromBroker(declined.error);
        const told = declined.value;
        return {
          ok: true,
          value: { granted: false, message: 'message' in told ? told.message : '' },
        };
      }
      const targets = checkConfirmation(context, dialogs.broker, answer.ticket, answer.targets);
      if (!targets.ok) return targets;
      const answered = dialogs.broker.answerWriting(answer.ticket, {
        confirm: true,
        targets: targets.value,
      });
      if (!answered.ok) return fromBroker(answered.error);
      const value = answered.value;
      if (value.status === 'answered' && value.granted) {
        return {
          ok: true,
          value: {
            granted: true,
            message: grantedMessage(value.claims.map((claim) => claim.target)),
          },
        };
      }
      return { ok: true, value: { granted: false, message: value.message } };
    });
  });

  reg.handle('spaceDialogAnswerGate', async (event, arg) => {
    const call = begin(deps, event, schemas.answerGate, arg, true);
    if (!call.ok) return call;
    const { context, dialogs } = call.value;
    return guarded(context, () => {
      const recorded = dialogs.broker.answerGate(call.value.arg.ticket, call.value.arg.answer);
      if (!recorded.ok) return fromBroker(recorded.error);
      return {
        ok: true,
        value: { answer: recorded.value.answer, answeredAt: recorded.value.answeredAt },
      };
    });
  });
};
