type StringMap = Record<string, string>;

function defineStringLiterals<const TMap extends StringMap>(values: TMap): TMap {
  return values;
}

type ValueOf<TObject> = TObject[keyof TObject];

export const WORK_LOCK_STATUSES = defineStringLiterals({
  ACTIVE: 'active',
  RELEASED: 'released',
  EXPIRED: 'expired',
});

export type WorkLockStatus = ValueOf<typeof WORK_LOCK_STATUSES>;

export interface WorkLock {
  readonly id: string;
  readonly fu_id: string;
  readonly agent_id: string;
  readonly acquired_at: string;
  readonly heartbeat_at: string;
  readonly released_at: string | null;
  readonly release_reason: string | null;
  readonly ttl_seconds: number;
  readonly status: WorkLockStatus;
}
