import type { DashboardModel, FocusCard } from '@ai-lore-companion/core';
import { type JSX, useState } from 'react';
import type {
  DashboardComponentDefinition,
  DashboardPmComponentValue,
  DashboardReportState,
} from '../../../../shared/ipc.js';
import './dashboard.css';
import { AgentsBoard } from './AgentsBoard.js';
import { FocusesByStage } from './FocusesByStage.js';
import { NeedsYou } from './NeedsYou.js';
import { Repositories } from './Repositories.js';

type Props = {
  state: DashboardReportState;
  model: DashboardModel | null;
  now: number;
  onOpenFocus: (focus: FocusCard) => void;
};

/**
 * The definition is data, but the renderer is closed. A component can select
 * one of the known factual widgets or one of the three typed PM values; it
 * cannot name a component, script, HTML or style at runtime.
 */
export function DashboardDefinitionRenderer({
  state,
  model,
  now,
  onOpenFocus,
}: Props): JSX.Element {
  const resolved = state.definition ?? null;
  const refresh = state.refresh ?? { status: 'idle' as const, failure: null };
  if (resolved === null) {
    return (
      <div className="dashboard-definition" data-testid="dashboard-definition">
        <p
          className="dashboard-definition-diagnostic"
          role="alert"
          data-testid="dashboard-definition-diagnostic"
        >
          No valid dashboard definition is available.{' '}
          {refresh.failure?.message ?? 'The factual dashboard remains available below.'}
        </p>
      </div>
    );
  }
  const byId = new Map(
    resolved.definition.components.map((component) => [component.id, component]),
  );
  const values = new Map(
    state.report?.definitionHash === resolved.hash
      ? state.report.components.map((value) => [value.id, value])
      : [],
  );
  const seen = new Set<string>();

  return (
    <div
      className="dashboard-definition"
      data-testid="dashboard-definition"
      data-definition-hash={resolved.hash}
    >
      <div className="dashboard-definition-toolbar">
        <div
          className="dashboard-definition-status"
          aria-live="polite"
          data-testid="dashboard-refresh-status"
          data-refresh-status={refresh.status}
        >
          {resolved.source !== 'space'
            ? `Using the ${resolved.source === 'packaged-default' ? 'packaged' : 'installed'} default dashboard definition.`
            : null}
          {resolved.diagnostic ? ` ${resolved.diagnostic.message}` : null}
          {state.report?.stale
            ? ` PM interpretation may be out of date: ${state.report.staleReason ?? 'source changed'}.`
            : null}
          {state.report?.receivedAt
            ? ` Accepted ${formatTimestamp(state.report.receivedAt)} from ${state.report.sessionId}.`
            : null}
          {state.report?.basis ? ` Sources named by PM: ${state.report.basis}.` : null}
          {!state.report && refresh.status !== 'updated'
            ? ' PM components have not been updated yet.'
            : null}
          {refresh.status === 'requested' ? ' Requesting a PM update.' : null}
          {refresh.status === 'updating' ? ' Updating dashboard data.' : null}
          {refresh.status === 'failed' && refresh.failure
            ? ` Dashboard update failed: ${refresh.failure.message}`
            : null}
        </div>
      </div>
      {refresh.status === 'failed' && refresh.failure ? (
        <p
          className="dashboard-definition-diagnostic"
          role="alert"
          data-testid="dashboard-refresh-failure"
        >
          {refresh.failure.message} Previous accepted dashboard data is retained.
        </p>
      ) : null}
      {resolved.diagnostic ? (
        <p
          className="dashboard-definition-diagnostic"
          role="alert"
          data-testid="dashboard-definition-diagnostic"
        >
          {resolved.diagnostic.message} Showing a valid fallback definition.
        </p>
      ) : null}
      {resolved.definition.sections.map((section) => (
        <section
          className="dashboard-definition-section"
          key={section.id}
          data-testid={`dashboard-definition-section-${section.id}`}
        >
          <h2 className="dashboard-heading">{section.title}</h2>
          <div className="dashboard-definition-columns">
            {section.columns.map((column, columnIndex) => (
              <div
                className="dashboard-definition-column"
                key={`${section.id}-${columnIndex}`}
                data-testid="dashboard-definition-column"
              >
                {column.map((componentId) => {
                  const component = byId.get(componentId);
                  if (!component || seen.has(componentId)) return null;
                  seen.add(componentId);
                  return (
                    <ComponentView
                      key={component.id}
                      component={component}
                      value={values.get(component.id)}
                      state={state}
                      model={model}
                      now={now}
                      onOpenFocus={onOpenFocus}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ComponentView({
  component,
  value,
  state,
  model,
  now,
  onOpenFocus,
}: {
  component: DashboardComponentDefinition;
  value?: DashboardPmComponentValue;
  state: DashboardReportState;
  model: DashboardModel | null;
  now: number;
  onOpenFocus: (focus: FocusCard) => void;
}): JSX.Element {
  const heading = <h3 className="dashboard-definition-component-title">{component.title}</h3>;
  switch (component.type) {
    case 'needs-you':
      return (
        <section
          className="dashboard-definition-factual"
          data-testid={`dashboard-component-${component.id}`}
        >
          {model ? (
            <NeedsYou
              entries={model.needsYou}
              title={component.title}
              onOpenFocus={(focus) => {
                const found = findFocus(model, focus.url);
                if (found) onOpenFocus(found);
              }}
            />
          ) : (
            <EmptyFactual heading={heading} text="Needs-you entries are not available yet." />
          )}
        </section>
      );
    case 'plan':
      return (
        <section
          className="dashboard-definition-factual"
          data-testid={`dashboard-component-${component.id}`}
        >
          {heading}
          {model ? (
            <FocusesByStage model={model} onOpen={onOpenFocus} />
          ) : (
            <p className="dashboard-empty">The current plan is not available yet.</p>
          )}
        </section>
      );
    case 'agents':
      return (
        <section
          className="dashboard-definition-factual"
          data-testid={`dashboard-component-${component.id}`}
        >
          {model ? (
            <AgentsBoard board={model.board} title={component.title} />
          ) : (
            <EmptyFactual heading={heading} text="The Agents board is not available yet." />
          )}
        </section>
      );
    case 'repositories':
      return (
        <section
          className="dashboard-definition-factual"
          data-testid={`dashboard-component-${component.id}`}
        >
          <Repositories now={now} title={component.title} />
        </section>
      );
    case 'workbench-docs':
      return (
        <section
          className="dashboard-definition-card"
          data-testid={`dashboard-component-${component.id}`}
        >
          {heading}
          <WorkbenchProblems state={state} />
          <DocumentList
            documents={state.context?.documents ?? []}
            limit={component.limit}
            recentDays={component.recentDays}
            now={now}
          />
        </section>
      );
    case 'handovers':
      return (
        <section
          className="dashboard-definition-card"
          data-testid={`dashboard-component-${component.id}`}
        >
          {heading}
          <HandoverList state={state} limit={component.limit} />
        </section>
      );
    case 'activity':
      return (
        <section
          className="dashboard-definition-card"
          data-testid={`dashboard-component-${component.id}`}
        >
          {heading}
          <ActivityList state={state} limit={component.limit} />
        </section>
      );
    case 'text':
    case 'metric':
    case 'list':
      return (
        <section
          className="dashboard-definition-card"
          data-testid={`dashboard-component-${component.id}`}
        >
          {heading}
          <PmValue value={value} expected={component.type} />
        </section>
      );
  }
}

function EmptyFactual({ heading, text }: { heading: JSX.Element; text: string }): JSX.Element {
  return (
    <>
      {heading}
      <p className="dashboard-empty">{text}</p>
    </>
  );
}

function PmValue({
  value,
  expected,
}: { value?: DashboardPmComponentValue; expected: 'text' | 'metric' | 'list' }): JSX.Element {
  if (!value) return <p className="dashboard-empty">No data is available yet.</p>;
  if ('unavailable' in value)
    return <p className="dashboard-definition-unavailable">Unavailable: {value.reason}</p>;
  if (value.type !== expected)
    return (
      <p className="dashboard-definition-unavailable">
        Unavailable: the PM returned the wrong value type.
      </p>
    );
  if (value.type === 'text') return <p className="dashboard-definition-text">{value.text}</p>;
  if (value.type === 'metric')
    return (
      <p className="dashboard-definition-metric">
        <strong>{String(value.value)}</strong>
        {value.unit ? <span>{value.unit}</span> : null}
      </p>
    );
  if (value.items.length === 0) return <p className="dashboard-empty">Nothing to show.</p>;
  return (
    <ul className="dashboard-definition-list">
      {value.items.map((item) => (
        <li key={item.id}>
          <span>{item.label}</span>
          {item.value ? <span className="dashboard-muted">{item.value}</span> : null}
          {item.status ? <span className="dashboard-definition-status">{item.status}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function DocumentList({
  documents,
  limit,
  recentDays,
  now,
}: {
  documents: readonly {
    id: string;
    path: string;
    title: string;
    kind: string;
    timestamp: string;
    timestampKind: string;
  }[];
  limit?: number;
  recentDays?: number;
  now: number;
}): JSX.Element {
  const cutoff = now - (recentDays ?? 14) * 86_400_000;
  const entries = documents
    .filter((document) => Date.parse(document.timestamp) >= cutoff)
    .slice(0, Math.max(0, limit ?? 10));
  if (entries.length === 0)
    return <p className="dashboard-empty">No recent Workbench documents.</p>;
  return (
    <ul className="dashboard-definition-list dashboard-definition-documents">
      {entries.map((document) => (
        <li key={document.id}>
          <WorkbenchFileLink path={document.path} title={document.title} />
          <span className="dashboard-muted">
            Draft {document.kind} · {formatTimestamp(document.timestamp)} ({document.timestampKind})
          </span>
        </li>
      ))}
    </ul>
  );
}

function WorkbenchProblems({ state }: { state: DashboardReportState }): JSX.Element | null {
  const problems = state.context?.problems ?? [];
  if (problems.length === 0) return null;
  return (
    <output className="dashboard-definition-unavailable" data-testid="dashboard-workbench-problems">
      {problems.map((problem) => (
        <p key={`${problem.kind}:${problem.path ?? problem.message}`}>
          {problem.message}
          {problem.path ? ` (${problem.path})` : ''}
        </p>
      ))}
    </output>
  );
}

function HandoverList({
  state,
  limit,
}: { state: DashboardReportState; limit?: number }): JSX.Element {
  const entries = (state.context?.handovers ?? []).slice(0, Math.max(0, limit ?? 5));
  if (entries.length === 0) return <p className="dashboard-empty">No recent handovers.</p>;
  return (
    <ul className="dashboard-definition-list dashboard-definition-documents">
      {entries.map((handover) => (
        <li key={handover.id}>
          <WorkbenchFileLink path={handover.path} title={handover.title} />
          <span className="dashboard-muted">
            Historical handover · {handover.text ?? 'No handover text recorded.'} ·{' '}
            {formatTimestamp(handover.timestamp)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ActivityList({
  state,
  limit,
}: { state: DashboardReportState; limit?: number }): JSX.Element {
  const entries = (state.context?.activity ?? []).slice(0, Math.max(0, limit ?? 10));
  if (entries.length === 0) return <p className="dashboard-empty">No local sessions are open.</p>;
  return (
    <ul className="dashboard-definition-list">
      {entries.map((session) => (
        <li key={session.id}>
          <span>{session.id}</span>
          <span className="dashboard-muted">
            {session.mode}
            {session.purpose ? ` · ${session.purpose}` : ''}
            {session.item ? ` · ${session.item.title ?? session.item.url}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

function findFocus(model: DashboardModel, url: string): FocusCard | null {
  for (const column of model.columns) {
    const found = column.focuses.find((focus) => focus.issue.url === url);
    if (found) return found;
  }
  return model.unstaged.find((focus) => focus.issue.url === url) ?? null;
}

function WorkbenchFileLink({ path, title }: { path: string; title: string }): JSX.Element {
  const [problem, setProblem] = useState<string | null>(null);
  const open = async (): Promise<void> => {
    setProblem(null);
    try {
      const result = await window.cockpit.spaceNavigate({
        to: 'space-files',
        open: { rootId: 'workbench', relPath: path },
      });
      if (!result.ok) setProblem(result.error.message);
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : String(caught));
    }
  };
  return (
    <>
      <button type="button" className="dashboard-definition-link" onClick={() => void open()}>
        {title}
      </button>
      {problem ? (
        <span role="alert">
          Could not open {path}: {problem}
        </span>
      ) : null}
    </>
  );
}

function formatTimestamp(value: string): string {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
}
