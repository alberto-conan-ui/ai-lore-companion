/**
 * The Lore reader: cards, layers, the index of a folder. The public names of
 * the frontmatter subset (`../frontmatter/`, which `manifest/` also uses) reach
 * the package through this file.
 */

export type {
  ContractCard,
  ContractTarget,
  ContractWhen,
  CorpusCard,
  LoreCard,
  LoreCardKind,
  LoreCardOf,
  LoreEntry,
  LoreIndex,
  LoreIndexLine,
  LoreLayer,
  LorePart,
  LoreParts,
  LorePillar,
  LoreProblem,
  LoreProblemKind,
  MirrorCard,
  ProcessCard,
  ResolvedLore,
  VerbCard,
} from './types.js';
export {
  type FrontmatterFailureKind,
  type FrontmatterMap,
  type FrontmatterResult,
  type FrontmatterScalar,
  type FrontmatterValue,
  type LoreFrontmatter,
  type ParsedLoreFile,
  type SplitFrontmatter,
  parseFrontmatterLines,
  parseLoreFrontmatter,
  serializeLoreFrontmatter,
  splitFrontmatter,
} from '../frontmatter/index.js';
export { LORE_PARTS, LORE_PART_KIND, LORE_PILLARS, readLoreCard } from './card.js';
export { parseLoreIndex } from './index-file.js';
export { type LoreFailureKind, findLoreEntry, readLore } from './reader.js';
