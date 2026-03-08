type StringMap = Record<string, string>;

function defineStringLiterals<const TMap extends StringMap>(values: TMap): TMap {
  return values;
}

type ValueOf<TObject> = TObject[keyof TObject];

export const FEATURE_STATUSES = defineStringLiterals({
  DRAFT: 'draft',
  PLAN_REVIEW: 'plan_review',
  BUILDING: 'building',
  BUILD_REVIEW: 'build_review',
  DONE: 'done',
});

export type FeatureStatus = ValueOf<typeof FEATURE_STATUSES>;

export const FEATURE_PRIORITIES = defineStringLiterals({
  P0: 'p0',
  P1: 'p1',
  P2: 'p2',
});

export type FeaturePriority = ValueOf<typeof FEATURE_PRIORITIES>;

export const FUNCTION_UNIT_STATUSES = defineStringLiterals({
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  PASSED: 'passed',
  FAILED: 'failed',
});

export type FunctionUnitStatus = ValueOf<typeof FUNCTION_UNIT_STATUSES>;

export const FUNCTION_UNIT_DEPENDENCY_TYPES = defineStringLiterals({
  HARD: 'hard',
  SOFT: 'soft',
});

export type FunctionUnitDependencyType = ValueOf<typeof FUNCTION_UNIT_DEPENDENCY_TYPES>;

export const ACCEPTANCE_CRITERIA_TYPES = defineStringLiterals({
  FUNCTIONAL: 'functional',
  PERFORMANCE: 'performance',
  SECURITY: 'security',
  EDGE_CASE: 'edge_case',
});

export type AcceptanceCriteriaType = ValueOf<typeof ACCEPTANCE_CRITERIA_TYPES>;

export const ACCEPTANCE_CRITERIA_SEVERITIES = defineStringLiterals({
  MUST: 'must',
  SHOULD: 'should',
  NICE_TO_HAVE: 'nice_to_have',
});

export type AcceptanceCriteriaSeverity = ValueOf<typeof ACCEPTANCE_CRITERIA_SEVERITIES>;

export const ACCEPTANCE_CRITERIA_STATUSES = defineStringLiterals({
  NOT_TESTED: 'not_tested',
  PASSED: 'passed',
  FAILED: 'failed',
  BLOCKED: 'blocked',
});

export type AcceptanceCriteriaStatus = ValueOf<typeof ACCEPTANCE_CRITERIA_STATUSES>;
