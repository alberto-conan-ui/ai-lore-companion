import { createHash } from 'node:crypto';
import { type FileHandle, open, realpath, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type {
  DashboardComponentDefinition,
  DashboardDefinition,
  DashboardDefinitionDiagnostic,
  DashboardPmComponentDefinition,
  DashboardPmComponentValue,
  DashboardReportInput,
  ResolvedDashboardDefinition,
} from '../../shared/ipc/space/dashboard-report.types.js';
import {
  DASHBOARD_COMPONENT_ID_MAX_CHARS,
  DASHBOARD_DEFAULT_LIMIT,
  DASHBOARD_LIST_ITEM_MAX_CHARS,
  DASHBOARD_LIST_MAX_ITEMS,
  DASHBOARD_MAX_COLUMNS,
  DASHBOARD_MAX_COMPONENTS,
  DASHBOARD_MAX_SECTIONS,
  DASHBOARD_REPORT_BASIS_MAX_CHARS,
  DASHBOARD_REPORT_MAX_CHARS,
  DASHBOARD_TEXT_MAX_CHARS,
} from '../../shared/ipc/space/dashboard-report.types.js';
import { loreTemplateDir } from './template-dir.js';

export type DashboardDefinitionReadOptions = {
  spaceRoot: string;
  /** Tests may provide the template directly; production uses the packaged template resolver. */
  templateDir?: string;
};

export type DashboardDefinitionReadResult =
  | { ok: true; value: ResolvedDashboardDefinition }
  | { ok: false; error: DashboardDefinitionDiagnostic };

const FILE_NAME = 'dashboard.json';
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const COMPONENT_TYPES = new Set([
  'plan',
  'needs-you',
  'agents',
  'repositories',
  'workbench-docs',
  'handovers',
  'activity',
  'text',
  'metric',
  'list',
]);
const PM_TYPES = new Set(['text', 'metric', 'list']);
const COMPANION_TYPES = new Set([
  'plan',
  'needs-you',
  'agents',
  'repositories',
  'workbench-docs',
  'handovers',
  'activity',
]);
const DASHBOARD_DEFINITION_MAX_BYTES = 256 * 1024;

const failure = (
  kind: DashboardDefinitionDiagnostic['kind'],
  message: string,
  path?: string,
): DashboardDefinitionDiagnostic => ({ kind, message, ...(path === undefined ? {} : { path }) });

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keysAre(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function text(
  value: unknown,
  label: string,
  maximum: number,
): string | DashboardDefinitionDiagnostic {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maximum)
    return failure(
      'invalid-definition',
      `${label} must be non-empty text of at most ${maximum} characters.`,
    );
  if (
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
    })
  )
    return failure('invalid-definition', `${label} contains a control character.`);
  return value;
}

function id(value: unknown, label: string): string | DashboardDefinitionDiagnostic {
  if (
    typeof value !== 'string' ||
    !ID.test(value) ||
    value.length > DASHBOARD_COMPONENT_ID_MAX_CHARS
  )
    return failure('invalid-definition', `${label} must match ${ID}.`);
  return value;
}

function boundedInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number | DashboardDefinitionDiagnostic {
  if (value === undefined)
    return minimum === 1 && maximum === DASHBOARD_DEFAULT_LIMIT ? DASHBOARD_DEFAULT_LIMIT : minimum;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum)
    return failure(
      'invalid-definition',
      `${label} must be an integer from ${minimum} to ${maximum}.`,
    );
  return value;
}

