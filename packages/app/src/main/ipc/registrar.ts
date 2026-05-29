import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import {
  type ArgsOf,
  CONTRACT,
  type InvokeKey,
  type ResOf,
  type SendKey,
} from '../../shared/ipc.js';

/**
 * The typed registrar each `main/ipc/*` module receives. `handle` / `on`
 * take a {@link CONTRACT} key and a handler whose argument tuple and return
 * type are checked against that channel's descriptor — so a handler cannot
 * drift from the renderer's view of the channel.
 */
export type Registrar = {
  /** Register a request/response (`invoke`) handler for `key`. */
  handle<K extends InvokeKey>(
    key: K,
    handler: (event: IpcMainInvokeEvent, ...args: ArgsOf<K>) => ResOf<K> | Promise<ResOf<K>>,
  ): void;
  /** Register a fire-and-forget (`send`) handler for `key`. */
  on<K extends SendKey>(key: K, handler: (event: IpcMainEvent, ...args: ArgsOf<K>) => void): void;
};

/** Build a {@link Registrar} bound to an `ipcMain`, resolving channels off the contract. */
export function makeRegistrar(ipcMain: IpcMain): Registrar {
  return {
    handle(key, handler) {
      // The contract guarantees the channel + arg/result shape; the cast is the
      // single erasure point between the typed surface and Electron's `any` API.
      ipcMain.handle(CONTRACT[key].channel, handler as never);
    },
    on(key, handler) {
      ipcMain.on(CONTRACT[key].channel, handler as never);
    },
  };
}
