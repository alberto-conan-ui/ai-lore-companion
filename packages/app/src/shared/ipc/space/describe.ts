/**
 * The three descriptor builders a 1.0 contract fragment uses. They build the
 * same values as the builders inside `../contract.ts`, which that file keeps
 * to itself. A fragment cannot import them from `../contract.ts`, because
 * `../contract.ts` imports the fragments; this file imports types only from
 * it, so no module waits for another at load time.
 *
 * Rules for every 1.0 channel (architecture document, section 5.1): the method
 * name starts with `space`, or with `onSpace` for a push; the channel string
 * starts with `space:`; the arguments are one object; the handler in main
 * validates that object with a zod schema before it uses it.
 *
 * This file is bundled into the preload script, which runs in a sandbox. It
 * imports nothing at run time, and a fragment does the same.
 */

import type { InvokeDesc, PushDesc, SendDesc } from '../contract.js';

/** The start of every 1.0 channel string. */
export const SPACE_CHANNEL_PREFIX = 'space:';

/** A renderer to main request with a response. `A` is the argument tuple, one object by rule. */
export const invoke = <A extends unknown[], R>(channel: string): InvokeDesc<A, R> => ({
  kind: 'invoke',
  channel,
});

/** A renderer to main message with no response. */
export const send = <A extends unknown[]>(channel: string): SendDesc<A> => ({
  kind: 'send',
  channel,
});

/** A main to renderer subscription. `P` is the pushed payload. */
export const push = <P>(channel: string): PushDesc<P> => ({ kind: 'push', channel });
