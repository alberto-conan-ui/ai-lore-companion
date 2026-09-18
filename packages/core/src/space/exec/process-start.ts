/**
 * When a process started, as the operating system recorded it.
 *
 * The desk's owner file names a process by its id and its start time. A process
 * id is given out again after its process ends, so the id alone does not say
 * whether the process that wrote the file still runs. The start time that the
 * operating system keeps for a process is fixed when the process is created and
 * does not move when the clock is changed, so it is read here and not computed
 * from the clock.
 *
 * This is the one place outside `exec-file-runner.ts` that starts a process.
 * It is synchronous because opening a desk is synchronous, it starts `ps` with
 * an argument list and no shell, and `ps` only reads.
 */

import { execFileSync } from 'node:child_process';

const PS_TIMEOUT_MS = 2000;

/**
 * When the process `pid` started, ISO 8601 to the second, or `null` when the
 * operating system does not say: no such process, no `ps`, or a platform other
 * than macOS. On macOS the kernel stores the time once, at the start of the
 * process. On Linux `ps` computes it from the boot time, which moves with the
 * clock, so it is not used there.
 */
export function readProcessStartedAt(pid: number): string | null {
  if (process.platform !== 'darwin' || !Number.isInteger(pid) || pid <= 0) return null;
  try {
    const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: PS_TIMEOUT_MS,
    });
    const time = Date.parse(`${out.trim()} UTC`);
    return Number.isNaN(time) ? null : new Date(time).toISOString();
  } catch {
    return null;
  }
}
