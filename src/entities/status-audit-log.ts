type StringMap = Record<string, string>;

function defineStringLiterals<const TMap extends StringMap>(values: TMap): TMap {
  return values;
}

type ValueOf<TObject> = TObject[keyof TObject];

export const STATUS_AUDIT_LOG_ENTITY_TYPES = defineStringLiterals({
  FEATURE: 'feature',
  FUNCTION_UNIT: 'function_unit',
  ACCEPTANCE_CRITERIA: 'acceptance_criteria',
  PLAN_CYCLE: 'plan_cycle',
  BUILD_CYCLE: 'build_cycle',
});

export type StatusAuditLogEntityType = ValueOf<typeof STATUS_AUDIT_LOG_ENTITY_TYPES>;

export interface StatusAuditLog {
  readonly id: number;
  readonly entity_type: StatusAuditLogEntityType;
  readonly entity_id: string;
  readonly old_status: string | null;
  readonly new_status: string;
  readonly changed_at: string;
  readonly changed_by: string | null;
  readonly context: string | null;
}

export interface LogStatusChangeInput {
  readonly entity_type: StatusAuditLogEntityType;
  readonly entity_id: string;
  readonly old_status: string | null;
  readonly new_status: string;
  readonly changed_by?: string;
  readonly context?: string;
}
