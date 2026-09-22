import type { JSX, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import './dashboard-v2.css';

const AGE_TICK_MS = 30 * 1000;

export type DashboardV2Slots = {
  header?: ReactNode;
  band1?: ReactNode;
  moving?: ReactNode;
  waiting?: ReactNode;
  handovers?: ReactNode;
};

export type DashboardV2Props = {
  justCreated?: boolean;
  slots?: DashboardV2Slots;
};

export function DashboardV2({ justCreated, slots = {} }: DashboardV2Props = {}): JSX.Element {
  void justCreated;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return <DashboardV2Shell now={now} slots={slots} />;
}

export function DashboardV2Shell({
  now,
  slots = {},
}: {
  now: number;
  slots?: DashboardV2Slots;
}): JSX.Element {
  return (
    <main
      className="dashboard-v2"
      aria-label="Dashboard"
      data-testid="dashboard-v2"
      data-now={String(now)}
    >
      <header className="dashboard-v2-header" data-testid="dashboard-v2-header">
        {slots.header ?? <h1>Dashboard</h1>}
      </header>
      <section
        className="dashboard-v2-band1"
        aria-label="Needs you"
        data-testid="dashboard-v2-band1"
      >
        {slots.band1 ?? (
          <>
            <DashboardV2Panel title="NEEDS YOU" />
            <DashboardV2Panel title="LOCAL WORKBENCH" />
            <DashboardV2Panel title="PUBLISH AREA" />
          </>
        )}
      </section>
      <div className="dashboard-v2-row2" data-testid="dashboard-v2-row2">
        {slots.moving ?? <DashboardV2Panel title="WHAT IS MOVING" />}
        {slots.waiting ?? <DashboardV2Panel title="WHAT IS WAITING" />}
        {slots.handovers ?? <DashboardV2Panel title="HANDOVERS" />}
      </div>
    </main>
  );
}

function DashboardV2Panel({ title }: { title: string }): JSX.Element {
  return (
    <article className="dashboard-v2-panel">
      <h2>{title}</h2>
      <p className="dashboard-v2-empty">Awaiting dashboard data.</p>
    </article>
  );
}
