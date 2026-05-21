import { resolve } from 'node:path';

/**
 * Resolve the project root this launch was pointed at, or `null` when none was
 * given — a bare launch opens the welcome window.
 *
 * Precedence: --root flag → COCKPIT_ROOT env → positional path.
 *
 * `argvStart` is the index of the first *user* argument: argv[0] is always the
 * runtime, and an unpackaged launch (`process.defaultApp`) puts the app's own
 * entry — `.` in dev, the absolute `index.js` path in a build — at argv[1].
 * Both must be skipped, or the app treats its own main script as a project.
 *
 * The positional path must look like a real filesystem path (contains a `/`).
 */
export function resolveProjectRoot(
  argv: readonly string[],
  argvStart: number = process.defaultApp ? 2 : 1,
): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') {
      const value = argv[i + 1];
      if (value) return resolve(value);
    } else if (argv[i]?.startsWith('--root=')) {
      const value = argv[i]?.slice('--root='.length);
      if (value) return resolve(value);
    }
  }

  if (process.env.COCKPIT_ROOT) return resolve(process.env.COCKPIT_ROOT);

  const positional = argv.find(
    (a, i) =>
      i >= argvStart &&
      !a.startsWith('--') &&
      !argv[i - 1]?.startsWith('--root') &&
      a.includes('/') &&
      a !== '.',
  );
  if (positional) return resolve(positional);

  return null;
}
