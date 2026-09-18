/**
 * The companion's data folder for one desk.
 *
 * The desk's records are kept in the companion's data folder and not in the
 * Space, so that a session cannot write them. Core never finds the data folder
 * by itself: the app passes its `userData` folder in, and the check scripts
 * receive the desk folder as an argument. A different location for the desk's
 * records changes this file and nothing else.
 */

import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

/** The absolute paths of the companion's data for one desk. */
export type DeskPaths = {
  /** `<userData>/spaces/<key>/` */
  dir: string;
  /** `<userData>/spaces/<key>/desk/`, the desk's records. */
  desk: string;
  /** `<userData>/spaces/<key>/install/`, what is installed into the engine. */
  install: string;
  /** `<userData>/spaces/<key>/sessions/`, per-session generated files. */
  sessions: string;
  /** `<userData>/spaces/<key>/ui/`, layout, open documents, baselines. */
  ui: string;
};

/** The file name of each of the desk's records, inside `DeskPaths.desk`. */
export const DESK_FILES = {
  sessions: 'sessions.json',
  claims: 'claims.json',
  gateAnswers: 'gate-answers.json',
  unattendedTags: 'unattended-tags.json',
  reviewedMarks: 'reviewed-marks.json',
  sessionCloses: 'session-closes.json',
  firstSeen: 'first-seen.json',
  projectCache: 'project-cache.json',
  migration: 'migration.json',
} as const;

/** The name of one of the desk's records. */
export type DeskFileName = keyof typeof DESK_FILES;

/** `<userData>/spaces/`, under which everything 1.0 persists is kept. */
export function spacesDir(userDataDir: string): string {
  return resolve(userDataDir, 'spaces');
}

/**
 * The key of a Space's desk: the SHA-1 of the Space folder's resolved absolute
 * path, the rule the app uses for a project's data folder today. Moving the
 * Space folder therefore starts a new, empty desk.
 */
export function spaceKey(spaceRoot: string): string {
  return createHash('sha1').update(resolve(spaceRoot)).digest('hex');
}

/** The data-folder paths of the desk of the Space at `spaceRoot`. Nothing is read from disk. */
export function deskPaths(userDataDir: string, spaceRoot: string): DeskPaths {
  const dir = join(spacesDir(userDataDir), spaceKey(spaceRoot));
  return {
    dir,
    desk: join(dir, 'desk'),
    install: join(dir, 'install'),
    sessions: join(dir, 'sessions'),
    ui: join(dir, 'ui'),
  };
}

/** The path of one of the desk's records. */
export function deskFile(paths: DeskPaths, name: DeskFileName): string {
  return join(paths.desk, DESK_FILES[name]);
}
