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

import { z } from 'zod';
import type { McpHostTool, McpHostToolResult } from '../../helper/mcp-host.js';
import type { SpaceLog } from '../log.js';
import type { BrokerFailure, SessionPort } from './broker.js';
import {
  AWAIT_ANSWER_WAIT_MS,
  MAX_CALLS_PER_WINDOW,
  MAX_TARGETS_PER_REQUEST,
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
] as const;

export type SessionToolName = (typeof SESSION_TOOL_NAMES)[number];

const text = z.string().min(1).max(MAX_TEXT_LENGTH);

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
} satisfies Record<SessionToolName, z.ZodRawShape>;

const DESCRIPTIONS: Record<SessionToolName, string> = {
  request_writing:
    'Ask the Human Lead for the entering-Writing dialog. Returns { "ticket" } at once. Then call await_answer with the ticket.',
  request_gate:
    'Ask the Human Lead the question of a gate in a companion dialog. Returns { "ticket" } at once. Then call await_answer with the ticket.',
  await_answer:
    'Wait for the answer to a ticket. Returns the answer, or { "status": "pending" } when the Human Lead has not answered yet: call it again.',
  leave_writing:
    'Return the session to Read only. The companion releases every write target the session holds. Takes no arguments.',
};

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

  const run: {
    [K in SessionToolName]: (
      args: Record<string, unknown>,
      extra: { signal: AbortSignal },
    ) => McpHostToolResult | Promise<McpHostToolResult>;
  } = {
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
  };

  return SESSION_TOOL_NAMES.map((name) => ({
    name,
    description: DESCRIPTIONS[name],
    shape: SHAPES[name],
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
  }));
}
