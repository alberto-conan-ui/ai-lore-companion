/**
 * Types of the 1.0 windows: what each new window mode carries when main tells
 * a window what it is, and the arguments and results of the window channels
 * (`./windows.contract.ts`). Owned by phase M3.5.
 *
 * Everything here is plain data. Types from core are imported as types only.
 */

import type {
  LegacyManifestLocation,
  LegacyVersionStanding,
  SpaceManifest,
} from '@ai-lore-companion/core';

/** A Space the Human Lead has opened: an entry of the recents of Spaces. */
export type RecentSpace = {
  /** The Space's folder. */
  path: string;
  /** The Space's name from its manifest, as it was when the Space was last opened. */
  name: string;
  /** When it was last opened, in milliseconds since the epoch. */
  openedAt: number;
};

/** What a window holds about the Space it shows. */
export type SpaceSummary = {
  /** The Space's folder, resolved. */
  root: string;
  /** The key of the Space's desk under `<userData>/spaces/`. */
  key: string;
  /** The Space's name. Empty when setup has not named it yet. */
  name: string;
  /** The manifest as detection read it from `lore/space.md`. */
  manifest: SpaceManifest;
};

/** What the migration screen is told about the AI-Lore project of v0.8 or older it was opened on. */
export type LegacySummary = {
  projectName: string;
  /** The `.ai-lore-<name>` folder. */
  lorePath: string;
  /** The text of `core_version`, or `null` when the manifest has none. */
  coreVersion: string | null;
  manifestLocation: LegacyManifestLocation;
  /** True when `coreVersion` is `0.8` or a `0.8.x`. */
  migratable: boolean;
  /** Where the version stands against v0.8; `older` is the "upgrade to v0.8 first" state. */
  versionStanding: LegacyVersionStanding;
  /** Detection's sentence for the Human Lead. */
  reason: string;
};

/** How the create-a-Space screens were started. */
export type SetupStart =
  /** A new Space, from the welcome screen. */
  | { kind: 'new' }
  /** A Space opened from its GitHub address, from the welcome screen. */
  | { kind: 'from-address' }
  /** A Space about a plain repository, from the not-a-Space screen. Main fills both fields. */
  | { kind: 'about-repository'; folder: string; originUrl: string | null }
  /** A Space about a repository chosen on the form, from the welcome screen. */
  | { kind: 'from-repository' };

/** A section of Set up this computer that a fix or a link opens on. */
export type MachineSection = 'tools' | 'github' | 'engines' | 'spaces-folder';

/** What the Files window opens on when it is shown. */
export type OpenInFiles = {
  /** The id of the root to select. */
  rootId: string;
  /** A file inside that root, relative to it, with `/`. */
  relPath?: string;
};

/**
 * The window modes 1.0 adds to `WindowInitPayload`. `space-welcome` is sent
 * where `welcome` is sent today, and only when detection routing is on.
 */
export type SpaceWindowInitPayload =
  | { mode: 'space-welcome'; recents: RecentSpace[]; notice?: string; checkOnLaunch?: boolean }
  | { mode: 'machine-check'; section?: MachineSection }
  | { mode: 'setup'; start: SetupStart }
  | { mode: 'migration'; folder: string; legacy: LegacySummary }
  | { mode: 'not-a-space'; folder: string; plainRepository: boolean; reason: string }
  | {
      mode: 'space';
      space: SpaceSummary;
      justCreated?: boolean;
      colorScheme?: string;
      spaceTitle?: string;
    }
  | {
      mode: 'space-files';
      space: SpaceSummary;
      open?: OpenInFiles;
      colorScheme?: string;
      spaceTitle?: string;
    };

/** The name of a 1.0 window mode. */
export type SpaceWindowMode = SpaceWindowInitPayload['mode'];

/** The payload of one 1.0 window mode; what the screen of that mode receives as `init`. */
export type SpaceInitOf<M extends SpaceWindowMode> = Extract<SpaceWindowInitPayload, { mode: M }>;

/**
 * Every 1.0 window mode. The renderer uses it to tell a 1.0 payload from a
 * v0.8 one; a headless test checks it against `SpaceWindowMode`.
 */
export const SPACE_WINDOW_MODES = [
  'space-welcome',
  'machine-check',
  'setup',
  'migration',
  'not-a-space',
  'space',
  'space-files',
] as const satisfies readonly SpaceWindowMode[];

/** Whether a window mode is one of the 1.0 modes. */
export function isSpaceWindowMode(mode: string): mode is SpaceWindowMode {
  return (SPACE_WINDOW_MODES as readonly string[]).includes(mode);
}

/** Whether a window-init payload is one of the 1.0 payloads. */
export function isSpaceWindowInit<P extends { mode: string }>(
  payload: P,
): payload is Extract<P, { mode: SpaceWindowMode }> {
  return isSpaceWindowMode(payload.mode);
}

/** Why a window channel did nothing. `message` can be shown to the Human Lead. */
export type SpaceWindowFailure = {
  kind:
    | 'invalid-argument'
    | 'not-a-space-window'
    | 'not-allowed-here'
    | 'not-a-folder'
    | 'folder-unreadable'
    | 'cancelled';
  message: string;
};

/** The result of a window channel: the mode the window now shows, or why nothing happened. */
export type SpaceWindowResult =
  | { ok: true; value: { mode: SpaceWindowMode | 'cockpit' } }
  | { ok: false; error: SpaceWindowFailure };

/**
 * Argument of `spaceOpenFolder`. With no `folder`, main asks for one with the
 * system's folder dialog. A `folder` is accepted only when it is in the
 * recents of Spaces; main opens no other path on the renderer's word.
 */
export type SpaceOpenFolderArg = { folder?: string };

/** Argument of `spaceNavigate`: the screen to show next. */
export type SpaceNavigateArg =
  | { to: 'space-welcome' }
  /** From a window of a Space, this opens or brings forward the Set up this computer window. */
  | { to: 'machine-check'; section?: MachineSection }
  /** `about-this-folder` is accepted only from the not-a-Space screen of a plain repository. */
  | { to: 'setup'; start: 'new' | 'from-address' | 'about-this-folder' | 'from-repository' }
  /** Accepted only from a window of a Space. Opens the Files window of that Space, or shows it. */
  | { to: 'space-files'; open?: OpenInFiles };

/** Argument of `spaceRecentsRemove`. */
export type SpaceRecentsRemoveArg = { path: string };
