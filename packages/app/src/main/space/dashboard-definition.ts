import { createHash } from 'node:crypto';
import { type FileHandle, open, realpath, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type {
  DashboardBand,
  DashboardBandId,
  DashboardCompanionPanel,
  DashboardCompanionPanelKind,
  DashboardDefinition,
  DashboardDefinitionDiagnostic,
  DashboardPmComponentValue,
  DashboardPmComponentType,
  DashboardPanel,
  DashboardReportInput,
  ResolvedDashboardDefinition,
} from '../../shared/ipc/space/dashboard-report.types.js';
import {
  DASHBOARD_BAND_IDS,
  DASHBOARD_COMPONENT_ID_MAX_CHARS,
  DASHBOARD_DEFAULT_LIMIT,
  DASHBOARD_DEFAULT_RECENT_DAYS,
  DASHBOARD_LIST_ITEM_MAX_CHARS,
  DASHBOARD_LIST_MAX_ITEMS,
  DASHBOARD_MAX_PANELS_PER_BAND,
  DASHBOARD_PANEL_KINDS,
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
const PM_TYPES = new Set(['text', 'metric', 'list']);
const BAND_IDS = new Set<string>(DASHBOARD_BAND_IDS);
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
  defaultValue: number,
): number | DashboardDefinitionDiagnostic {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum)
    return failure(
      'invalid-definition',
      `${label} must be an integer from ${minimum} to ${maximum}.`,
    );
  return value;
}

type CompanionOptions = {
  limit?: number;
  recentDays?: number;
  orders?: readonly DashboardCompanionPanel['order'][];
  pmLine?: true;
};

const COMPANION_OPTIONS: Record<DashboardCompanionPanelKind, CompanionOptions> = {
  'next-action': { pmLine: true },
  'review-documents': {
    limit: DASHBOARD_DEFAULT_LIMIT,
    recentDays: DASHBOARD_DEFAULT_RECENT_DAYS,
    orders: ['newest', 'oldest'],
  },
  'publish-area': {},
  'in-progress': { limit: DASHBOARD_DEFAULT_LIMIT, orders: ['age', 'stage'] },
  queued: { limit: DASHBOARD_DEFAULT_LIMIT, orders: ['age', 'stage'] },
  dormant: { pmLine: true },
  'done-line': {},
  'pull-requests': { limit: DASHBOARD_DEFAULT_LIMIT, orders: ['newest', 'oldest', 'state'] },
  'live-sessions': { limit: DASHBOARD_DEFAULT_LIMIT, orders: ['newest', 'oldest'] },
  'agents-board': { limit: DASHBOARD_DEFAULT_LIMIT, orders: ['newest', 'oldest'] },
  'space-stats': {},
  handovers: { limit: 5, orders: ['newest', 'oldest'] },
};

function companionBandOf(kind: string): DashboardBandId | null {
  for (const band of DASHBOARD_BAND_IDS) {
    if ((DASHBOARD_PANEL_KINDS[band] as readonly string[]).includes(kind)) return band;
  }
  return null;
}

function pmLine(
  value: unknown,
  label: string,
): { id: string; instruction: string } | DashboardDefinitionDiagnostic {
  if (!isObject(value) || !keysAre(value, ['id', 'instruction']))
    return failure('invalid-definition', `${label} has unsupported keys or is not an object.`);
  const lineId = id(value.id, `${label}.id`);
  const instruction = text(value.instruction, `${label}.instruction`, DASHBOARD_TEXT_MAX_CHARS);
  if (typeof lineId !== 'string') return lineId;
  if (typeof instruction !== 'string') return instruction;
  return { id: lineId, instruction };
}

