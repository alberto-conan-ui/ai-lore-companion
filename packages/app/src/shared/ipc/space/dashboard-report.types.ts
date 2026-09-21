/**
 * The definition, factual context and typed PM snapshot of one Space's
 * dashboard. The definition is read from Lore; the PM snapshot is ephemeral
 * app state and is never written to a Space payload.
 */

import type { HandoverParts } from '@ai-lore-companion/core';

/** Limits shared by the app-side validator and the reporting tool. */
export const DASHBOARD_REPORT_MAX_CHARS = 24 * 1024;
export const DASHBOARD_REPORT_BASIS_MAX_CHARS = 1024;
export const DASHBOARD_COMPONENT_ID_MAX_CHARS = 64;
export const DASHBOARD_TEXT_MAX_CHARS = 4096;
export const DASHBOARD_LIST_MAX_ITEMS = 50;
export const DASHBOARD_LIST_ITEM_MAX_CHARS = 512;
export const DASHBOARD_MAX_PANELS_PER_BAND = 8;
export const DASHBOARD_DEFAULT_RECENT_DAYS = 14;
export const DASHBOARD_DEFAULT_LIMIT = 10;

export const DASHBOARD_PM_COMPONENT_TYPES = ['text', 'metric', 'list'] as const;
export type DashboardPmComponentType = (typeof DASHBOARD_PM_COMPONENT_TYPES)[number];

export const DASHBOARD_BAND_IDS = ['needs-you', 'moving', 'waiting'] as const;
export type DashboardBandId = (typeof DASHBOARD_BAND_IDS)[number];

export const DASHBOARD_PANEL_KINDS = {
  'needs-you': ['next-action', 'review-documents', 'publish-area'],
  moving: ['in-progress', 'queued', 'dormant', 'done-line'],
  waiting: ['pull-requests', 'live-sessions', 'agents-board', 'space-stats', 'handovers'],
} as const satisfies Record<DashboardBandId, readonly string[]>;
export type DashboardCompanionPanelKind =
  (typeof DASHBOARD_PANEL_KINDS)[DashboardBandId][number];

export type DashboardPanelOrder = 'newest' | 'oldest' | 'age' | 'stage' | 'state';

/** One PM-written text value attached to a companion panel. */
export type DashboardPanelPmLine = { id: string; instruction: string };

export type DashboardCompanionPanel = {
  id: string;
  kind: DashboardCompanionPanelKind;
  source: 'companion';
  title?: string;
  limit?: number;
  recentDays?: number;
  order?: DashboardPanelOrder;
  pmLine?: DashboardPanelPmLine;
};

export type DashboardPmPanel = {
  id: string;
  kind: DashboardPmComponentType;
  source: 'pm';
  title: string;
  instruction?: string;
  limit?: number;
};

export type DashboardPanel = DashboardCompanionPanel | DashboardPmPanel;

export type DashboardBand = {
  id: DashboardBandId;
  panels: DashboardPanel[];
};

export type DashboardDefinition = {
  version: 2;
  bands: DashboardBand[];
};

export type DashboardDefinitionSource = 'space' | 'installed-default' | 'packaged-default';

export type DashboardDefinitionDiagnostic = {
  kind:
    | 'missing'
    | 'unreadable'
    | 'invalid-json'
    | 'invalid-definition'
    | 'unsupported-version'
    | 'unsafe-path';
  message: string;
  path?: string;
};

export type ResolvedDashboardDefinition = {
  definition: DashboardDefinition;
  hash: string;
  source: DashboardDefinitionSource;
  path: string;
  /** A rejected higher-priority candidate, if fallback was required. */
  diagnostic: DashboardDefinitionDiagnostic | null;
};

export type DashboardWorkbenchDocument = {
  id: string;
  /** Relative to the Workbench root, suitable for the existing Files window. */
  path: string;
  title: string;
  kind: 'spec' | 'document';
  reviewCandidate: true;
  timestamp: string;
  timestampKind: 'creation' | 'modification';
  modifiedAt: string;
};

export type DashboardWorkbenchHandover = {
  id: string;
  /** Relative to the Workbench root, suitable for the existing Files window. */
  path: string;
  title: string;
  sessionId: string | null;
  text: string | null;
  parts: HandoverParts;
  timestamp: string;
  timestampKind: 'creation' | 'modification';
  modifiedAt: string;
  historical: true;
};

export type DashboardActivitySession = {
  id: string;
  startedAt: string;
  mode: 'read-only' | 'writing';
  purpose?: string;
  item?: { title?: string; url: string };
};

export type DashboardWorkbenchSnapshot = {
  observedAt: string;
  documents: DashboardWorkbenchDocument[];
  handovers: DashboardWorkbenchHandover[];
  activity: DashboardActivitySession[];
  problems: DashboardDefinitionDiagnostic[];
};

export type DashboardPmTextValue = {
  id: string;
  type: 'text';
  text: string;
};

export type DashboardPmMetricValue = {
  id: string;
  type: 'metric';
  value: number | string;
  unit?: string;
};

export type DashboardPmListItem = {
  id: string;
  label: string;
  value?: string;
  status?: string;
};

export type DashboardPmListValue = {
  id: string;
  type: 'list';
  items: DashboardPmListItem[];
};

export type DashboardPmUnavailableValue = {
  id: string;
  unavailable: true;
  reason: string;
};

export type DashboardPmComponentValue =
  | DashboardPmTextValue
  | DashboardPmMetricValue
  | DashboardPmListValue
  | DashboardPmUnavailableValue;

export type DashboardReportInput =
  | {
      definitionHash: string;
      components: DashboardPmComponentValue[];
      basis?: string;
    }
  | {
      /** Legacy input is retained at the type boundary so older clients receive a structured rejection. */
      markdown: string;
      basis?: string;
    };

export type DashboardReport = {
  components: DashboardPmComponentValue[];
  definitionHash: string;
  basis: string | null;
  sessionId: string;
  receivedAt: string;
  stale: boolean;
  staleReason:
    | 'project-changed'
    | 'workbench-changed'
    | 'definition-changed'
    | 'session-ended'
    | null;
};

export type DashboardRefreshStatus = 'idle' | 'requested' | 'updating' | 'updated' | 'failed';

export type DashboardRefreshReason = 'human' | 'agent' | 'verb' | 'startup';

export type DashboardRefreshState = {
  status: DashboardRefreshStatus;
  requestId: string | null;
  reason: DashboardRefreshReason | null;
  requestedAt: string | null;
  failure: { kind: string; message: string } | null;
};

export type DashboardReportState = {
  version: number;
  definition: ResolvedDashboardDefinition | null;
  context: DashboardWorkbenchSnapshot | null;
  report: DashboardReport | null;
  refresh: DashboardRefreshState;
};