function component(
  value: unknown,
  index: number,
): DashboardComponentDefinition | DashboardDefinitionDiagnostic {
  const label = `components[${index}]`;
  if (
    !isObject(value) ||
    !keysAre(value, ['id', 'type', 'source', 'title', 'instruction', 'limit', 'recentDays'])
  )
    return failure('invalid-definition', `${label} has unsupported keys or is not an object.`);
  const componentId = id(value.id, `${label}.id`);
  const title = text(value.title, `${label}.title`, 200);
  if (typeof componentId !== 'string') return componentId;
  if (typeof title !== 'string') return title;
  if (typeof value.type !== 'string' || !COMPONENT_TYPES.has(value.type))
    return failure('invalid-definition', `${label}.type is unsupported.`);
  const expectedSource = PM_TYPES.has(value.type) ? 'pm' : 'companion';
  if (value.source !== expectedSource)
    return failure(
      'invalid-definition',
      `${label}.source must be ${expectedSource} for ${value.type}.`,
    );
  const limit = boundedInteger(value.limit, `${label}.limit`, 1, DASHBOARD_LIST_MAX_ITEMS);
  if (typeof limit !== 'number') return limit;
  if (expectedSource === 'pm' && value.recentDays !== undefined)
    return failure('invalid-definition', `${label}.recentDays applies only to workbench-docs.`);
  if (expectedSource === 'companion' && value.instruction !== undefined)
    return failure('invalid-definition', `${label}.instruction applies only to PM components.`);
  if (
    value.limit !== undefined &&
    !['list', 'workbench-docs', 'handovers', 'activity'].includes(value.type)
  )
    return failure('invalid-definition', `${label}.limit applies only to bounded list components.`);
  if (
    expectedSource === 'companion' &&
    value.type !== 'workbench-docs' &&
    value.recentDays !== undefined
  )
    return failure('invalid-definition', `${label}.recentDays applies only to workbench-docs.`);
  const recentDays =
    expectedSource === 'companion' && value.type === 'workbench-docs'
      ? boundedInteger(value.recentDays, `${label}.recentDays`, 1, 90)
      : undefined;
  if (recentDays !== undefined && typeof recentDays !== 'number') return recentDays;
  if (value.instruction !== undefined) {
    const instruction = text(value.instruction, `${label}.instruction`, DASHBOARD_TEXT_MAX_CHARS);
    if (typeof instruction !== 'string') return instruction;
  }
  const base = { id: componentId, title, type: value.type, source: expectedSource } as const;
  if (expectedSource === 'pm') {
    return {
      ...base,
      type: value.type as DashboardPmComponentDefinition['type'],
      source: 'pm',
      ...(value.instruction === undefined ? {} : { instruction: value.instruction as string }),
      ...(value.limit === undefined ? {} : { limit }),
    } as DashboardComponentDefinition;
  }
  return {
    ...base,
    type: value.type as Exclude<
      DashboardComponentDefinition,
      DashboardPmComponentDefinition
    >['type'],
    source: 'companion',
    ...(value.limit === undefined ? {} : { limit }),
    ...(value.recentDays === undefined ? {} : { recentDays }),
  } as DashboardComponentDefinition;
}

