import { type JSX, useEffect, useState } from 'react';
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

  return (
    <div className="dashboard-v2" style={{ padding: 'var(--d-page-pad)' }}>
      <div style={{ height: '56px' }}>Dashboard</div>

      <div className="dashboard-v2-band1" />

      <div className="dashboard-v2-row2">
        <div />
        <div />
        <div />
      </div>

      {openUrl && project?.snapshot && (
        <FocusSheet
          projectUrl={project.snapshot.project.url}
          issueUrl={openUrl}
          onClose={() => setOpenUrl(null)}
        />
      )}
    </div>
  );
}
