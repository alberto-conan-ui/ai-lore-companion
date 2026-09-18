import { existsSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Map the bare `electron` specifier to the compiled stub (emitted by
// `tsc -p tsconfig.test.json`). The module-under-test and the test must share
// one instance of the stub, so the stub is looked up in the compiled output
// that holds the importing file: walk up from the importer to the folder that
// has `test/headless/electron-stub.js`. That folder is the one the running
// tests were compiled into, whatever it is called, so a run whose output
// folder is not `dist-test` (see `AI_LORE_APP_TEST_OUT`) cannot load a second
// copy of the stub from another folder.
const STUB_REL = join('test', 'headless', 'electron-stub.js');
const FALLBACK_URL = pathToFileURL(
  resolvePath(process.cwd(), process.env.AI_LORE_APP_TEST_OUT || 'dist-test', STUB_REL),
).href;
const byFolder = new Map();

function stubUrlFor(parentURL) {
  if (!parentURL?.startsWith('file:')) return FALLBACK_URL;
  const start = dirname(fileURLToPath(parentURL));
  const known = byFolder.get(start);
  if (known) return known;
  let dir = start;
  for (;;) {
    const candidate = join(dir, STUB_REL);
    if (existsSync(candidate)) {
      const url = pathToFileURL(candidate).href;
      byFolder.set(start, url);
      return url;
    }
    const parent = dirname(dir);
    if (parent === dir) return FALLBACK_URL;
    dir = parent;
  }
}

export async function resolve(specifier, context, next) {
  if (specifier === 'electron') {
    return { url: stubUrlFor(context.parentURL), shortCircuit: true };
  }
  return next(specifier, context);
}