function definition(value: unknown): DashboardDefinition | DashboardDefinitionDiagnostic {
  if (!isObject(value) || !keysAre(value, ['version', 'sections', 'components']))
    return failure(
      'invalid-definition',
      'The dashboard definition must be an object with version, sections and components.',
    );
  if (value.version !== 1)
    return failure('invalid-definition', 'The dashboard definition version must be 1.');
  if (
    !Array.isArray(value.sections) ||
    value.sections.length === 0 ||
    value.sections.length > DASHBOARD_MAX_SECTIONS
  )
    return failure(
      'invalid-definition',
      `sections must contain 1 to ${DASHBOARD_MAX_SECTIONS} sections.`,
    );
  if (
    !Array.isArray(value.components) ||
    value.components.length === 0 ||
    value.components.length > DASHBOARD_MAX_COMPONENTS
  )
    return failure(
      'invalid-definition',
      `components must contain 1 to ${DASHBOARD_MAX_COMPONENTS} components.`,
    );

  const components: DashboardComponentDefinition[] = [];
  const componentIds = new Set<string>();
  for (let index = 0; index < value.components.length; index += 1) {
    const parsed = component(value.components[index], index);
    if (!('id' in parsed)) return parsed;
    if (componentIds.has(parsed.id))
      return failure('invalid-definition', `The component id "${parsed.id}" is duplicated.`);
    componentIds.add(parsed.id);
    components.push(parsed);
  }
  const sections = [] as DashboardDefinition['sections'];
  const placed = new Set<string>();
  for (let index = 0; index < value.sections.length; index += 1) {
    const raw = value.sections[index];
    const label = `sections[${index}]`;
    if (!isObject(raw) || !keysAre(raw, ['id', 'title', 'columns']))
      return failure('invalid-definition', `${label} has unsupported keys or is not an object.`);
    const sectionId = id(raw.id, `${label}.id`);
    const title = text(raw.title, `${label}.title`, 200);
    if (typeof sectionId !== 'string') return sectionId;
    if (typeof title !== 'string') return title;
    if (
      !Array.isArray(raw.columns) ||
      raw.columns.length < 1 ||
      raw.columns.length > DASHBOARD_MAX_COLUMNS
    )
      return failure(
        'invalid-definition',
        `${label}.columns must contain 1 to ${DASHBOARD_MAX_COLUMNS} columns.`,
      );
    const columns: string[][] = [];
    for (let columnIndex = 0; columnIndex < raw.columns.length; columnIndex += 1) {
      const rawColumn = raw.columns[columnIndex];
      if (!Array.isArray(rawColumn) || rawColumn.length === 0)
        return failure(
          'invalid-definition',
          `${label}.columns[${columnIndex}] must be a non-empty list.`,
        );
      const column: string[] = [];
      for (const rawId of rawColumn) {
        const componentId = id(rawId, `${label}.columns component id`);
        if (typeof componentId !== 'string') return componentId;
        if (!componentIds.has(componentId))
          return failure(
            'invalid-definition',
            `The layout references unknown component "${componentId}".`,
          );
        if (placed.has(componentId))
          return failure(
            'invalid-definition',
            `The component "${componentId}" appears more than once in the layout.`,
          );
        placed.add(componentId);
        column.push(componentId);
      }
      columns.push(column);
    }
    if (sections.some((section) => section.id === sectionId))
      return failure('invalid-definition', `The section id "${sectionId}" is duplicated.`);
    sections.push({ id: sectionId, title, columns });
  }
  if (placed.size !== componentIds.size)
    return failure('invalid-definition', 'Every component must appear exactly once in the layout.');
  return { version: 1, sections, components };
}

/** Stable JSON used for the definition hash shared with the PM. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    )
    .join(',')}}`;
}

export function dashboardDefinitionHash(value: DashboardDefinition): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

async function readBoundedDefinition(path: string): Promise<string | null> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, 'r');
    const buffer = Buffer.alloc(DASHBOARD_DEFINITION_MAX_BYTES + 1);
    const result = await handle.read(buffer, 0, buffer.length, 0);
    if (result.bytesRead > DASHBOARD_DEFINITION_MAX_BYTES) return null;
    return buffer.subarray(0, result.bytesRead).toString('utf8');
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function readCandidate(
  path: string,
  spaceRoot: string | null,
): Promise<DashboardDefinitionReadResult> {
  try {
    if (spaceRoot !== null) {
      const real = await realpath(path);
      const realRoot = await realpath(join(spaceRoot, 'lore'));
      const rel = relative(realRoot, real);
      if (rel.startsWith('..') || resolve(realRoot, rel) !== real)
        return {
          ok: false,
          error: failure('unsafe-path', 'The dashboard definition points outside the Lore.', path),
        };
    }
    const info = await stat(path);
    if (!info.isFile())
      return {
        ok: false,
        error: failure('unreadable', 'The dashboard definition is not a file.', path),
      };
    if (info.size > DASHBOARD_DEFINITION_MAX_BYTES)
      return {
        ok: false,
        error: failure(
          'unreadable',
          `The dashboard definition exceeds the ${DASHBOARD_DEFINITION_MAX_BYTES}-byte limit.`,
          path,
        ),
      };
    let parsed: unknown;
    try {
      const content = await readBoundedDefinition(path);
      if (content === null)
        return {
          ok: false,
          error: failure(
            'unreadable',
            `The dashboard definition exceeds the ${DASHBOARD_DEFINITION_MAX_BYTES}-byte limit.`,
            path,
          ),
        };
      parsed = JSON.parse(content);
    } catch (caught) {
      return {
        ok: false,
        error: failure(
          'invalid-json',
          `The dashboard definition is not valid JSON: ${caught instanceof Error ? caught.message : String(caught)}.`,
          path,
        ),
      };
    }
    const checked = definition(parsed);
    if (!('version' in checked)) return { ok: false, error: { ...checked, path } };
    return {
      ok: true,
      value: {
        definition: checked,
        hash: dashboardDefinitionHash(checked),
        source: 'space',
        path,
        diagnostic: null,
      },
    };
  } catch (caught) {
    const code =
      typeof caught === 'object' && caught !== null && 'code' in caught
        ? String((caught as { code: unknown }).code)
        : '';
    return {
      ok: false,
      error: failure(
        code === 'ENOENT' ? 'missing' : 'unreadable',
        code === 'ENOENT'
          ? 'The dashboard definition file is absent.'
          : `The dashboard definition could not be read: ${caught instanceof Error ? caught.message : String(caught)}.`,
        path,
      ),
    };
  }
}

/** Resolve the own/default/packaged definition, retaining a diagnostic on fallback. */
export async function readDashboardDefinition(
  options: DashboardDefinitionReadOptions,
): Promise<DashboardDefinitionReadResult> {
  const own = join(options.spaceRoot, 'lore', 'corpus', FILE_NAME);
  const installed = join(options.spaceRoot, 'lore', 'corpus', 'default', FILE_NAME);
  const locatedTemplate = loreTemplateDir();
  const template = options.templateDir ?? (locatedTemplate.ok ? locatedTemplate.value : null);
  const candidates: Array<{
    path: string;
    source: ResolvedDashboardDefinition['source'];
    spaceRoot: string | null;
  }> = [
    { path: own, source: 'space', spaceRoot: options.spaceRoot },
    { path: installed, source: 'installed-default', spaceRoot: options.spaceRoot },
    ...(template === null
      ? []
      : [
          {
            path: join(template, 'lore', 'corpus', 'default', FILE_NAME),
            source: 'packaged-default' as const,
            spaceRoot: null,
          },
        ]),
  ];
  let diagnostic: DashboardDefinitionDiagnostic | null = null;
  for (const candidate of candidates) {
    const result = await readCandidate(candidate.path, candidate.spaceRoot);
    if (result.ok)
      return { ok: true, value: { ...result.value, source: candidate.source, diagnostic } };
    if (result.error.kind !== 'missing') diagnostic ??= result.error;
  }
  return {
    ok: false,
    error: diagnostic ?? failure('missing', 'No dashboard definition is available.'),
  };
}

