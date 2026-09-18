---
type: corpus
term: frontmatter
points_at:
  - lore/index.md
  - lore/space.md
---

# Frontmatter

## What it means

Frontmatter is the block at the top of a markdown file that holds a few facts about the file as keys and values. The first line of the file is `---`, the frontmatter follows, and the next line that is exactly `---` ends it. The prose of the file begins after that line.

Frontmatter is written in a small subset of YAML, which this entry defines. The subset is small because the check scripts of the contracts and the skeleton generators are Python 3 scripts that use only Python's standard library, and the standard library has no YAML reader. Each script therefore reads frontmatter with a short reader of its own, and the subset is what such a reader can read line by line. The companion app reads the same frontmatter with a full YAML reader, and both must get the same values. Frontmatter that goes outside the subset can be read differently by the two, so it is treated as an error.

## Where it is kept

Every markdown file under `lore/` has frontmatter, and every frontmatter has the key `type`. The values of `type` are:

- `corpus`, `verb`, `process`, `contract` and `mirror` for the five kinds of card. The entry [card](./card.md) lists the keys of each kind.
- `index` for an `index.md`. An index has no other key.
- `space` for `lore/space.md`, which describes its own keys.

`ai_readme.md` is outside `lore/` and has no frontmatter. Whether the files of a publish area have frontmatter is for that publish area's mirror to say.

## What acts on it

The contract lore-integrity checks, after every write to the Lore, that the frontmatter of every file parses. The authoring verbs write frontmatter when they write a new card, and the verb payload-add writes it in a new mirror and in `lore/space.md`. The companion app reads frontmatter to show the Lore, the step that a session is at, and the gates of a process.

## The subset

### Lines

The text is UTF-8, and lines end with a line feed. Indentation is made of spaces, two for each level, and never of tabs. Every line of the frontmatter is one of four things:

- An empty line, which is ignored.
- A comment line, whose first character after the indentation is `#`. It is ignored. A comment is never written at the end of a line that has a key or a value.
- A key line, which is `key: value`, or `key:` alone when the value is written on the indented lines that follow.
- An item line, which begins with `- ` and is one item of a list.

A key is written in lower-case letters, digits and underscores, and begins with a letter. A key is written once in its map.

### The five forms of a value

A key at the top level has a value in one of five forms.

A scalar, written on the key's line:

```yaml
name: specify
```

The empty list, written on the key's line as `[]`:

```yaml
gates: []
```

A list of scalars, one item per line, indented by two spaces:

```yaml
steps:
  - open
  - draft
```

A map of scalars, one key per line, indented by two spaces:

```yaml
github:
  repository: example-owner/example-space
  project: 1
```

A list of maps of scalars. The first key of an item is on the item line, and the other keys of the item are on the lines below, indented to the same column as the first key:

```yaml
repositories:
  - name: example-app
    github: example-owner/example-app
  - name: example-site
    github: example-owner/example-site
```

Nothing is nested deeper than this. A map inside a map, a list inside a list and a list inside a map that is itself inside a list are outside the subset. A key line that has no value and no indented lines after it is also outside the subset.

### Scalars

A scalar is one of five things.

- A whole number, written with digits only and with no zero in front of it, as in `7` or `0`.
- `true` or `false`, in lower case.
- `null`, in lower case.
- Plain text. It begins with a letter, it has no space at its end, and it contains neither a colon, nor `#`, nor a double quote. It is none of the words `true`, `false`, `null`, `yes`, `no`, `on`, `off`, `y` and `n`, in any mix of upper and lower case, because YAML readers do not agree on what these words are. Examples: `read-only`, `lore/contracts/core/write-guard.py`, `Human Lead`.
- Text in double quotes, for every text that the rule for plain text excludes. Inside the quotes, a double quote is written `\"` and a backslash is written `\\`, and there is no other escape. Examples: `"https://github.com/example-owner/example-space/issues/12"`, `"1.0"`, `"2026-09-18"`, `"yes"`, `""` for the empty text.

Text that begins with a digit, such as a version number or a date, is written in double quotes, so that no reader takes it for a number or a date.

### What is outside the subset

These forms of YAML are outside the subset:

- Text in single quotes.
- Text that spans several lines, written with `|`, with `>` or by continuing a line.
- A list or a map written between brackets or braces, apart from the empty list `[]`.
- Anchors, aliases and tags.
- More than one document in a file.
- A comment at the end of a line.

## Choices recorded here

The architecture document of the first build proposed that frontmatter is limited to scalars, lists of scalars, maps of one level and lists of maps of one level, and left the exact rules to the session that wrote this entry on 2026-09-18. That session made the following choices. Each is open to the Human Lead's review.

- `[]` is the one bracketed form, because a card must be able to say that a list is empty.
- Text is quoted with double quotes only, and with two escapes.
- Plain text begins with a letter and has no colon and no `#`. This rule is stricter than YAML's own rule. It was chosen because a reader can then decide what a piece of text is from its first character and its first colon: text that begins with a double quote is quoted text, other text that contains a colon is a key with its value, and the rest is a scalar.
- Comments are whole lines only.
- An `index.md` has frontmatter with the one key `type: index`, so that the rule "every markdown file under `lore/` has frontmatter with a `type`" has no exception.
