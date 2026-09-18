/**
 * From frontmatter to a typed card.
 *
 * The keys and values of each kind are the ones the template's corpus entry
 * "card" lists. A card must have exactly the keys of its kind, its kind must be
 * the kind its part holds, and its file must have the name its kind gives it.
 * What does not fit comes back as sentences, never as a throw.
 */

import type { FrontmatterValue, LoreFrontmatter } from '../frontmatter/types.js';
import { type Result, err, ok } from '../result.js';
import type {
  ContractTarget,
  ContractWhen,
  LoreCard,
  LoreCardKind,
  LorePart,
  LorePillar,
} from './types.js';

/** The five parts of the Lore, in the order the Lore's index lists them. */
export const LORE_PARTS: readonly LorePart[] = [
  'corpus',
  'verbs',
  'processes',
  'contracts',
  'mirrors',
];

/** The five pillars. */
export const LORE_PILLARS: readonly LorePillar[] = [
  'specifying',
  'planning',
  'working',
  'producing',
  'shaping',
];

/** The kind of card that each part holds. */
export const LORE_PART_KIND: Readonly<Record<LorePart, LoreCardKind>> = {
  corpus: 'corpus',
  verbs: 'verb',
  processes: 'process',
  contracts: 'contract',
  mirrors: 'mirror',
};

const CONTRACT_TARGETS: readonly ContractTarget[] = [
  'everything',
  'lore',
  'journal',
  'plan',
  'payload',
];
const CONTRACT_WHENS: readonly ContractWhen[] = ['before', 'after', 'both'];
const VERB_MODES = ['read-only', 'writing'] as const;

const REQUIRED_KEYS: Readonly<Record<LoreCardKind, readonly string[]>> = {
  corpus: ['type', 'term', 'points_at'],
  verb: ['type', 'name', 'pillar', 'mode', 'invoked_by'],
  process: ['type', 'name', 'pillar', 'steps', 'gates', 'unattended'],
  contract: ['type', 'name', 'pillar', 'target', 'check', 'when'],
  mirror: ['type', 'payload', 'generator', 'skeleton'],
};

const FILE_NAME = /^[a-z0-9]+(-[a-z0-9]+)*\.md$/;
const HYPHENATED = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ONE_WORD = /^[a-z0-9]+$/;
/** A path relative to the Space's folder: nothing before its first folder name, forward slashes. */
const SPACE_PATH = /^[A-Za-z0-9][^\\]*$/;

/** Whether `value` is one of `allowed`, narrowing it to the union. */
function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/** Reads values out of frontmatter and collects a sentence for each one that does not fit. */
class CardFields {
  readonly faults: string[] = [];

  constructor(private readonly data: LoreFrontmatter) {}

  private get(key: string): FrontmatterValue | undefined {
    return Object.hasOwn(this.data, key) ? this.data[key] : undefined;
  }

  fault(sentence: string): void {
    this.faults.push(sentence);
  }

  has(key: string): boolean {
    return Object.hasOwn(this.data, key);
  }

  /** Non-empty text, or `''` with a fault. A missing key was already reported with the key list. */
  text(key: string): string {
    const value = this.get(key);
    if (typeof value === 'string' && value !== '') return value;
    if (value !== undefined) this.fault(`the key ${key} must be text that is not empty`);
    return '';
  }

  /** Text that matches `pattern`. */
  textLike(key: string, pattern: RegExp, what: string): string {
    const value = this.text(key);
    if (value !== '' && !pattern.test(value)) {
      this.fault(`the key ${key} has "${value}", which is not ${what}`);
    }
    return value;
  }

  /** One value of a fixed list, or `null` with a fault. */
  oneOf<T extends string>(key: string, allowed: readonly T[]): T | null {
    const value = this.get(key);
    if (isOneOf(allowed, value)) return value;
    if (value !== undefined) {
      this.fault(
        `the key ${key} has ${JSON.stringify(value)}; it must be one of ${allowed.join(', ')}`,
      );
    }
    return null;
  }

  /** A list whose items are all text, or `[]` with a fault. */
  list(key: string): string[] {
    const value = this.get(key);
    if (Array.isArray(value)) {
      const items = value.filter((item): item is string => typeof item === 'string');
      if (items.length === value.length) return items;
    }
    if (value !== undefined) this.fault(`the key ${key} must be a list of text`);
    return [];
  }

  /** `true` or `false`, or `false` with a fault. */
  flag(key: string): boolean {
    const value = this.get(key);
    if (typeof value === 'boolean') return value;
    if (value !== undefined) this.fault(`the key ${key} must be true or false`);
    return false;
  }

  isNull(key: string): boolean {
    return this.get(key) === null;
  }

  isEmptyList(key: string): boolean {
    const value = this.get(key);
    return Array.isArray(value) && value.length === 0;
  }
}

/** The pillar of a verb, a process or a contract; `'working'` stands in when the value was reported. */
function pillarOf(fields: CardFields): LorePillar {
  return fields.oneOf('pillar', LORE_PILLARS) ?? 'working';
}

/**
 * Build the typed card from the frontmatter of the file `fileName` of `part`.
 * Returns the card, or one sentence for each thing that does not fit the kind:
 * the value of `type`, a missing or unknown key, a value of the wrong form, a
 * file name that is not the one the card's name gives. A card with a fault is
 * not used by the reader.
 */
