/**
 * The shapes of the Lore reader: the five kinds of card, a resolved entry, a
 * reported problem, the resolved Lore.
 *
 * This file imports nothing, so the renderer can take every type here with
 * `import type` and pull no Node code. Everything is plain data (no `Map`, no
 * class instance), so a resolved Lore crosses IPC as it is. The types of the
 * frontmatter subset are in `../frontmatter/types.ts`, which imports nothing
 * either.
 *
 * The keys of each kind are fixed by the template's corpus entry "card"
 * (`packages/spec/lore-1.0/lore/corpus/core/card.md`). Where that entry and the
 * architecture document differ, the entry governs: `invoked_by` is a list, a
 * contract may name one payload, and a mirror's skeleton is a list of lines.
 */

/** The five parts of the Lore. Each is a folder under `lore/` and holds one kind of card. */
export type LorePart = 'corpus' | 'verbs' | 'processes' | 'contracts' | 'mirrors';

/** Where a card's file is inside its part: in `core/`, in `default/`, or beside the two. */
export type LoreLayer = 'core' | 'default' | 'own';

/** The five pillars. A verb, a process and a contract each name one. */
export type LorePillar = 'specifying' | 'planning' | 'working' | 'producing' | 'shaping';

/** The value of the key `type` in a card's frontmatter. */
export type LoreCardKind = 'corpus' | 'verb' | 'process' | 'contract' | 'mirror';

/** What a contract guards (the key `target`). */
export type ContractTarget = 'everything' | 'lore' | 'journal' | 'plan' | 'payload';

/** When a contract's check runs in relation to a write (the key `when`). */
export type ContractWhen = 'before' | 'after' | 'both';

/** A corpus entry. `pointsAt` holds Space-relative paths (with an optional `#section`) and `https://` addresses. */
export type CorpusCard = { kind: 'corpus'; term: string; pointsAt: string[] };

/** A verb. `invokedBy` holds `human-lead`, `ai-session` or the name of a process. */
export type VerbCard = {
  kind: 'verb';
  name: string;
  pillar: LorePillar;
  mode: 'read-only' | 'writing';
  invokedBy: string[];
};

/** A process. Every item of `gates` is also an item of `steps`. */
export type ProcessCard = {
  kind: 'process';
  name: string;
  pillar: LorePillar;
  steps: string[];
  gates: string[];
  unattended: boolean;
};

/**
 * A contract. `payload` is the one payload it guards, or `null` (every payload,
 * or a target that is not a payload). `check` is the Space-relative path of the
 * check script, or `null` for a contract that has only a rule; `when` is `null`
 * exactly when `check` is.
 */
export type ContractCard = {
  kind: 'contract';
  name: string;
  pillar: LorePillar;
  target: ContractTarget;
  payload: string | null;
  check: string | null;
  when: ContractWhen | null;
};

/** A mirror. `generator` is a Space-relative path; `skeleton` is the stored skeleton, one item per line. */
export type MirrorCard = {
  kind: 'mirror';
  payload: string;
  generator: string;
  skeleton: string[];
};

/** A card of any of the five kinds. */
export type LoreCard = CorpusCard | VerbCard | ProcessCard | ContractCard | MirrorCard;

/** The kind of card that each part holds. */
export type LoreCardOf = {
  corpus: CorpusCard;
  verbs: VerbCard;
  processes: ProcessCard;
  contracts: ContractCard;
  mirrors: MirrorCard;
};

/** One card of the Lore, read from its file, with where it was found. */
export type LoreEntry<C extends LoreCard = LoreCard> = {
  /** The card's frontmatter, as typed fields. */
  card: C;
  /** The part whose folder holds the file. */
  part: LorePart;
  /** The layer the file is in. */
  layer: LoreLayer;
  /** The file's name without `.md`. Cards are resolved by this name inside their part. */
  name: string;
  /** The absolute path of the card's file. */
  path: string;
  /**
   * The sentence of the card's line in the index of its folder, or `null` when
   * the index has no line for it. Frontmatter has no description key; the
   * install step writes this sentence into the skill it generates.
   */
  description: string | null;
  /** True for an own card whose file has the name of a file in `default/`. */
  replacesDefault: boolean;
  /**
   * The absolute path of the script that the card's frontmatter names: the
   * check script of a contract (`check`), the skeleton generator of a mirror
   * (`generator`). `null` for a card that names none, and for a path that is
   * not a file inside the Lore folder, which is also reported as a problem.
   */
  script: string | null;
};

/** The kinds of problem the reader reports. */
export type LoreProblemKind =
  /** A file or a folder could not be read, or a file is not UTF-8 text. */
  | 'unreadable'
  /** A symbolic link that points outside the Lore folder, or to a folder. It was not followed. */
  | 'symlink'
  /** A part's folder is missing. */
  | 'part-missing'
  /** A folder has no `index.md`. */
  | 'index-missing'
  /** A line of an index that begins with `- ` and does not have the form of an index line. */
  | 'index-line'
  /** A child of the folder has no line in the folder's index. */
  | 'index-omits'
  /** An index lists a name that is not in its folder. */
  | 'index-over-lists'
  /** An index lists a name more than once. */
  | 'index-duplicate'
  /** A file has no frontmatter, or its frontmatter is outside the subset. The card was not used. */
  | 'frontmatter'
  /** The frontmatter parses and does not have the keys and values of its kind. The card was not used. */
  | 'card'
  /** A file outside `core/` has the name of a file in `core/` of the same part. It was not used. */
  | 'core-name-taken'
  /** A contract's `check` or a mirror's `generator` is not a file inside the Lore folder. The card is still used. */
  | 'script-missing';

/** Something wrong in the Lore, returned as data. `message` is a sentence that can be shown as it is. */
export type LoreProblem = {
  kind: LoreProblemKind;
  /** The absolute path of the file or folder the problem is about. */
  path: string;
  message: string;
};

/** The cards in use in each part, after layer resolution, sorted by name. */
export type LoreParts = { [P in LorePart]: LoreEntry<LoreCardOf[P]>[] };

/** What `readLore` returns: the cards in use, the defaults that were replaced, and every problem found. */
export type ResolvedLore = {
  /** The absolute path of the Space's folder. */
  spaceRoot: string;
  /** The absolute path of the Lore folder, `<space>/lore`. */
  loreDir: string;
  /** The cards in use: every core card, every own card, and every default that no own card replaces. */
  parts: LoreParts;
  /** The default cards that an own card of the same name replaces. They are not in `parts`. */
  replaced: LoreEntry[];
  /** Everything wrong that was found. The rest of the Lore was still read. */
  problems: LoreProblem[];
};

/** One line of an index: a file or a subfolder of the index's folder, and what it is for. */
export type LoreIndexLine = {
  /** The name of the file or folder, without a trailing slash. */
  name: string;
  /** True when the line is for a subfolder. */
  isFolder: boolean;
  /** The sentence after the colon. */
  description: string;
};

/** What an index says: its well-formed lines, and the lines that begin with `- ` and are not index lines. */
export type LoreIndex = {
  lines: LoreIndexLine[];
  /** Each malformed line, as a sentence that says what is wrong and quotes the line. */
  malformed: string[];
};
