/**
 * Step 6: each project contract file becomes one card `lore/contracts/<name>.md`
 * with frontmatter, rule only, with its line in the part's index. A file that
 * holds several contracts as sections (`contracts.spec.md`) becomes one card
 * (section 10.1, question 16). Done when every card is there and listed.
 * Phase M6.3 builds `run`.
 */

import { basename, dirname } from 'node:path';
import { indexListsFile } from '../../setup/lore-writes.js';
import { inSpace, isFile, notBuiltYet } from '../checks.js';
import type { MigrationStep } from '../context.js';

const TITLE = "Carry the project's contracts";

/** Step 6. */
export function contractsStep(): MigrationStep {
  return {
    id: 'contracts',
    number: 6,
    title: TITLE,
    describe: async (ctx) =>
      ctx.targets.contracts.map((card) => {
        const contract = ctx.source.contracts.find((candidate) => candidate.path === card.from);
        const several =
          contract?.holdsSeveral === true
            ? ` The file holds ${contract.sections.length} contracts as sections; they stay together in one card.`
            : '';
        return {
          what: `Write the contract card "${card.name}", rule only, with frontmatter and its line in the contracts' index.${several}`,
          from: card.from,
          to: card.to,
        };
      }),
    isDone: async (ctx) => {
      for (const card of ctx.targets.contracts) {
        const path = inSpace(ctx, card.to);
        if (!(await isFile(path))) return false;
        if (!(await indexListsFile(dirname(path), basename(path)))) return false;
      }
      return true;
    },
    run: async () => notBuiltYet(TITLE),
  };
}
