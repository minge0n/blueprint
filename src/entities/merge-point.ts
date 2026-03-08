type StringMap = Record<string, string>;

function defineStringLiterals<const TMap extends StringMap>(values: TMap): TMap {
  return values;
}

type ValueOf<TObject> = TObject[keyof TObject];

export const MERGE_POINT_STATUSES = defineStringLiterals({
  WAITING: 'waiting',
  READY: 'ready',
  PASSED: 'passed',
  FAILED: 'failed',
});

export type MergePointStatus = ValueOf<typeof MERGE_POINT_STATUSES>;

export interface MergePoint {
  readonly id: string;
  readonly feature_id: string;
  readonly trigger_fus: Array<string>;
  readonly merged_fu: string;
  readonly status: MergePointStatus;
}
