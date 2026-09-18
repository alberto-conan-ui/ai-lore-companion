/**
 * Step 1: record the source's state. For both source repositories, the head
 * commit and the output of `git status --porcelain`, kept in the ledger for
 * the verification at the end (step 13). Phase M6.3 builds `run`.
 */

import { notBuiltYet } from '../checks.js';
import type { MigrationContext, MigrationStep } from '../context.js';
import { ledgerRecords } from '../ledger.js';

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
    run: async () => notBuiltYet(TITLE),
  };
}
