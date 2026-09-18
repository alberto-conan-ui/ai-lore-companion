/**
 * The frontmatter subset of the Lore: its one reader and its one writer.
 * `lore/` and `manifest/` both use this folder. Its public names reach the
 * package through `lore/index.ts`.
 */

export type {
  FrontmatterMap,
  FrontmatterScalar,
  FrontmatterValue,
  LoreFrontmatter,
} from './types.js';
export {
  type FrontmatterFailureKind,
  type FrontmatterResult,
  type ParsedLoreFile,
  type SplitFrontmatter,
  parseFrontmatterLines,
  parseLoreFrontmatter,
  serializeLoreFrontmatter,
  splitFrontmatter,
} from './frontmatter-subset.js';
