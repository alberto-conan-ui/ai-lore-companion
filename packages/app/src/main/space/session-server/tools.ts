/**
 * The four tools a session calls, as an adapter from MCP to the session side
 * of the broker. Phase M4.3.
 *
 * The names, the parameters and the answers are those of section 4.3 of the
 * architecture document and of the Lore's cards (`request_writing`,
 * `request_gate`, `await_answer`, `leave_writing`). The adapter receives the
 * port of one session, which the server chose from the authenticated path: no
 * tool takes a session id, so a session cannot ask, wait or leave for another.
 *
 * An answer is one JSON text. A failure is a tool error whose text is
 * `{ "error": <kind>, "message": <sentence> }`.
 */

import type { SessionPurpose } from '@ai-lore-companion/core';
import { z } from 'zod';
import {
  DASHBOARD_COMPONENT_ID_MAX_CHARS,
  DASHBOARD_LIST_ITEM_MAX_CHARS,
  DASHBOARD_LIST_MAX_ITEMS,
  DASHBOARD_REPORT_BASIS_MAX_CHARS,
  DASHBOARD_REPORT_MAX_CHARS,
  DASHBOARD_TEXT_MAX_CHARS,
  type DashboardReportInput,
} from '../../../shared/ipc/space/dashboard-report.types.js';
import type { McpHostTool, McpHostToolResult } from '../../helper/mcp-host.js';
import type { SpaceLog } from '../log.js';
import type { BrokerFailure, SessionPort } from './broker.js';
import {
  AWAIT_ANSWER_WAIT_MS,
  MAX_CALLS_PER_WINDOW,
  MAX_TARGETS_PER_REQUEST,
  MAX_WORK_TICKETS_PER_CALL,
  MAX_TEXT_LENGTH,
  RATE_WINDOW_MS,
} from './constants.js';
import { createRateLimit } from './rate-limit.js';

/** The names of the tools, in the order the Lore's cards list them. */
export const SESSION_TOOL_NAMES = [
  'request_writing',
  'request_gate',
  'await_answer',
  'leave_writing',
  'tickets_touched',
] as const;

export type SessionToolName = (typeof SESSION_TOOL_NAMES)[number];

/** The extra tool only a PM session receives. It is not a write-target tool. */
export const DASHBOARD_REPORT_TOOL_NAME = 'report_dashboard';
export const DASHBOARD_CONTEXT_TOOL_NAME = 'get_dashboard_context';
export const DASHBOARD_UPDATE_TOOL_NAME = 'request_dashboard_update';

/** The validated text the PM gives the app. `basis` is descriptive, not evidence. */
export type DashboardReportToolInput = DashboardReportInput;

/** A small app-state port that receives a PM's validated report. */
export type DashboardReportPort = {
  publish: (
    input: DashboardReportToolInput,
  ) => { ok: true } | { ok: false; error: { kind: string; message: string } };
};

export type DashboardContextPort = {
  read: () => unknown | Promise<unknown>;
};

export type DashboardUpdatePort = {
  request: () => unknown | Promise<unknown>;
};

const text = z.string().min(1).max(MAX_TEXT_LENGTH);

/** Text that is safe to retain and show as literal Markdown, rather than HTML. */
function hasDisallowedControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
  });
}

const reportText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim().length > 0, 'must contain non-whitespace text')
    .refine((value) => !hasDisallowedControl(value), 'must not contain control characters');

const targetShape = z.object({
  kind: z.enum(['lore', 'publish-area', 'repository']),
  name: z.string().min(1).max(256).optional(),
  branch: z.string().min(1).max(256).optional(),
});

const SHAPES = {
  request_writing: {
    targets: z
      .array(targetShape)
      .min(1)
      .max(MAX_TARGETS_PER_REQUEST)
      .describe(
        'The write targets: { "kind": "lore" }, { "kind": "publish-area", "name": … } or { "kind": "repository", "name": …, "branch": … }. All are granted, or none.',
      ),
    item: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("The number of the item's issue, when there is one."),
    reason: text.describe('One sentence that says what will be written.'),
  },
  request_gate: {
    process: text.describe('The name of the process.'),
    step: text.describe('The step of the process that has the gate.'),
    question: text.describe('The question the Human Lead answers with yes, no or take over.'),
    bearsOn: z
      .string()
      .max(MAX_TEXT_LENGTH)
      .optional()
      .describe('What the answer bears on: a path, a list, the evidence.'),
  },
  await_answer: {
    ticket: z.string().min(1).max(128).describe('The ticket a request returned.'),
  },
  leave_writing: {},
  tickets_touched: {
    tickets: z
      .array(z.number().int().positive())
      .min(1)
      .max(MAX_WORK_TICKETS_PER_CALL)
      .describe('The numbers of the issues this session has done substantive work on.'),
  },
} satisfies Record<SessionToolName, z.ZodRawShape>;

