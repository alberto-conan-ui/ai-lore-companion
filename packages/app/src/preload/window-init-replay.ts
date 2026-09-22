import type { WindowInitPayload } from '../shared/ipc.js';

export type WindowInitReplay = {
  receive(payload: WindowInitPayload): void;
  subscribe(handler: (payload: WindowInitPayload) => void): () => void;
};

/** Keeps the latest window-init payload for renderer subscribers that arrive late. */
export function createWindowInitReplay(): WindowInitReplay {
  let latest: WindowInitPayload | undefined;
  const subscribers = new Set<(payload: WindowInitPayload) => void>();

  return {
    receive(payload) {
      latest = payload;
      for (const subscriber of subscribers) subscriber(payload);
    },
    subscribe(handler) {
      subscribers.add(handler);
      if (latest !== undefined) handler(latest);
      return () => {
        subscribers.delete(handler);
      };
    },
  };
}
