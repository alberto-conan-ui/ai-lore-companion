/**
 * The Lore readiness report of one engine option (phase M10.5,
 * `m10-architecture.md` 3.6): what an adapter's static capability says,
 * adjusted by the live checks readiness already ran.
 */

import type { SpaceEngineLore, SpaceLoreLine } from '../../../../shared/ipc.js';
import type { SessionReadiness } from '../service.js';
import type { EngineAdapter, LoreLine } from './types.js';

const NO_ADAPTER_LINES: SpaceLoreLine[] = [
  { aspect: 'lore', state: 'no', text: 'The companion cannot give this engine the Lore yet.' },
  { aspect: 'session-tools', state: 'no', text: 'It would not have the session tools.' },
  { aspect: 'guard', state: 'no', text: 'Its writes would not be guarded.' },
];

function asLine(line: LoreLine): SpaceLoreLine {
  return { aspect: line.aspect, state: line.state, text: line.text };
}

function allYes(lines: readonly SpaceLoreLine[]): boolean {
  return lines.every((line) => line.state === 'yes');
}

/**
 * The report for one engine: no adapter gives three `no` lines; otherwise the
 * adapter's static capability, adjusted by the readiness failure's kind (a
 * missing install, an altered check script, a missing `python3`), and by
 * whether the install holds any skill at all.
 */
export function loreReadiness(
  adapter: EngineAdapter | null,
  readiness: SessionReadiness,
  skillCount: number | null,
): SpaceEngineLore {
  if (adapter === null) {
    return { lines: NO_ADAPTER_LINES, asClaudeCode: false };
  }
  const lines: SpaceLoreLine[] = [
    asLine(adapter.capability.lore),
    asLine(adapter.capability.sessionTools),
    asLine(adapter.capability.guard),
  ];
  if (!readiness.ok) {
    switch (readiness.error.kind) {
      case 'not-installed':
      case 'install-record-unreadable':
      case 'install-record-newer':
      case 'plugin-missing':
        lines[0] = {
          aspect: 'lore',
          state: 'no',
          text: 'The Lore is not installed for this Space.',
        };
        break;
      case 'check-missing':
      case 'check-altered':
        lines[2] = {
          aspect: 'guard',
          state: 'no',
          text: "The write-guard's check scripts are not installed as the install recorded them.",
        };
        break;
      case 'python3-missing':
        lines[2] = {
          aspect: 'guard',
          state: 'no',
          text: 'python3 3.8 or later was not found; the write-guard runs with it.',
        };
        break;
      default:
        // `engine-not-installed`, `engine-not-signed-in`, `engine-not-found`, and anything
        // else: the option's own reason already says it; no line changes.
        break;
    }
  } else if (skillCount === 0) {
    lines[0] = {
      aspect: 'lore',
      state: 'partly',
      text: 'The install holds no verb; install the Lore again.',
    };
  }
  return { lines, asClaudeCode: allYes(lines) };
}
