import type { FocusCard } from '@ai-lore-companion/core';
import type { JSX, ReactNode } from 'react';
import type {
  DashboardReportState,
  SpaceProjectState,
  SpaceRepositoriesState,
} from '../../../../../shared/ipc.js';
import type { PlansStateView } from '../usePlansState.js';
import { BandMoving } from './BandMoving.js';
import { BandNeedsYou } from './BandNeedsYou.js';
import { BandPlans } from './BandPlans.js';
import { DashboardV2Shell } from './DashboardV2.js';
import { Handovers } from './Handovers.js';
import { WaitingBand } from './WaitingBand.js';

export type DashboardContentProps = {
  project: SpaceProjectState | null;
  repositories: SpaceRepositoriesState | null;
  reportState: DashboardReportState | null;
  now: number;
  header: ReactNode;
  onOpenFocus: (focus: FocusCard) => void;
  onOpenBoard?: () => void;
  /** The Space's plans; without it the Plans band is not drawn. */
  plans?: PlansStateView;
};

/** The validated definition selects panels; each band renders only its closed vocabulary. */
export function DashboardContent({
  project,
  repositories,
  reportState,
  now,
  header,
  onOpenFocus,
  onOpenBoard,
  plans,
}: DashboardContentProps): JSX.Element {
  const bands = reportState?.definition?.definition.bands ?? [];
  const panels = (id: 'needs-you' | 'moving' | 'waiting') =>
    bands.find((band) => band.id === id)?.panels ?? [];
  return (
    <DashboardV2Shell
      now={now}
      slots={{
        header,
        band1: (
          <BandNeedsYou
            panels={panels('needs-you')}
            project={project}
            reportState={reportState}
            repositories={repositories}
            now={now}
            onOpenFocus={onOpenFocus}
          />
        ),
        plans: plans === undefined ? undefined : <BandPlans view={plans} now={now} />,
        moving: (
          <BandMoving
            panels={panels('moving')}
            project={project}
            reportState={reportState}
            now={now}
            onOpenFocus={onOpenFocus}
          />
        ),
        waiting: (
          <WaitingBand
            panels={panels('waiting').filter((panel) => panel.kind !== 'handovers')}
            project={project}
            reportState={reportState}
            now={now}
            onOpenBoard={onOpenBoard}
          />
        ),
        handovers: (
          <Handovers
            panels={panels('waiting').filter((panel) => panel.kind === 'handovers')}
            reportState={reportState}
            now={now}
          />
        ),
      }}
    />
  );
}