const DASHBOARD_REPORT_SHAPE = {
  definitionHash: z
    .string()
    .min(1)
    .max(256)
    .describe('The hash of the effective definition you read.'),
  components: z
    .array(
      z.union([
        z.strictObject({
          id: z.string().min(1).max(DASHBOARD_COMPONENT_ID_MAX_CHARS),
          type: z.literal('text'),
          text: reportText(DASHBOARD_TEXT_MAX_CHARS),
        }),
        z.strictObject({
          id: z.string().min(1).max(DASHBOARD_COMPONENT_ID_MAX_CHARS),
          type: z.literal('metric'),
          value: z.union([z.number().finite(), reportText(256)]),
          unit: reportText(128).optional(),
        }),
        z.strictObject({
          id: z.string().min(1).max(DASHBOARD_COMPONENT_ID_MAX_CHARS),
          type: z.literal('list'),
          items: z
            .array(
              z.strictObject({
                id: z.string().min(1).max(DASHBOARD_COMPONENT_ID_MAX_CHARS),
                label: reportText(DASHBOARD_LIST_ITEM_MAX_CHARS),
                value: reportText(DASHBOARD_LIST_ITEM_MAX_CHARS).optional(),
                status: reportText(DASHBOARD_LIST_ITEM_MAX_CHARS).optional(),
              }),
            )
            .max(DASHBOARD_LIST_MAX_ITEMS),
        }),
        z.strictObject({
          id: z.string().min(1).max(DASHBOARD_COMPONENT_ID_MAX_CHARS),
          unavailable: z.literal(true),
          reason: reportText(1024),
        }),
      ]),
    )
    .max(48)
    .describe('One typed value for every PM component in the effective definition.'),
  basis: reportText(DASHBOARD_REPORT_BASIS_MAX_CHARS)
    .optional()
    .describe(
      'An optional plain-language description of what you read. This is not trusted freshness.',
    ),
} satisfies z.ZodRawShape;

const DESCRIPTIONS: Record<SessionToolName, string> = {
  request_writing:
    'Ask the Human Lead for the entering-Writing dialog. Returns { "ticket" } at once. Then call await_answer with the ticket.',
  request_gate:
    'Ask the Human Lead the question of a gate in a companion dialog. Returns { "ticket" } at once. Then call await_answer with the ticket.',
  await_answer:
    'Wait for the answer to a ticket. Returns the answer, or { "status": "pending" } when the Human Lead has not answered yet: call it again.',
  leave_writing:
    'Return the session to Read only. The companion releases every write target the session holds. Takes no arguments.',
  tickets_touched:
    "Name the tickets this session has done substantive work on. They are listed on the session's issue, and each gets one comment linking back to it, however often you name it. Call it as you go, not only at the end.",
};

const DASHBOARD_REPORT_DESCRIPTION =
  'Publish typed PM dashboard values. Read get_dashboard_context first and repeat its definitionHash; this changes only ephemeral app state, not files, claims or session mode.';

const DASHBOARD_CONTEXT_DESCRIPTION =
  'Read the effective dashboard definition, its hash and current factual evidence before reporting. This is read-only.';
const DASHBOARD_UPDATE_DESCRIPTION =
  'Request one guarded transient PM dashboard refresh. Concurrent requests for this Space coalesce.';

function answer(value: unknown): McpHostToolResult {
  return { text: JSON.stringify(value) };
}

function refusal(error: BrokerFailure | { kind: string; message: string }): McpHostToolResult {
  return { text: JSON.stringify({ error: error.kind, message: error.message }), isError: true };
}

export type SessionToolsOptions = {
  sessionId: string;
  port: SessionPort;
  log: SpaceLog;
  now?: () => number;
  /** How long one `await_answer` waits. Tests pass a short wait. */
  awaitMs?: number;
  maxCallsPerWindow?: number;
  /** Called around every tool call, so that closing can wait for answers that are on their way out. */
  onCall?: (phase: 'start' | 'end') => void;
  purpose?: SessionPurpose;
  dashboardContext?: DashboardContextPort;
  dashboardUpdate?: DashboardUpdatePort;
  dashboardReport?: DashboardReportPort;
};

