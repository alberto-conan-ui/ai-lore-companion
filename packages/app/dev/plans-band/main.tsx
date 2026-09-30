import { type JSX, StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { usePlansState } from '../../src/renderer/src/space/dashboard/usePlansState.js';
import { BandPlans } from '../../src/renderer/src/space/dashboard/v2/BandPlans.js';
import { DashboardV2Shell } from '../../src/renderer/src/space/dashboard/v2/DashboardV2.js';
import type { SpacePlansOpenResult, SpacePlansStateResult } from '../../src/shared/ipc.js';

// The Plans band in a browser (see vite.config.ts). `window.cockpit` is four channels over fetch; everything else is the
// companion's own renderer code.

const SIMS = ['demo', 'incomplete', 'refused', 'unreachable', 'empty', 'none', 'live'];
const sim = new URLSearchParams(window.location.search).get('sim') ?? 'demo';

const call = async <T,>(path: string): Promise<T> => {
  const response = await fetch(`/__plans/${path}${path.includes('?') ? '&' : '?'}sim=${sim}`);
  return (await response.json()) as T;
};

let listener: ((state: unknown) => void) | null = null;
(window as unknown as { cockpit: unknown }).cockpit = {
  spacePlansState: () => call<SpacePlansStateResult>('state'),
  spacePlansRefresh: async () => {
    const answer = await call<SpacePlansStateResult>('refresh');
    if (answer.ok) listener?.(answer.value);
    return answer;
  },
  spacePlansOpen: async ({ number }: { number: number }) => {
    const answer = await call<SpacePlansOpenResult>(`open?number=${String(number)}`);
    if (answer.ok) window.open(answer.url, '_blank', 'noopener');
    return answer;
  },
  onSpacePlansState: (next: (state: unknown) => void) => {
    listener = next;
    return () => {
      listener = null;
    };
  },
};

function Page(): JSX.Element {
  const plans = usePlansState();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <DashboardV2Shell
      now={now}
      slots={{
        header: (
          <div className="dashboard-v2-title-row">
            <div>
              <h1>Dashboard</h1>
              <p className="dashboard-v2-muted">
                Plans band harness · state:{' '}
                {SIMS.map((name) => (
                  <a
                    key={name}
                    href={`?sim=${name}`}
                    style={{ marginRight: 8, fontWeight: name === sim ? 700 : 400 }}
                  >
                    {name}
                  </a>
                ))}
              </p>
            </div>
            <div className="dashboard-v2-header-actions">
              <button type="button" onClick={plans.refresh} disabled={plans.requested}>
                {plans.requested ? 'Refreshing' : 'Refresh'}
              </button>
            </div>
          </div>
        ),
        plans: <BandPlans view={plans} now={now} />,
      }}
    />
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Page />
    </StrictMode>,
  );
}
