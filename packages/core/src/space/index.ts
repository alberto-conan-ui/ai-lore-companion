/**
 * The 1.0 library: everything under `core/src/space`, re-exported by folder.
 *
 * Created once in M2.1 with every planned folder, so that a later phase fills
 * its own folder's `index.ts` and does not edit this file. A folder whose
 * `index.ts` is still empty belongs to the first phase the architecture
 * document lists for it.
 *
 * `./testing/` is not re-exported here. The app loads this barrel in
 * production, so the fixture builders have their own entry of the package,
 * `@ai-lore-companion/core/testing`, which only tests import.
 */

export * from './result.js';
export * from './exec/index.js';
export * from './fs/index.js';
export * from './layout/index.js';
export * from './manifest/index.js';
export * from './detect/index.js';
export * from './lore/index.js';
export * from './desk/index.js';
export * from './roots/index.js';
export * from './baseline/index.js';
export * from './github/index.js';
export * from './machine/index.js';
export * from './steps/index.js';
export * from './setup/index.js';
export * from './install/index.js';
export * from './claims/index.js';
export * from './project/index.js';
export * from './legacy/index.js';
export * from './migrate/index.js';
