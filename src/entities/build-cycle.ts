type StringMap = Record<string, string>;

function defineStringLiterals<const TMap extends StringMap>(values: TMap): TMap {
  return values;
}

type ValueOf<TObject> = TObject[keyof TObject];

export const BUILD_CYCLE_STATUSES = defineStringLiterals({
  BUILDING: 'building',
  REVIEWING: 'reviewing',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

export type BuildCycleStatus = ValueOf<typeof BUILD_CYCLE_STATUSES>;

export const SESSION_LOG_END_REASONS = defineStringLiterals({
  COMPACT: 'compact',
  DONE: 'done',
  ERROR: 'error',
});

export type SessionLogEndReason = ValueOf<typeof SESSION_LOG_END_REASONS>;

export interface BuildCycle {
  readonly id: string;
  readonly feature_id: string;
  readonly iteration: number;
  readonly agent_id: string;
  readonly status: BuildCycleStatus;
}

export interface SessionLog {
  readonly id: string;
  readonly build_cycle_id: string;
  readonly agent_id: string;
  readonly session_id: string;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly end_reason: SessionLogEndReason | null;
}

export interface Checkpoint {
  readonly id: string;
  readonly build_cycle_id: string;
  readonly agent_id: string;
  readonly completed_fus: Array<string>;
  readonly next_fu: string | null;
  readonly notes: string | null;
}
