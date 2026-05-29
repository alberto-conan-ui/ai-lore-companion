/**
 * The search `utilityProcess` entry (Focus 3 Phase 2). Owns a {@link PathIndex}
 * in a child process so the build walk and per-keystroke ranking run off the
 * main thread — a large-repo search never blocks IPC or the UI.
 *
 * Bundled as a second main-process entry by `electron.vite.config.ts`; its
 * sibling {@link WorkerSearchService} (in `main/search/service.ts`) forks it and
 * speaks the {@link WorkerRequest}/{@link WorkerResponse} protocol over the
 * `parentPort`. The orchestration here is identical to the in-process path —
 * `ensureBuilt` then `search` — because the index is the same pure-data class.
 */
import { PathIndex } from '@ai-lore-companion/core';
import type { MessageEvent } from 'electron';
import type { WorkerRequest, WorkerResponse } from './search/service.js';

const index = new PathIndex();

function post(msg: WorkerResponse): void {
  process.parentPort.postMessage(msg);
}

process.parentPort.on('message', (event: MessageEvent) => {
  const msg = event.data as WorkerRequest;
  switch (msg.type) {
    case 'search': {
      index.ensureBuilt(msg.dirs, msg.ignore);
      const hits = index.search(msg.query, msg.limit).map(({ name, path }) => ({ name, path }));
      post({ type: 'result', id: msg.id, hits });
      break;
    }
    case 'add':
      index.add(msg.path);
      break;
    case 'remove':
      index.remove(msg.path);
      break;
    case 'invalidate':
      index.clear();
      break;
  }
});

// Tell the parent the child is listening, so it can flush any queued messages.
post({ type: 'ready' });
