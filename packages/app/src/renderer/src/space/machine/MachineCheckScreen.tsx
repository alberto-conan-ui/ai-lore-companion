import type { JSX } from 'react';
import type { SpaceInitOf } from '../../../../shared/ipc.js';
import { Placeholder } from '../Placeholder.js';

type Props = { init: SpaceInitOf<'machine-check'> };

/**
 * The machine check: `git`, the GitHub CLI signed in with project access, an
 * engine signed in, `python3`; guidance and "check again". Placeholder until
 * phase M3.6 builds it. M3.6 replaces this file and keeps the exported name
 * and props; its channels go in `shared/ipc/space/machine.contract.ts`.
 */
export function MachineCheckScreen(_props: Props): JSX.Element {
  return <Placeholder title="Machine check" phase="M3.6" id="machine-check" />;
}