export function readLoreCard(
  data: LoreFrontmatter,
  part: LorePart,
  fileName: string,
): Result<LoreCard, string[]> {
  const expectedKind = LORE_PART_KIND[part];
  const type = Object.hasOwn(data, 'type') ? data.type : undefined;
  if (type !== expectedKind) {
    const found = type === undefined ? 'no key type' : `type: ${JSON.stringify(type)}`;
    return err([`the frontmatter has ${found}; a card in lore/${part}/ has type: ${expectedKind}`]);
  }

  const fields = new CardFields(data);
  const allowedKeys = [...REQUIRED_KEYS[expectedKind]];
  if (expectedKind === 'contract') allowedKeys.push('payload');
  for (const key of REQUIRED_KEYS[expectedKind]) {
    if (!fields.has(key)) fields.fault(`the key ${key} is missing`);
  }
  for (const key of Object.keys(data)) {
    if (!allowedKeys.includes(key)) {
      fields.fault(`the key ${key} is not a key of a ${expectedKind} card`);
    }
  }

  let card: LoreCard;
  /** The file name the card's own values give, or `null` when they give none. */
  let expectedFile: string | null = null;

  if (expectedKind === 'corpus') {
    const term = fields.text('term');
    const pointsAt = fields.list('points_at');
    for (const item of pointsAt) {
      if (!item.startsWith('https://') && !SPACE_PATH.test(item)) {
        fields.fault(
          `points_at has "${item}", which is neither a path relative to the Space's folder nor an https:// address`,
        );
      }
    }
    const slug = `${term.toLowerCase().replace(/ /g, '-')}.md`;
    if (FILE_NAME.test(slug)) expectedFile = slug;
    card = { kind: 'corpus', term, pointsAt };
  } else if (expectedKind === 'verb') {
    const name = fields.textLike('name', HYPHENATED, 'lower-case words joined by hyphens');
    if (name !== '' && !name.includes('-')) {
      fields.fault(
        `the name of a verb is hyphenated, the object first and the action second: ${name}`,
      );
    }
    const invokedBy = fields.list('invoked_by');
    if (fields.isEmptyList('invoked_by')) {
      fields.fault('invoked_by must name at least one invoker');
    }
    for (const item of invokedBy) {
      if (!HYPHENATED.test(item)) fields.fault(`invoked_by has "${item}", which is not a name`);
    }
    if (name !== '') expectedFile = `${name}.md`;
    card = {
      kind: 'verb',
      name,
      pillar: pillarOf(fields),
      mode: fields.oneOf('mode', VERB_MODES) ?? 'read-only',
      invokedBy,
    };
  } else if (expectedKind === 'process') {
    const name = fields.textLike('name', ONE_WORD, 'one word in lower-case letters and digits');
    const steps = fields.list('steps');
    const gates = fields.list('gates');
    if (fields.isEmptyList('steps')) fields.fault('steps must not be empty');
    for (const step of steps) {
      if (!HYPHENATED.test(step))
        fields.fault(`steps has "${step}", which is not the name of a step`);
    }
    if (new Set(steps).size !== steps.length) fields.fault('a step is named twice in steps');
    for (const gate of gates) {
      if (!steps.includes(gate)) fields.fault(`the gate ${gate} is not one of the steps`);
    }
    if (name !== '') expectedFile = `${name}.md`;
    card = {
      kind: 'process',
      name,
      pillar: pillarOf(fields),
      steps,
      gates,
      unattended: fields.flag('unattended'),
    };
  } else if (expectedKind === 'contract') {
    const name = fields.textLike('name', HYPHENATED, 'lower-case words joined by hyphens');
    const target = fields.oneOf('target', CONTRACT_TARGETS);
    let payload: string | null = null;
    if (fields.has('payload')) {
      payload = fields.text('payload');
      if (target !== null && target !== 'payload') {
        fields.fault('the key payload is used only with target: payload');
      }
    }
    let check: string | null = null;
    let when: ContractWhen | null = null;
    if (fields.isNull('check')) {
      if (fields.has('when') && !fields.isNull('when')) {
        fields.fault('when must be null when check is null');
      }
    } else {
      check = fields.textLike('check', SPACE_PATH, "a path relative to the Space's folder");
      if (check !== '' && !check.endsWith('.py')) {
        fields.fault(`the key check has "${check}", which is not a .py file`);
      }
      when = fields.oneOf('when', CONTRACT_WHENS);
    }
    if (name !== '') expectedFile = `${name}.md`;
    card = {
      kind: 'contract',
      name,
      pillar: pillarOf(fields),
      target: target ?? 'everything',
      payload,
      check,
      when,
    };
  } else {
    const payload = fields.text('payload');
    const generator = fields.textLike(
      'generator',
      SPACE_PATH,
      "a path relative to the Space's folder",
    );
    if (payload !== '') expectedFile = `${payload}.md`;
    card = { kind: 'mirror', payload, generator, skeleton: fields.list('skeleton') };
  }

  if (!FILE_NAME.test(fileName)) {
    fields.fault(
      `the file name ${fileName} is not lower-case letters, digits and hyphens ending in .md`,
    );
  } else if (expectedFile !== null && fileName !== expectedFile) {
    fields.fault(
      `the file is named ${fileName}, and its frontmatter gives it the name ${expectedFile}`,
    );
  }

  return fields.faults.length > 0 ? err(fields.faults) : ok(card);
}
