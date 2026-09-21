import { type JSX, useEffect, useState } from 'react';
import type { DashboardModel, FocusCard } from '@ai-lore-companion/core';
import { FocusSheet } from '../FocusSheet.js';
import { useDashboardDefinition } from '../useDashboardDefinition.js';
import { useProjectState } from '../useProjectState.js';
import './dashboard-v2.css';

const AGE_TICK_MS = 30 * 1000;

export type Props = {
  justCreated?: boolean;
};

export function DashboardV2({ justCreated }: Props = {}): JSX.Element {
  const { project } = useProjectState();
  const _dashboard = useDashboardDefinition(); // not used yet

  const [now, setNow] = useState(Date.now());
  const [openUrl, setOpenUrl] = useState<string | null>(null);

  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => clearInterval(handle);
  }, []);

  const model = project?.model ?? null;
  const openFocus = model === null || openUrl === null ? null : findFocus(model, openUrl);

  return (
    <div className="dashboard-v2" style={{ padding: 'var(--d-page-pad)' }}>
      <div style={{ height: '56px' }}>Dashboard</div>

      <div className="dashboard-v2-band1" />

      <div className="dashboard-v2-row2">
        <div />
        <div />
        <div />
      </div>

      <div className="dashboard-v2-overflow-footer">
        +N more
      </div>

      {openFocus !== null ? (
        <FocusSheet
          focus={openFocus}
          onClose={() => setOpenUrl(null)}
        />
      ) : null}
    </div>
  );
}

function findFocus(model: DashboardModel, url: string): FocusCard | null {
  for (const column of model.columns) {
    const found = column.focuses.find((focus) => focus.issue.url === url);
    if (found) return found;
  }
  return model.unstaged.find((focus) => focus.issue.url === url) ?? null;
}