function pmDefinitions(definitionValue: DashboardDefinition): DashboardPmComponentDefinition[] {
  return definitionValue.components.filter(
    (componentValue): componentValue is DashboardPmComponentDefinition =>
      componentValue.source === 'pm',
  );
}

function validString(value: unknown, maximum: number, allowLineBreaks = false): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) return false;
  return [...value].every((character) => {
    const code = character.charCodeAt(0);
    if (allowLineBreaks && (code === 9 || code === 10 || code === 13)) return true;
    return !(code <= 31 || code === 127);
  });
}

/** Validate an entire PM submission against the currently effective definition. */
export function validateDashboardReport(
  resolved: ResolvedDashboardDefinition,
  input: DashboardReportInput,
):
  | { ok: true; value: Extract<DashboardReportInput, { definitionHash: string }> }
  | { ok: false; error: DashboardDefinitionDiagnostic } {
  if (
    !isObject(input) ||
    !('definitionHash' in input) ||
    !('components' in input) ||
    input.definitionHash !== resolved.hash
  )
    return {
      ok: false,
      error: failure(
        'invalid-definition',
        'The PM report targets an obsolete dashboard definition.',
      ),
    };
  const typedInput = input as Extract<DashboardReportInput, { definitionHash: string }>;
  if (!keysAre(typedInput, ['definitionHash', 'components', 'basis']))
    return {
      ok: false,
      error: failure('invalid-definition', 'The PM report has unsupported fields.'),
    };
  if (
    !Array.isArray(typedInput.components) ||
    typedInput.components.length !== pmDefinitions(resolved.definition).length
  )
    return {
      ok: false,
      error: failure(
        'invalid-definition',
        'The PM report must contain exactly one value for every PM component.',
      ),
    };
  if (
    typedInput.basis !== undefined &&
    !validString(typedInput.basis, DASHBOARD_REPORT_BASIS_MAX_CHARS, true)
  )
    return { ok: false, error: failure('invalid-definition', 'The PM report basis is invalid.') };
  const byId = new Map(
    pmDefinitions(resolved.definition).map((componentValue) => [componentValue.id, componentValue]),
  );
  const seen = new Set<string>();
  for (const value of typedInput.components as DashboardPmComponentValue[]) {
    if (!isObject(value) || typeof value.id !== 'string' || seen.has(value.id))
      return {
        ok: false,
        error: failure(
          'invalid-definition',
          'The PM report has an unknown or duplicate component id.',
        ),
      };
    seen.add(value.id);
    const expected = byId.get(value.id);
    if (expected === undefined)
      return {
        ok: false,
        error: failure(
          'invalid-definition',
          `The PM report has no PM component named "${value.id}".`,
        ),
      };
    if ('unavailable' in value) {
      if (
        value.unavailable !== true ||
        !keysAre(value, ['id', 'unavailable', 'reason']) ||
        !validString(value.reason, DASHBOARD_TEXT_MAX_CHARS, true)
      )
        return {
          ok: false,
          error: failure(
            'invalid-definition',
            `The PM component "${value.id}" has an invalid unavailable value.`,
          ),
        };
      continue;
    }
    if (typeof value.type !== 'string' || value.type !== expected.type)
      return {
        ok: false,
        error: failure('invalid-definition', `The PM component "${value.id}" has the wrong type.`),
      };
    if (value.type === 'text') {
      if (
        !keysAre(value, ['id', 'type', 'text']) ||
        !validString(value.text, DASHBOARD_TEXT_MAX_CHARS, true)
      )
        return {
          ok: false,
          error: failure('invalid-definition', `The PM text component "${value.id}" is invalid.`),
        };
    }
    if (value.type === 'metric') {
      if (
        !keysAre(value, ['id', 'type', 'value', 'unit']) ||
        !(
          (typeof value.value === 'number' && Number.isFinite(value.value)) ||
          validString(value.value, DASHBOARD_TEXT_MAX_CHARS, true)
        ) ||
        (value.unit !== undefined && !validString(value.unit, DASHBOARD_TEXT_MAX_CHARS))
      )
        return {
          ok: false,
          error: failure('invalid-definition', `The PM metric component "${value.id}" is invalid.`),
        };
    }
    if (value.type === 'list') {
      if (!keysAre(value, ['id', 'type', 'items']))
        return {
          ok: false,
          error: failure(
            'invalid-definition',
            `The PM list component "${value.id}" has unsupported fields.`,
          ),
        };
      const limit = expected.limit ?? DASHBOARD_DEFAULT_LIMIT;
      if (
        !Array.isArray(value.items) ||
        value.items.length > Math.min(limit, DASHBOARD_LIST_MAX_ITEMS)
      )
        return {
          ok: false,
          error: failure(
            'invalid-definition',
            `The PM list component "${value.id}" exceeds its item limit.`,
          ),
        };
      const itemIds = new Set<string>();
      for (const item of value.items) {
        if (
          !isObject(item) ||
          !keysAre(item, ['id', 'label', 'value', 'status']) ||
          !validString(item.id, DASHBOARD_COMPONENT_ID_MAX_CHARS) ||
          !validString(item.label, DASHBOARD_LIST_ITEM_MAX_CHARS) ||
          (item.value !== undefined && !validString(item.value, DASHBOARD_LIST_ITEM_MAX_CHARS)) ||
          (item.status !== undefined && !validString(item.status, DASHBOARD_LIST_ITEM_MAX_CHARS))
        )
          return {
            ok: false,
            error: failure(
              'invalid-definition',
              `The PM list component "${value.id}" has an invalid item.`,
            ),
          };
        if (itemIds.has(item.id))
          return {
            ok: false,
            error: failure(
              'invalid-definition',
              `The PM list component "${value.id}" has a duplicate item id.`,
            ),
          };
        itemIds.add(item.id);
      }
    }
  }
  if (seen.size !== byId.size || JSON.stringify(typedInput).length > DASHBOARD_REPORT_MAX_CHARS)
    return {
      ok: false,
      error: failure('invalid-definition', 'The PM report is incomplete or too large.'),
    };
  return { ok: true, value: typedInput };
}
