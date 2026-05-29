import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

// Map the bare `electron` specifier to the compiled stub (emitted by
// `tsc -p tsconfig.test.json`). The path must match how the test files import
// `./electron-stub.js` so the module-under-test and the test share one instance.
const STUB_URL = pathToFileURL(
  resolvePath(process.cwd(), 'dist-test/test/headless/electron-stub.js'),
).href;

export async function resolve(specifier, context, next) {
  if (specifier === 'electron') {
    return { url: STUB_URL, shortCircuit: true };
  }
  return next(specifier, context);
}
