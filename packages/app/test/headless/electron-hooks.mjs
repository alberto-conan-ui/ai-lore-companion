import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

// Map the bare `electron` specifier to the compiled stub (emitted by
// `tsc -p tsconfig.test.json`). The path must match how the test files import
// `./electron-stub.js` so the module-under-test and the test share one instance.
// `AI_LORE_APP_TEST_OUT` (a path relative to `packages/app`) moves the compiled
// output, so two runs at the same time do not delete each other's files.
const OUT_DIR = process.env.AI_LORE_APP_TEST_OUT || 'dist-test';
const STUB_URL = pathToFileURL(
  resolvePath(process.cwd(), OUT_DIR, 'test/headless/electron-stub.js'),
).href;

export async function resolve(specifier, context, next) {
  if (specifier === 'electron') {
    return { url: STUB_URL, shortCircuit: true };
  }
  return next(specifier, context);
}
