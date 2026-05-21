export type ChangeType = 'add' | 'change' | 'unlink' | 'tracker-review';
export type ChangeScope = 'payload' | 'lore';
export type TrackerSubjectKind = 'focus' | 'at-node';

export type TrackerSubject = {
  kind: TrackerSubjectKind;
  title: string;
};

export type QueueEntry = {
  id: string;
  path: string;
  type: ChangeType;
  scope: ChangeScope;
  ts: number;
  subject?: TrackerSubject;
};

export type QueuePushInput = {
  path: string;
  type: ChangeType;
  scope: ChangeScope;
  ts?: number;
  subject?: TrackerSubject;
};

export type QueueEvent =
  | { kind: 'add'; entry: QueueEntry }
  | { kind: 'replace'; entry: QueueEntry; replaces: string }
  | { kind: 'ack'; id: string }
  /** `scope` set → only that side was cleared; absent → the whole queue. */
  | { kind: 'clear'; scope?: ChangeScope };

export type QueueListener = (event: QueueEvent) => void;
