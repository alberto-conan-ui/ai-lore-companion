import { register } from 'node:module';

// Install the `electron` → stub resolve hook for the headless run. Passed to
// `node --import`; a no-op for the electron-free modules (they never import it).
register('./electron-hooks.mjs', import.meta.url);