function panel(
  value: unknown,
  band: DashboardBandId,
  index: number,
): DashboardPanel | DashboardDefinitionDiagnostic {
  const label = `bands[${band}].panels[${index}]`;
  if (
    !isObject(value) ||
    !keysAre(value, ['id', 'kind', 'source', 'title', 'instruction', 'limit', 'recentDays', 'order', 'pmLine'])
  )
    return failure('invalid-definition', `${label} has unsupported keys or is not an object.`);
  const panelId = id(value.id, `${label}.id`);
  if (typeof panelId !== 'string') return panelId;
  if (typeof value.kind !== 'string') return failure('invalid-definition', `${label}.kind is unsupported.`);

  if (PM_TYPES.has(value.kind)) {
    if (value.source !== 'pm')
      return failure('invalid-definition', `${label}.source must be pm for ${value.kind}.`);
    const title = text(value.title, `${label}.title`, 200);
    if (typeof title !== 'string') return title;
    if (value.recentDays !== undefined || value.order !== undefined || value.pmLine !== undefined)
      return failure('invalid-definition', `${label} has an option this PM panel does not support.`);
    if (value.kind !== 'list' && value.limit !== undefined)
      return failure('invalid-definition', `${label}.limit applies only to list panels.`);
    const limit =
      value.kind === 'list'
        ? boundedInteger(value.limit, `${label}.limit`, 1, DASHBOARD_LIST_MAX_ITEMS, DASHBOARD_DEFAULT_LIMIT)
        : undefined;
    if (limit !== undefined && typeof limit !== 'number') return limit;
    let instruction: string | undefined;
    if (value.instruction !== undefined) {
      const parsedInstruction = text(
        value.instruction,
        `${label}.instruction`,
        DASHBOARD_TEXT_MAX_CHARS,
      );
      if (typeof parsedInstruction !== 'string') return parsedInstruction;
      instruction = parsedInstruction;
    }
    return {
      id: panelId,
      kind: value.kind as DashboardPmComponentType,
      source: 'pm',
      title,
      ...(instruction === undefined ? {} : { instruction }),
      ...(limit === undefined ? {} : { limit }),
    };
  }

  const expectedBand = companionBandOf(value.kind);
  if (expectedBand === null) return failure('invalid-definition', `${label}.kind is unsupported.`);
  if (expectedBand !== band)
    return failure('invalid-definition', `${label}.kind "${value.kind}" belongs in ${expectedBand}.`);
  if (value.source !== 'companion')
    return failure('invalid-definition', `${label}.source must be companion for ${value.kind}.`);
  if (value.instruction !== undefined)
    return failure('invalid-definition', `${label}.instruction applies only to PM panels.`);
  let title: string | undefined;
  if (value.title !== undefined) {
    const parsedTitle = text(value.title, `${label}.title`, 200);
    if (typeof parsedTitle !== 'string') return parsedTitle;
    title = parsedTitle;
  }
  const kind = value.kind as DashboardCompanionPanelKind;
  const options = COMPANION_OPTIONS[kind];
  if (options.limit === undefined && value.limit !== undefined)
    return failure('invalid-definition', `${label}.limit is not supported by ${kind}.`);
  if (options.recentDays === undefined && value.recentDays !== undefined)
    return failure('invalid-definition', `${label}.recentDays is not supported by ${kind}.`);
  if (options.orders === undefined && value.order !== undefined)
    return failure('invalid-definition', `${label}.order is not supported by ${kind}.`);
  if (options.pmLine === undefined && value.pmLine !== undefined)
    return failure('invalid-definition', `${label}.pmLine is not supported by ${kind}.`);
  const limit =
    options.limit === undefined
      ? undefined
      : boundedInteger(value.limit, `${label}.limit`, 1, DASHBOARD_LIST_MAX_ITEMS, options.limit);
  if (limit !== undefined && typeof limit !== 'number') return limit;
  const recentDays =
    options.recentDays === undefined
      ? undefined
      : boundedInteger(value.recentDays, `${label}.recentDays`, 1, 90, options.recentDays);
  if (recentDays !== undefined && typeof recentDays !== 'number') return recentDays;
  let order: DashboardCompanionPanel['order'];
  if (options.orders !== undefined) {
    const defaultOrder = options.orders[0];
    if (typeof value.order !== 'string' || !(options.orders as readonly string[]).includes(value.order)) {
      if (value.order !== undefined)
        return failure('invalid-definition', `${label}.order is not supported by ${kind}.`);
      order = defaultOrder;
    } else {
      order = value.order as DashboardCompanionPanel['order'];
    }
  }
  const line = value.pmLine === undefined ? undefined : pmLine(value.pmLine, `${label}.pmLine`);
  if (line !== undefined && !('id' in line)) return line;
  return {
    id: panelId,
    kind,
    source: 'companion',
    ...(title === undefined ? {} : { title }),
    ...(limit === undefined ? {} : { limit }),
    ...(recentDays === undefined ? {} : { recentDays }),
    ...(order === undefined ? {} : { order }),
    ...(line === undefined ? {} : { pmLine: line }),
  };
}

