import { contextBridge, ipcRenderer } from 'electron';
import { CONTRACT, type CockpitApi, type WindowInitPayload } from '../shared/ipc.js';
import { createWindowInitReplay } from './window-init-replay.js';

const windowInitReplay = createWindowInitReplay();
const windowInitChannel = CONTRACT.onWindowInit.channel;
ipcRenderer.on(windowInitChannel, (_event, payload: WindowInitPayload) => {
  windowInitReplay.receive(payload);
});

/**
 * The renderer bridge is **generated** from the IPC contract — one entry per
 * channel, no per-method boilerplate. Each descriptor's `kind` decides the
 * wiring:
 *
 * - `invoke` → `ipcRenderer.invoke(channel, ...args)` (returns a Promise)
 * - `send`   → `ipcRenderer.send(channel, ...args)` (fire-and-forget)
 * - `push`   → `ipcRenderer.on(channel, …)` with an unsubscribe return
 *
 * Adding a channel to `CONTRACT` adds it here automatically.
 */
const api = Object.fromEntries(
  Object.entries(CONTRACT).map(([method, desc]) => {
    if (method === 'onWindowInit') {
      return [
        method,
        (handler: (payload: WindowInitPayload) => void) => windowInitReplay.subscribe(handler),
      ];
    }
    if (desc.kind === 'invoke') {
      return [method, (...args: unknown[]) => ipcRenderer.invoke(desc.channel, ...args)];
    }
    if (desc.kind === 'send') {
      return [method, (...args: unknown[]) => ipcRenderer.send(desc.channel, ...args)];
    }
    // push — subscribe; return an unsubscribe.
    return [
      method,
      (handler: (payload: unknown) => void) => {
        const listener = (_event: unknown, payload: unknown): void => handler(payload);
        ipcRenderer.on(desc.channel, listener);
        return () => ipcRenderer.removeListener(desc.channel, listener);
      },
    ];
  }),
) as unknown as CockpitApi;

contextBridge.exposeInMainWorld('cockpit', api);
// Bridge the e2e flag so the renderer can expose test-only affordances (e.g. the
// Dockview API for the drag-invariant spec). Off for real users.
contextBridge.exposeInMainWorld('cockpitE2E', process.env.COCKPIT_E2E === '1');
