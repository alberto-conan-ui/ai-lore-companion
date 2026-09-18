/**
 * Step 6: each project contract file becomes one card `lore/contracts/<name>.md`
 * with frontmatter, rule only, with its line in the part's index. A file that
 * holds several contracts as sections (`contracts.spec.md`) becomes one card
 * (section 10.1, question 16). Done when every card is there and listed.
 * Phase M6.3 builds `run`.
 */

import { basename, dirname } from 'node:path';
import { serializeLoreFrontmatter } from '../../frontmatter/index.js';
import { writeFileAtomic } from '../../fs/atomic-write.js';
import type { V08Contract } from '../../legacy/v08-types.js';
import { type Result, fail, ok } from '../../result.js';
import { addIndexLine, indexListsFile } from '../../setup/lore-writes.js';
import type { StepError } from '../../steps/types.js';
import { inSpace, isFile } from '../checks.js';
import type { MigrationContext, MigrationStep } from '../context.js';
import { type RewrittenText, describeChanges, rewriteLinks } from '../local/links.js';
import { recordStepDone, stepStopped } from '../local/record.js';
import { type ContractCard, archivedPath, loreRelative } from '../targets.js';

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
    run: async (ctx) => {
      const created: string[] = [];
      for (const card of ctx.targets.contracts) {
        const contract = ctx.source.contracts.find((candidate) => candidate.path === card.from);
        if (contract === undefined) continue;
        const path = inSpace(ctx, card.to);
        created.push(card.to);
        // A card that is there is kept as it is: it is this migration's own, or the Human Lead's.
        if (!(await isFile(path))) {
          const text = await contractCardText(ctx, card, contract);
          if (!text.ok) return stepStopped(text.error.kind, TITLE, text.error.message);
          const written = await writeFileAtomic(path, text.value.text);
          if (!written.ok) return stepStopped(written.error.kind, TITLE, written.error.message);
          created.push(...describeChanges(card.to, text.value.changes));
        }
        const listed = await addIndexLine(
          dirname(path),
          basename(path),
          `the contract ${card.name}, carried from the v0.8 project, rule only.`,
        );
        if (!listed.ok) return stepStopped(listed.error.kind, TITLE, listed.error.message);
      }
      return recordStepDone(ctx, 'contracts', created);
    },
  };
}

/**
 * The card of one v0.8 contract file: frontmatter within the subset, the rule
 * as the v0.8 file gives it, and nothing else. The v0.8 project's contracts
 * guard its payload and have no check script. A link in the rule that would
 * not resolve from the card is rewritten to the carried file, or set as
 * inline code when the file is carried nowhere.
 */
async function contractCardText(
  ctx: MigrationContext,
  card: ContractCard,
  contract: V08Contract,
): Promise<Result<RewrittenText, StepError>> {
  const head = serializeLoreFrontmatter({
    type: 'contract',
    name: card.name,
    pillar: 'producing',
    target: 'payload',
    check: null,
    when: null,
  });
  if (!head.ok) return fail('lore-write-failed', head.error.message);
  const rule = await rewriteLinks(
    ctx,
    contract.rule.trim(),
    { from: card.from, to: card.to },
    'code',
  );
  const archived = archivedPath(ctx.source, card.from);
  const origin = `The migration from AI-Lore v0.8 carried this card from the file \`${archived}\` of the archive, which is the v0.8 project's \`${loreRelative(ctx.source, card.from)}\`.`;
  const onlyRule =
    'It has only a rule. It has no check script, so nothing refuses a write that breaks it. A session treats it as advice that it can be asked to justify, and not as something that is enforced.';
  const lines = ['---', head.value, '---', '', `# ${card.name}`, ''];
  if (contract.holdsSeveral) {
    lines.push(
      `${origin} The v0.8 file holds ${contract.sections.length} contracts, one per section below, and they are kept together in this card. Their target is the payload. They have only a rule. They have no check script, so nothing refuses a write that breaks them. A session treats them as advice that it can be asked to justify, and not as something that is enforced.`,
      '',
      rule.text,
      '',
    );
  } else {
    lines.push(
      `${origin} Its target is the payload. ${onlyRule}`,
      '',
      '## The rule',
      '',
      rule.text,
      '',
    );
  }
  return ok({ text: lines.join('\n'), changes: rule.changes });
}
