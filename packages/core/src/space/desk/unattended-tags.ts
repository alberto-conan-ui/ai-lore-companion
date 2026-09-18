/**
 * `unattended-tags.json`: the items tagged for unattended work.
 *
 * Stage M2 lists the record, and unattended sessions are a non-goal of the
 * MVP, so nothing in the MVP calls the write functions.
 */

import { type Result, ok } from '../result.js';
import type { Desk, DeskFailure } from './desk.js';
import { isUnattendedTag } from './guards.js';
import {
  type DeskRecordFile,
  appendDeskRecord,
  readDeskRecords,
  updateDeskRecords,
} from './store.js';
import type { IssueRef, UnattendedTag } from './types.js';

/** The record file of the unattended tags. */
export const UNATTENDED_TAGS_FILE: DeskRecordFile<UnattendedTag> = {
  name: 'unattendedTags',
  guard: isUnattendedTag,
};

function sameIssue(a: IssueRef, b: IssueRef): boolean {
  return a.repository === b.repository && a.number === b.number;
}

/** Every unattended tag, oldest first. */
export function listUnattendedTags(desk: Desk): Result<UnattendedTag[], DeskFailure> {
  return readDeskRecords(desk, UNATTENDED_TAGS_FILE);
}

/** Tag `item` for unattended work, now. Fails with `duplicate` when it is tagged already. */
export function addUnattendedTag(desk: Desk, item: IssueRef): Result<UnattendedTag, DeskFailure> {
  return appendDeskRecord(
    desk,
    UNATTENDED_TAGS_FILE,
    { item, taggedAt: desk.now().toISOString() },
    (records) =>
      records.some((record) => isUnattendedTag(record) && sameIssue(record.item, item))
        ? { kind: 'duplicate', message: `${item.repository}#${item.number} is tagged already` }
        : null,
  );
}

/** Remove the tag of `item`. Returns the tags that were removed. */
export function removeUnattendedTag(
  desk: Desk,
  item: Pick<IssueRef, 'repository' | 'number'>,
): Result<UnattendedTag[], DeskFailure> {
  return updateDeskRecords(desk, UNATTENDED_TAGS_FILE, (records) => {
    const removed: UnattendedTag[] = [];
    const kept = records.filter((record) => {
      const matches =
        isUnattendedTag(record) &&
        record.item.repository === item.repository &&
        record.item.number === item.number;
      if (matches) removed.push(record);
      return !matches;
    });
    return ok({ records: removed.length > 0 ? kept : null, value: removed });
  });
}
