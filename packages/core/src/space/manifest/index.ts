/**
 * Reading and writing `lore/space.md`, the Space's manifest card. Owned by
 * phase M2.2. The frontmatter is read and written through `../frontmatter/`,
 * the one reader of the subset, which the Lore reader also uses.
 */

export {
  SPACE_MANIFEST_FORMAT,
  SPACE_MANIFEST_TYPE,
  type ManifestFailureKind,
  type ManifestResult,
  type SpaceManifest,
  type SpaceManifestExtra,
  type SpaceManifestGitHub,
  type SpaceManifestPublishArea,
  type SpaceManifestRepository,
  parseSpaceManifest,
  readSpaceManifest,
  serializeSpaceManifest,
  writeSpaceManifest,
} from './space-manifest.js';
