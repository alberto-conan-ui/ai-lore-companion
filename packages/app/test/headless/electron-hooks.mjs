import { existsSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Map the bare `electron` and `node-pty` specifiers to their compiled stubs
// (emitted by `tsc -p tsconfig.test.json`): the real `node-pty` native module
// is built for Electron's ABI and cannot load under the plain Node the
// headless suite runs on. The module-under-test and the test must share one
// instance of a stub, so each is looked up in the compiled output that holds
// the importing file: walk up from the importer to the folder that has
// `test/headless/<file>.js`. That folder is the one the running tests were
// compiled into, whatever it is called, so a run whose output folder is not
// `dist-test` (see `AI_LORE_APP_TEST_OUT`) cannot load a second copy of a stub
// from another folder.
const STUBS = {
  electron: join('test', 'headless', 'electron-stub.js'),
  'node-pty': join('test', 'headless', 'node-pty-stub.js'),
};
const OUT_DIR = process.env.AI_LORE_APP_TEST_OUT || 'dist-test';
const byFolder = new Map();

function stubUrlFor(specifier, parentURL) {
  const rel = STUBS[specifier];
  const fallback = pathToFileURL(resolvePath(process.cwd(), OUT_DIR, rel)).href;
  if (!parentURL?.startsWith('file:')) return fallback;
  const start = dirname(fileURLToPath(parentURL));
  const key = `${specifier}:${start}`;
  const known = byFolder.get(key);
  if (known) return known;
  let dir = start;
  for (;;) {
    const candidate = join(dir, rel);
    if (existsSync(candidate)) {
      const url = pathToFileURL(candidate).href;
      byFolder.set(key, url);
      return url;
    }
    const parent = dirname(dir);
    if (parent === dir) return fallback;
    dir = parent;
  }
}

export async function resolve(specifier, context, next) {
  if (specifier === 'electron' || specifier === 'node-pty') {
    return { url: stubUrlFor(specifier, context.parentURL), shortCircuit: true };
  }
  return next(specifier, context);
}