function definition(value: unknown): DashboardDefinition | DashboardDefinitionDiagnostic {
  if (!isObject(value))
    return failure('invalid-definition', 'The dashboard definition must be an object with version and bands.');
  if (value.version !== 2) {
    const version = typeof value.version === 'number' ? String(value.version) : 'unknown';
    return failure(
      'unsupported-version',
      `This dashboard definition is version ${version}. The Dashboard requires version 2, so a default definition is shown instead. Rewrite it with the verb dashboard-update, or remove it with dashboard-reset.`,
    );
  }
  if (!keysAre(value, ['version', 'bands']))
    return failure('invalid-definition', 'The dashboard definition must be an object with version and bands.');
  if (!Array.isArray(value.bands) || value.bands.length === 0 || value.bands.length > DASHBOARD_BAND_IDS.length)
    return failure('invalid-definition', 'bands must contain 1 to 3 bands.');
  const bands: DashboardBand[] = [];
  const ids = new Set<string>();
  const companionKinds = new Set<string>();
  const bandIds = new Set<string>();
  for (let index = 0; index < value.bands.length; index += 1) {
    const raw = value.bands[index];
    const label = `bands[${index}]`;
    if (!isObject(raw) || !keysAre(raw, ['id', 'panels']))
      return failure('invalid-definition', `${label} has unsupported keys or is not an object.`);
    if (typeof raw.id !== 'string' || !BAND_IDS.has(raw.id))
      return failure('invalid-definition', `${label}.id is unsupported.`);
    if (bandIds.has(raw.id)) return failure('invalid-definition', `The band id "${raw.id}" is duplicated.`);
    bandIds.add(raw.id);
    if (!Array.isArray(raw.panels) || raw.panels.length === 0 || raw.panels.length > DASHBOARD_MAX_PANELS_PER_BAND)
      return failure('invalid-definition', `${label}.panels must contain 1 to ${DASHBOARD_MAX_PANELS_PER_BAND} panels.`);
    const band = raw.id as DashboardBandId;
    const panels: DashboardBand['panels'] = [];
    for (let panelIndex = 0; panelIndex < raw.panels.length; panelIndex += 1) {
      const parsed = panel(raw.panels[panelIndex], band, panelIndex);
      if (!('id' in parsed)) return parsed;
      if (ids.has(parsed.id)) return failure('invalid-definition', `The panel id "${parsed.id}" is duplicated.`);
      ids.add(parsed.id);
      if (parsed.source === 'companion') {
        if (companionKinds.has(parsed.kind))
          return failure('invalid-definition', `The companion panel kind "${parsed.kind}" is duplicated.`);
        companionKinds.add(parsed.kind);
        if (parsed.pmLine !== undefined) {
          if (ids.has(parsed.pmLine.id))
            return failure('invalid-definition', `The PM line id "${parsed.pmLine.id}" is duplicated.`);
          ids.add(parsed.pmLine.id);
        }
      }
      panels.push(parsed);
    }
    bands.push({ id: band, panels });
  }
  return { version: 2, bands };
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

type DashboardPmDefinition = {
  id: string;
  type: DashboardPmComponentType;
  limit?: number;
};

function pmDefinitions(definitionValue: DashboardDefinition): DashboardPmDefinition[] {
  const values: DashboardPmDefinition[] = [];
  for (const band of definitionValue.bands) {
    for (const panel of band.panels) {
      if (panel.source === 'pm') {
        values.push({ id: panel.id, type: panel.kind, ...(panel.limit === undefined ? {} : { limit: panel.limit }) });
      } else if (panel.pmLine !== undefined) {
        values.push({ id: panel.pmLine.id, type: 'text' });
      }
    }
  }
  return values;
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
