import { register } from 'node:module';

// Install the `electron` and `node-pty` → stub resolve hook for the headless
// run. Passed to `node --import`; a no-op for a module that imports neither.
register('./electron-hooks.mjs', import.meta.url);
