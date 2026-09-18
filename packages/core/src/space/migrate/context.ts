/**
 * What the steps of one migration share, and what a migration needs from its
 * caller. Not plain data: the context holds the ports. The plain data is in
 * `types.ts`.
 *
 * Every step file under `steps/` takes a `MigrationContext` and reads what it
 * needs from it; a step's `run` writes only what its own step makes, plus its
 * ledger record through `ledger.ts`.
 */

import type { GitPort } from '../exec/git-port.js';
import type { V08Description } from '../legacy/v08-types.js';
import type { CreateSpaceContext } from '../setup/steps.js';
import type { SetupDeps, SetupRepositoryInput } from '../setup/types.js';
import type { Step } from '../steps/types.js';
import type { MigrationTargets } from './targets.js';
import type {
  MigrationFocusStage,
  MigrationIssuePlan,
  MigrationLedgerRecord,
  MigrationStepId,
} from './types.js';

/**
 * What a migration needs from its caller: the ports and folders of setup, and
 * the pause used to pace GitHub writes, which a test replaces.
 */
export type MigrationDeps = SetupDeps & {
  /** Wait `ms` milliseconds. Default: a timer. Step 11 paces its writes with it. */
  pause?: (ms: number) => Promise<void>;
  /** The clock of the ledger's records. Default the machine's. */
  now?: () => Date;
};

/** The form with every value filled: the Human Lead's, or the proposed one. */
export type MigrationSettings = {
  parentDir: string;
  name: string;
  owner: string;
  description: string;
  focusStage: MigrationFocusStage;
  private: boolean;
  /** The payload repository on GitHub, as `owner/name`. */
  payloadGitHub: string;
};

/** What the steps of one migration share. */
export type MigrationContext = {
  deps: MigrationDeps;
  git: GitPort;
  /** The v0.8 project, read with hashes. */
  source: V08Description;
  settings: MigrationSettings;
  /** The new Space's folder, absolute. */
  spaceRoot: string;
  /** The Space repository, as `owner/name`. */
  repositoryName: string;
  /** The payload repository as the Space lists it: `repos/<name>`, cloned from the source's origin. */
  payload: SetupRepositoryInput & { cloneAddress: string };
  /**
   * The context of "create a Space", for the setup steps that migration
   * reuses (step 2, and the parts of steps 3, 7, 9, 10 and 12 that setup
   * already does). It lists the payload repository, so the manifest names it.
   * Its GitHub lookups are kept, so GitHub is asked once for each.
   */
  setup: CreateSpaceContext;
  /** Every destination, Space-relative. */
  targets: MigrationTargets;
  /** The issues of step 11, in the order they are created. */
  issues: MigrationIssuePlan[];
  /**
   * The ledger's records for this source, as they were when the migration was
   * prepared. `appendMigrationLedger` adds to it as it writes.
   */
  ledger: MigrationLedgerRecord[];
};

/** One step of the migration: a step of the shared runner, with its id and its number in section 5.9. */
export type MigrationStep = Step<MigrationContext> & {
  id: MigrationStepId;
  /** 1 to 13. */
  number: number;
};
