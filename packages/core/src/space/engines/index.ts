/**
 * The engine catalog (phase M9.3): the four AI engines the companion knows
 * about, and how the Human Lead's stored engine list is merged with them.
 */

export {
  ENGINE_CATALOG,
  type EngineCatalogEntry,
  type EngineCatalogId,
  type EngineSignInCheck,
  canRunGuardedSession,
  catalogEntryById,
  catalogEntryFor,
  isCatalogEngineId,
} from './catalog.js';
export { mergeEnginesWithCatalog } from './merge.js';
export {
  type Profile,
  engineNameOf,
  entryOf,
  profileById,
  profileOf,
} from './profiles.js';
