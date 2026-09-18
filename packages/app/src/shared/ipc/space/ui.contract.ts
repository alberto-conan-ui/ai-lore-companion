/**
 * The channels the Files window reads and saves what it remembers with
 * (phase M5.7): the open documents, the selected root and the baselines the
 * Human Lead picked. The handlers are in `main/space/ipc/ui.ts` and the types
 * in `./ui.types.ts`. This fragment is spread into the Files window's fragment
 * (`./files.contract.ts`), and so reaches `CONTRACT`.
 */

import { invoke } from './describe.js';
import type {
  SpaceUiRead,
  SpaceUiReadArg,
  SpaceUiResult,
  SpaceUiSaveArg,
  SpaceUiSaved,
} from './ui.types.js';

export const SPACE_UI_CONTRACT = {
  /** What was saved for one concern of the calling window's Space, or `null` with a notice. */
  spaceUiRead: invoke<[arg: SpaceUiReadArg], SpaceUiResult<SpaceUiRead>>('space:ui-read'),
  /** Save one concern. Written shortly after, and only while no other window of the Space has the focus. */
  spaceUiSave: invoke<[arg: SpaceUiSaveArg], SpaceUiResult<SpaceUiSaved>>('space:ui-save'),
} as const;
