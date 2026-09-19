/** The v0.8 reader (phase M6.1): reads an AI-Lore v0.8 project for migration. It never writes. */

export {
  V08_ARCHIVE_ROOTS,
  V08_ARCHIVE_TOP_FILES,
  V08_READ_DEFAULTS,
  type V08ReadDeps,
  categoryOf as v08CategoryOf,
  readV08Project,
} from './v08-reader.js';
export {
  V08_FRONTMATTER_MAX_BYTES,
  type V08Body,
  type V08Frontmatter,
  type V08ParsedDocument,
  type V08StackRow,
  findV08Handover,
  mirrorProse,
  normaliseV08Status,
  parseV08Document,
  parseV08Stack,
  readV08BacklogEntries,
  splitV08Body,
} from './v08-markdown.js';
export type * from './v08-types.js';
