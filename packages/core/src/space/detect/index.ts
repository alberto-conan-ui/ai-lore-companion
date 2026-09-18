/** Detection: what kind of folder was opened, with the reason. Owned by phase M2.2. */

export {
  LEGACY_LORE_PREFIX,
  LEGACY_MANIFEST_LOCATIONS,
  type DetectDeps,
  type DetectFailureKind,
  type FolderKind,
  type LegacyManifestLocation,
  type LegacyVersionStanding,
  detectFolder,
  isMigratableCoreVersion,
  legacyVersionStanding,
} from './detect-folder.js';
