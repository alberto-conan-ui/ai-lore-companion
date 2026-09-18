/**
 * Step 1: record the source's state. For both source repositories, the head
 * commit and the output of `git status --porcelain`, kept in the ledger for
 * the verification at the end (step 13). Phase M6.3 builds `run`.
 */

import type { V08Repository } from '../../legacy/v08-types.js';
import type { MigrationContext, MigrationStep } from '../context.js';
import { appendMigrationLedger, ledgerRecords } from '../ledger.js';
import { recordStepDone, stepStopped } from '../local/record.js';
import type { MigrationRepositoryState } from '../types.js';

const TITLE = "Record the source's state";

function describeRepository(
  label: string,
  repository: MigrationContext['source']['payloadRepository'],
): { what: string; from: string; count: number } {
  const state = repository.present
    ? `at ${repository.head ?? 'no commit'}, with ${repository.changedCount} uncommitted change${repository.changedCount === 1 ? '' : 's'}`
    : 'which is not a git repository of its own';
  return {
    what: `Record the head commit and git status of the ${label}, ${state}.`,
    from: repository.path,
    count: repository.changedCount,
  };
}

/** Step 1. */
export function recordSourceStep(): MigrationStep {
  return {
    id: 'record-source',
    number: 1,
    title: TITLE,
    describe: async (ctx) => [
      describeRepository('payload repository', ctx.source.payloadRepository),
      describeRepository('Lore repository', ctx.source.loreRepository),
      { what: "Keep both in the migration's ledger, for the verification at the end." },
    ],
    // What step 1 makes is its record, so the ledger is the state it asks.
    isDone: async (ctx) => ledgerRecords(ctx, 'source-state').length > 0,
    run: async (ctx) => {
      // The head and status the reader took moments ago, with read-only git
      // commands, when the migration was prepared. Nothing is asked of the
      // source again, so the source is not touched by this step.
      if (ledgerRecords(ctx, 'source-state').length === 0) {
        const state = (repository: V08Repository): MigrationRepositoryState => ({
          path: repository.path,
          head: repository.head,
          statusText: repository.statusText,
        });
        const recorded = appendMigrationLedger(ctx, {
          kind: 'source-state',
          payload: state(ctx.source.payloadRepository),
          lore: state(ctx.source.loreRepository),
        });
        if (!recorded.ok) return stepStopped(recorded.error.kind, TITLE, recorded.error.message);
      }
      return recordStepDone(ctx, 'record-source', [
        `${ctx.source.payloadRepository.path} at ${ctx.source.payloadRepository.head ?? 'no commit'}`,
        `${ctx.source.loreRepository.path} at ${ctx.source.loreRepository.head ?? 'no commit'}`,
      ]);
    },
  };
}
