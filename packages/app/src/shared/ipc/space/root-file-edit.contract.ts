/**
 * The channels the editor of the Files window reads and saves a file of a
 * root with. Added by phase M5.5; the handlers are in
 * `main/space/ipc/root-file-edit.ts` and the types in
 * `./root-file-edit.types.ts`. This fragment is spread into the Files
 * window's fragment (`./files.contract.ts`), and so reaches `CONTRACT`.
 */

import { invoke } from './describe.js';
import type {
  RootFileEditResult,
  RootFileWritten,
  RootWorkingFile,
  SpaceRootReadFileArg,
  SpaceRootWriteFileArg,
} from './root-file-edit.types.js';

export const SPACE_ROOT_FILE_EDIT_CONTRACT = {
  /** The text of a file of a root as it is in the working tree, or why it is not shown as text. */
  spaceRootReadFile: invoke<[arg: SpaceRootReadFileArg], RootFileEditResult<RootWorkingFile>>(
    'space:root-read-file',
  ),
  /** Replace the text of an existing file of a root. The Human Lead's save from the editor. */
  spaceRootWriteFile: invoke<[arg: SpaceRootWriteFileArg], RootFileEditResult<RootFileWritten>>(
    'space:root-write-file',
  ),
} as const;
