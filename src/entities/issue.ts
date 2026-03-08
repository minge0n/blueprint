type StringMap = Record<string, string>;

function defineStringLiterals<const TMap extends StringMap>(values: TMap): TMap {
  return values;
}

type ValueOf<TObject> = TObject[keyof TObject];

export const ISSUE_PARENT_TYPES = defineStringLiterals({
  PLAN: 'plan',
  BUILD: 'build',
});

export type IssueParentType = ValueOf<typeof ISSUE_PARENT_TYPES>;

export const ISSUE_CATEGORIES = defineStringLiterals({
  MISSING_CASE: 'missing_case',
  WRONG_ASSUMPTION: 'wrong_assumption',
  SCOPE_CREEP: 'scope_creep',
  AMBIGUITY: 'ambiguity',
  DEPENDENCY_GAP: 'dependency_gap',
  SECURITY_GAP: 'security_gap',
  PERFORMANCE_GAP: 'performance_gap',
  IMPLEMENTATION: 'implementation',
  INTEGRATION_CONFLICT: 'integration_conflict',
  RACE_CONDITION: 'race_condition',
  INTERFACE_MISMATCH: 'interface_mismatch',
});

export type IssueCategory = ValueOf<typeof ISSUE_CATEGORIES>;

export const ISSUE_SEVERITIES = defineStringLiterals({
  CRITICAL: 'critical',
  MAJOR: 'major',
  MINOR: 'minor',
  NITPICK: 'nitpick',
});

export type IssueSeverity = ValueOf<typeof ISSUE_SEVERITIES>;

export const ISSUE_STATUSES = defineStringLiterals({
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
  WONT_FIX: 'wont_fix',
});

export type IssueStatus = ValueOf<typeof ISSUE_STATUSES>;

export interface Issue {
  readonly id: string;
  readonly parent_type: IssueParentType;
  readonly parent_id: string;
  readonly fu_id: string;
  readonly ac_id: string | null;
  readonly related_fu_id: string | null;
  readonly category: IssueCategory;
  readonly severity: IssueSeverity;
  readonly title: string;
  readonly description: string;
  readonly suggested_fix: string | null;
  readonly status: IssueStatus;
  readonly resolved_in: string | null;
  readonly resolution_note: string | null;
}