/** The tools of one session. */
export function createSessionTools(options: SessionToolsOptions): McpHostTool[] {
  const { sessionId, port, log } = options;
  const awaitMs = options.awaitMs ?? AWAIT_ANSWER_WAIT_MS;
  const calls = createRateLimit({
    max: options.maxCallsPerWindow ?? MAX_CALLS_PER_WINDOW,
    windowMs: RATE_WINDOW_MS,
    now: options.now ?? (() => Date.now()),
  });

  const run: Record<
    | SessionToolName
    | typeof DASHBOARD_REPORT_TOOL_NAME
    | typeof DASHBOARD_CONTEXT_TOOL_NAME
    | typeof DASHBOARD_UPDATE_TOOL_NAME,
    (
      args: Record<string, unknown>,
      extra: { signal: AbortSignal },
    ) => McpHostToolResult | Promise<McpHostToolResult>
  > = {
    request_writing: (args) => {
      const asked = port.requestWriting(args as Parameters<SessionPort['requestWriting']>[0]);
      return asked.ok ? answer(asked.value) : refusal(asked.error);
    },
    request_gate: (args) => {
      const asked = port.requestGate(args as Parameters<SessionPort['requestGate']>[0]);
      return asked.ok ? answer(asked.value) : refusal(asked.error);
    },
    await_answer: async (args, extra) => {
      const awaited = await port.awaitAnswer(String(args.ticket), {
        waitMs: awaitMs,
        signal: extra.signal,
      });
      return awaited.ok ? answer(awaited.value) : refusal(awaited.error);
    },
    leave_writing: async () => {
      const left = await port.leaveWriting();
      return left.ok ? answer(left.value) : refusal(left.error);
    },
    tickets_touched: async (args) => {
      const named = await port.ticketsTouched((args.tickets ?? []) as number[]);
      return named.ok ? answer(named.value) : refusal(named.error);
    },
    report_dashboard: (args) => {
      if (options.dashboardReport === undefined) {
        return refusal({
          kind: 'not-a-pm-session',
          message: 'This session cannot publish Dashboard reports.',
        });
      }
      if ('markdown' in args) {
        return refusal({
          kind: 'invalid-report',
          message:
            'Legacy Markdown reports are not accepted. Call get_dashboard_context and submit typed components with definitionHash.',
        });
      }
      const published = options.dashboardReport.publish(args as DashboardReportToolInput);
      return published.ok ? answer({ status: 'received' }) : refusal(published.error);
    },
    get_dashboard_context: async () => {
      if (options.dashboardContext === undefined) {
        return refusal({
          kind: 'dashboard-unavailable',
          message: 'Dashboard context is unavailable.',
        });
      }
      return answer(await options.dashboardContext.read());
    },
    request_dashboard_update: async () => {
      if (options.dashboardUpdate === undefined) {
        return refusal({
          kind: 'not-an-ordinary-session',
          message: 'Only an ordinary agent session can request a dashboard update.',
        });
      }
      const requested = await options.dashboardUpdate.request();
      return answer(requested);
    },
  };

  type ToolName =
    | SessionToolName
    | typeof DASHBOARD_REPORT_TOOL_NAME
    | typeof DASHBOARD_CONTEXT_TOOL_NAME
    | typeof DASHBOARD_UPDATE_TOOL_NAME;
  const names: ToolName[] = [...SESSION_TOOL_NAMES];
  if (options.dashboardContext !== undefined) names.push(DASHBOARD_CONTEXT_TOOL_NAME);
  if (options.dashboardUpdate !== undefined) names.push(DASHBOARD_UPDATE_TOOL_NAME);
  if (options.dashboardReport !== undefined) names.push(DASHBOARD_REPORT_TOOL_NAME);
  return names.map((name) => ({
    name,
    description:
      name === DASHBOARD_REPORT_TOOL_NAME
        ? DASHBOARD_REPORT_DESCRIPTION
        : name === DASHBOARD_CONTEXT_TOOL_NAME
          ? DASHBOARD_CONTEXT_DESCRIPTION
          : name === DASHBOARD_UPDATE_TOOL_NAME
            ? DASHBOARD_UPDATE_DESCRIPTION
            : DESCRIPTIONS[name],
    shape:
      name === DASHBOARD_REPORT_TOOL_NAME
        ? DASHBOARD_REPORT_SHAPE
        : name === DASHBOARD_CONTEXT_TOOL_NAME || name === DASHBOARD_UPDATE_TOOL_NAME
          ? {}
          : SHAPES[name],
    call: async (args, extra) => {
      if (!calls.take(sessionId)) {
        log.warn('session-tool-rate-limited', { session: sessionId, tool: name });
        return refusal({
          kind: 'rate-limited',
          message: 'Too many tool calls in a short time. Wait a minute.',
        });
      }
      options.onCall?.('start');
      try {
        if (
          name === DASHBOARD_REPORT_TOOL_NAME &&
          JSON.stringify(args).length > DASHBOARD_REPORT_MAX_CHARS
        ) {
          return refusal({ kind: 'invalid-report', message: 'The dashboard report is too large.' });
        }
        const result = await run[name](args, extra);
        // The arguments and the answer are not logged: only which tool, and whether it failed.
        log.info('session-tool-called', {
          session: sessionId,
          tool: name,
          failed: result.isError === true,
        });
        return result;
      } catch (caught) {
        log.error('session-tool-failed', {
          session: sessionId,
          tool: name,
          message: caught instanceof Error ? caught.message : String(caught),
        });
        return refusal({ kind: 'internal', message: 'The companion could not handle the call.' });
      } finally {
        options.onCall?.('end');
      }
    },
  })) as McpHostTool[];
}
