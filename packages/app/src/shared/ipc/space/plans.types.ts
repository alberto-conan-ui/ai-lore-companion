/**
 * Types of the channels of the Plans band (alberto-conan-ui/ai-lore-companion#34, the companion's side of
 * alberto-conan-ui/ai-lore#398). The band lists the Space's planning units, read by the Space's own tool
 * (`tools/plan/plans.py --json`), which reads GitHub only through the shared reader. Plain data only.
 */

/** How much the list can be trusted, in the tool's own words (`head` and `text` of the state carry them). */
export type SpacePlansOutcome =
  /** Every page of the read answered in full. */
  | 'complete'
  /** GitHub answered but part was not read: the list is shown as incomplete, never as the whole. */
  | 'incomplete'
  /** GitHub refused the read (a rate limit): no list. */
  | 'refused'
  /** GitHub gave no answer: no list. */
  | 'unreachable'
  /** Something other than GitHub's answer stopped the read (the tool missing, unreadable output, a timeout): no list. */
  | 'failed';

/** One row of the band: an epic, a sub-epic or a focus. */
export type SpacePlansUnit = {
  number: number;
  title: string;
  kind: 'epic' | 'sub-epic' | 'focus';
  /** How deep it nests under the units above it: 0 for a root. */
  depth: number;
  /** `null`: the Project holds no Stage for it. It is a fact, not an unread value. */
  stage: string | null;
  /** When it was last changed, in milliseconds since the epoch: the later of its issue and its Project item. `null`: not read. */
  updated: number | null;
  /** False when only one of the two times was read, so it may be older than the last change. */
  updatedExact: boolean;
  /** Whether its plan is on GitHub; false for an epic not yet moved, whose dashboard is its JSON. */
  onGitHub: boolean;
};

export type SpacePlansState = {
  /** The number of this state among those the Space's service has given; a later state is higher. */
  version: number;
  /** Whether a read is running now. */
  reading: boolean;
  /**
   * `null` before the first read ends. `unavailable`: this Space has no `tools/plan/plans.py`, so the band is not drawn.
   */
  outcome: SpacePlansOutcome | 'unavailable' | null;
  /** The rows of a `complete` or `incomplete` read; `null` for any other, and before the first read. Never a saved copy. */
  units: readonly SpacePlansUnit[] | null;
  /** When the read the rows stand on STARTED, in milliseconds; `null` when there are no rows. */
  readAt: number | null;
  /** When the last read that answered (complete or incomplete) started. Said beside a read that failed; never the rows. */
  lastReadAt: number | null;
  /** The tool's heading and plain cause for an outcome that is not `complete` (`GitHub refused`, `GitHub not reachable`...). */
  head: string;
  text: string;
  /** What an incomplete read did not read, one line each. */
  missing: readonly string[];
  /** The tool's qualification of "changes show within a minute". */
  note: string;
  /** What the tool left out of a list that is otherwise whole (other repositories' issues, issues with no Level), one line each. */
  leftOut: readonly string[];
  /** Whether this is demo data from the fake GitHub: the band says so, and never offers it as this Space's plans. */
  demo: boolean;
};

export type SpacePlansArg = Record<string, never>;

export type SpacePlansOpenArg = { number: number };

export type SpacePlansFailure = {
  kind: 'invalid-argument' | 'not-a-space-window';
  message: string;
};

export type SpacePlansStateResult =
  | { ok: true; value: SpacePlansState }
  | { ok: false; error: SpacePlansFailure };

/** The answer to opening a row: the dashboard to open, or why it cannot be. `message` can be shown as it is. */
export type SpacePlansOpenResult =
  | { ok: true; url: string; startedServer: boolean }
  | {
      ok: false;
      error: {
        kind:
          | 'invalid-argument'
          | 'not-a-space-window'
          | 'not-listed'
          | 'server-not-started'
          | 'not-opened';
        message: string;
      };
    };
