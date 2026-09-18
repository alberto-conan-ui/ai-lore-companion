/**
 * The text of one Claude Code skill: a folder with a `SKILL.md` whose
 * frontmatter has `name` and `description`.
 *
 * The body points at the card in the Space and does not copy it, so an edit to
 * a card takes effect without installing again. The frontmatter is written by
 * the subset serializer of `../frontmatter/`, which puts text with a colon, a
 * quote or a `#` in double quotes, and it is read back with `js-yaml` before it
 * is used, so a description that a YAML reader would understand differently is
 * refused and not installed.
 *
 * Nothing here reads or writes a file.
 */

import { load as loadYaml } from 'js-yaml';
import { serializeLoreFrontmatter } from '../frontmatter/index.js';
import { type Failure, type Result, errorMessage, fail, ok } from '../result.js';

/** The longest name Claude Code accepts for a skill. */
export const SKILL_NAME_MAX_LENGTH = 64;

/** The longest description Claude Code accepts for a skill. */
export const SKILL_DESCRIPTION_MAX_LENGTH = 1024;

/** Lower-case letters and digits, in words joined by single hyphens. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Words Claude Code does not accept inside a skill's name. */
const RESERVED_NAME_WORDS = ['anthropic', 'claude'];

/** The kinds of failure of this module. */
export type SkillFailureKind = 'unsafe-name' | 'no-description' | 'frontmatter-unsafe';

/**
 * Whether `name` can be the name of a Claude Code skill, which is also the name
 * of the skill's folder: lower-case letters, digits and single hyphens, at most
 * 64 characters, and without the words Claude Code reserves. A name with a
 * dot, a separator or an upper-case letter is refused, so a name can never
 * lead out of the skills folder.
 */
export function checkSkillName(name: string): Result<string, Failure<SkillFailureKind>> {
  if (name.length === 0 || name.length > SKILL_NAME_MAX_LENGTH) {
    return fail(
      'unsafe-name',
      `a skill's name has 1 to ${SKILL_NAME_MAX_LENGTH} characters, and "${shown(name)}" has ${name.length}`,
    );
  }
  if (!SKILL_NAME.test(name)) {
    return fail(
      'unsafe-name',
      `a skill's name is lower-case letters and digits in words joined by hyphens, and "${shown(name)}" is not`,
    );
  }
  const reserved = RESERVED_NAME_WORDS.find((word) => name.includes(word));
  if (reserved !== undefined) {
    return fail('unsafe-name', `a skill's name may not contain "${reserved}", and "${name}" does`);
  }
  return ok(name);
}

/** A name as it is shown in a message: short, and with nothing that breaks a line. */
function shown(text: string): string {
  const flat = text.replace(/[\p{C}\p{Zl}\p{Zp}]/gu, '?');
  return flat.length > 80 ? `${flat.slice(0, 80)}...` : flat;
}

/** What `safeSkillDescription` returns. */
export type SafeDescription = {
  text: string;
  /** True when `text` is not the text that was given. */
  changed: boolean;
};

/** The zero-width joiner, which is a format character and also holds the parts of one emoji together. */
const ZERO_WIDTH_JOINER = '‍';
const EMOJI_BEFORE_JOINER = /[\p{Extended_Pictographic}\p{Emoji_Modifier}]️?$/u;
const EMOJI_AFTER_JOINER = /^\p{Extended_Pictographic}/u;

/**
 * What a run of control, format and space characters becomes: one space, or
 * the run itself when it is the joiner between two parts of an emoji.
 */
function spaceOrEmojiJoiner(run: string, offset: number, whole: string): string {
  const joinsEmoji =
    run === ZERO_WIDTH_JOINER &&
    EMOJI_BEFORE_JOINER.test(whole.slice(Math.max(0, offset - 4), offset)) &&
    EMOJI_AFTER_JOINER.test(whole.slice(offset + 1, offset + 3));
  return joinsEmoji ? run : ' ';
}

/**
 * The description as Claude Code's frontmatter can hold it: one line, no
 * control or format character except the joiner inside an emoji, no `<` or `>`
 * (Claude Code refuses a description with a tag in it), at most 1024 UTF-16
 * units. A longer text is cut at the last space before the limit, never inside
 * a character, and ends with `...`. Text that is empty after this gives
 * `no-description`.
 */
export function safeSkillDescription(
  description: string,
): Result<SafeDescription, Failure<SkillFailureKind>> {
  let text = description
    .replace(/[\p{C}\p{Z}]+/gu, spaceOrEmojiJoiner)
    .replace(/[<>]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
  if (text.length > SKILL_DESCRIPTION_MAX_LENGTH) {
    const room = SKILL_DESCRIPTION_MAX_LENGTH - 3;
    // Not in the middle of a character that takes two UTF-16 units.
    const end = /[\uD800-\uDBFF]/.test(text.charAt(room - 1)) ? room - 1 : room;
    const cut = text.slice(0, end);
    const lastSpace = cut.lastIndexOf(' ');
    text = `${(lastSpace > room / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}...`;
  }
  if (text === '') return fail('no-description', 'the description is empty');
  return ok({ text, changed: text !== description });
}

/** What a skill is generated from. */
export type SkillSource = {
  /** The skill's name, already checked with `checkSkillName`. */
  name: string;
  /** The description, already made safe with `safeSkillDescription`. */
  description: string;
  /** What the card is. */
  cardKind: 'verb' | 'process';
  /** The absolute path of the card's file. */
  cardPath: string;
  /** The card's path relative to the Space's folder, with `/`. */
  cardRelativePath: string;
};

/**
 * The text of the skill's `SKILL.md`. Fails with `frontmatter-unsafe` when the
 * frontmatter cannot be written in the subset, or when `js-yaml` does not read
 * back exactly the name and the description that were written.
 */
export function renderSkillFile(source: SkillSource): Result<string, Failure<SkillFailureKind>> {
  const frontmatter = serializeLoreFrontmatter({
    name: source.name,
    description: source.description,
  });
  if (!frontmatter.ok) return fail('frontmatter-unsafe', frontmatter.error.message);

  let readBack: unknown;
  try {
    readBack = loadYaml(frontmatter.value);
  } catch (caught) {
    return fail('frontmatter-unsafe', `the frontmatter does not parse: ${errorMessage(caught)}`);
  }
  const fields = typeof readBack === 'object' && readBack !== null ? readBack : {};
  const { name, description } = fields as { name?: unknown; description?: unknown };
  if (
    name !== source.name ||
    description !== source.description ||
    Object.keys(fields).length !== 2
  ) {
    return fail(
      'frontmatter-unsafe',
      'a YAML reader does not read back the name and the description that were written',
    );
  }

  const what = source.cardKind === 'verb' ? 'verb' : 'process';
  const body = [
    `# ${source.name}`,
    '',
    `This skill stands for the ${what} ${source.name} of this Space's Lore. The ${what}'s card is the source, and this file does not copy it.`,
    '',
    `Read the card now, in full, and follow it. Its path relative to the Space's folder is \`${source.cardRelativePath}\`. Its absolute path is:`,
    '',
    '```',
    source.cardPath,
    '```',
    '',
    'The AI-Lore companion generated this file when it installed the Lore into Claude Code, and it writes the file again at the next install. To change what the skill does, change the card in the Lore.',
    '',
  ].join('\n');
  return ok(`---\n${frontmatter.value}\n---\n\n${body}`);
}
