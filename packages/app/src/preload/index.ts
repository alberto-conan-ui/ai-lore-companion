import { contextBridge, ipcRenderer } from 'electron';
import { CONTRACT, type CockpitApi } from '../shared/ipc.js';

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
