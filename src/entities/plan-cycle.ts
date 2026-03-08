import type { FeaturePriority, FeatureStatus } from './types.js';
import {
  ACCEPTANCE_CRITERIA_SEVERITIES,
  ACCEPTANCE_CRITERIA_STATUSES,
  ACCEPTANCE_CRITERIA_TYPES,
  FEATURE_PRIORITIES,
  FEATURE_STATUSES,
  FUNCTION_UNIT_DEPENDENCY_TYPES,
  FUNCTION_UNIT_STATUSES,
  type AcceptanceCriteriaSeverity,
  type AcceptanceCriteriaStatus,
  type AcceptanceCriteriaType,
  type FunctionUnitDependencyType,
  type FunctionUnitStatus,
} from './types.js';

type StringMap = Record<string, string>;

function defineStringLiterals<const TMap extends StringMap>(values: TMap): TMap {
  return values;
}

type ValueOf<TObject> = TObject[keyof TObject];

export const PLAN_CYCLE_STATUSES = defineStringLiterals({
  DRAFTING: 'drafting',
  REVIEWING: 'reviewing',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

export type PlanCycleStatus = ValueOf<typeof PLAN_CYCLE_STATUSES>;

export interface PlanCycleSnapshotFunctionUnitDependency {
  readonly fu_id: string;
  readonly type: FunctionUnitDependencyType;
}

export interface PlanCycleSnapshotAcceptanceCriteria {
  readonly id: string;
  readonly fu_id: string;
  readonly description: string;
  readonly type: AcceptanceCriteriaType;
  readonly severity: AcceptanceCriteriaSeverity;
  readonly status: AcceptanceCriteriaStatus;
  readonly verified_in: string | null;
  readonly evidence: string | null;
}

export interface PlanCycleSnapshotFunctionUnit {
  readonly id: string;
  readonly feature_id: string;
  readonly title: string;
  readonly description: string;
  readonly acceptance_criteria: Array<PlanCycleSnapshotAcceptanceCriteria>;
  readonly depends_on: Array<PlanCycleSnapshotFunctionUnitDependency>;
  readonly status: FunctionUnitStatus;
  readonly assigned_agent: string | null;
  readonly test_evidence: string | null;
  readonly failure_reason: string | null;
}

export interface PlanCycleSnapshotFeature {
  readonly id: string;
  readonly title: string;
  readonly scope: string;
  readonly out_of_scope: string;
  readonly status: FeatureStatus;
  readonly priority: FeaturePriority;
  readonly depends_on: Array<string>;
}

export interface PlanCycleSnapshot {
  readonly captured_at: string;
  readonly feature: PlanCycleSnapshotFeature;
  readonly function_units: Array<PlanCycleSnapshotFunctionUnit>;
}

export interface PlanCycle {
  readonly id: string;
  readonly feature_id: string;
  readonly iteration: number;
  readonly plan_snapshot: PlanCycleSnapshot;
  readonly status: PlanCycleStatus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return true;
}

function isStringArray(value: unknown): value is Array<string> {
  if (!Array.isArray(value)) {
    return false;
  }

  for (const entry of value) {
    if (typeof entry !== 'string') {
      return false;
    }
  }

  return true;
}

function isFeaturePriority(value: string): value is FeaturePriority {
  switch (value) {
    case FEATURE_PRIORITIES.P0:
    case FEATURE_PRIORITIES.P1:
    case FEATURE_PRIORITIES.P2:
      return true;
    default:
      return false;
  }
}

function isFeatureStatus(value: string): value is FeatureStatus {
  switch (value) {
    case FEATURE_STATUSES.DRAFT:
    case FEATURE_STATUSES.PLAN_REVIEW:
    case FEATURE_STATUSES.BUILDING:
    case FEATURE_STATUSES.BUILD_REVIEW:
    case FEATURE_STATUSES.DONE:
      return true;
    default:
      return false;
  }
}

function isFunctionUnitStatus(value: string): value is FunctionUnitStatus {
  switch (value) {
    case FUNCTION_UNIT_STATUSES.PENDING:
    case FUNCTION_UNIT_STATUSES.IN_PROGRESS:
    case FUNCTION_UNIT_STATUSES.PASSED:
    case FUNCTION_UNIT_STATUSES.FAILED:
      return true;
    default:
      return false;
  }
}

function isFunctionUnitDependencyType(value: string): value is FunctionUnitDependencyType {
  switch (value) {
    case FUNCTION_UNIT_DEPENDENCY_TYPES.HARD:
    case FUNCTION_UNIT_DEPENDENCY_TYPES.SOFT:
      return true;
    default:
      return false;
  }
}

function isAcceptanceCriteriaType(value: string): value is AcceptanceCriteriaType {
  switch (value) {
    case ACCEPTANCE_CRITERIA_TYPES.FUNCTIONAL:
    case ACCEPTANCE_CRITERIA_TYPES.PERFORMANCE:
    case ACCEPTANCE_CRITERIA_TYPES.SECURITY:
    case ACCEPTANCE_CRITERIA_TYPES.EDGE_CASE:
      return true;
    default:
      return false;
  }
}

function isAcceptanceCriteriaSeverity(value: string): value is AcceptanceCriteriaSeverity {
  switch (value) {
    case ACCEPTANCE_CRITERIA_SEVERITIES.MUST:
    case ACCEPTANCE_CRITERIA_SEVERITIES.SHOULD:
    case ACCEPTANCE_CRITERIA_SEVERITIES.NICE_TO_HAVE:
      return true;
    default:
      return false;
  }
}

function isAcceptanceCriteriaStatus(value: string): value is AcceptanceCriteriaStatus {
  switch (value) {
    case ACCEPTANCE_CRITERIA_STATUSES.NOT_TESTED:
    case ACCEPTANCE_CRITERIA_STATUSES.PASSED:
    case ACCEPTANCE_CRITERIA_STATUSES.FAILED:
    case ACCEPTANCE_CRITERIA_STATUSES.BLOCKED:
      return true;
    default:
      return false;
  }
}

export function isPlanCycleStatus(value: string): value is PlanCycleStatus {
  switch (value) {
    case PLAN_CYCLE_STATUSES.DRAFTING:
    case PLAN_CYCLE_STATUSES.REVIEWING:
    case PLAN_CYCLE_STATUSES.APPROVED:
    case PLAN_CYCLE_STATUSES.REJECTED:
      return true;
    default:
      return false;
  }
}

function isPlanCycleSnapshotFunctionUnitDependency(
  value: unknown
): value is PlanCycleSnapshotFunctionUnitDependency {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.fu_id !== 'string') {
    return false;
  }

  if (typeof value.type !== 'string' || !isFunctionUnitDependencyType(value.type)) {
    return false;
  }

  return true;
}

function isPlanCycleSnapshotAcceptanceCriteria(
  value: unknown
): value is PlanCycleSnapshotAcceptanceCriteria {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string') {
    return false;
  }

  if (typeof value.fu_id !== 'string') {
    return false;
  }

  if (typeof value.description !== 'string') {
    return false;
  }

  if (typeof value.type !== 'string' || !isAcceptanceCriteriaType(value.type)) {
    return false;
  }

  if (typeof value.severity !== 'string' || !isAcceptanceCriteriaSeverity(value.severity)) {
    return false;
  }

  if (typeof value.status !== 'string' || !isAcceptanceCriteriaStatus(value.status)) {
    return false;
  }

  if (value.verified_in !== null && typeof value.verified_in !== 'string') {
    return false;
  }

  if (value.evidence !== null && typeof value.evidence !== 'string') {
    return false;
  }

  return true;
}

function isPlanCycleSnapshotFunctionUnit(value: unknown): value is PlanCycleSnapshotFunctionUnit {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string') {
    return false;
  }

  if (typeof value.feature_id !== 'string') {
    return false;
  }

  if (typeof value.title !== 'string') {
    return false;
  }

  if (typeof value.description !== 'string') {
    return false;
  }

  if (!Array.isArray(value.acceptance_criteria)) {
    return false;
  }

  for (const acceptanceCriteria of value.acceptance_criteria) {
    if (!isPlanCycleSnapshotAcceptanceCriteria(acceptanceCriteria)) {
      return false;
    }
  }

  if (!Array.isArray(value.depends_on)) {
    return false;
  }

  for (const dependency of value.depends_on) {
    if (!isPlanCycleSnapshotFunctionUnitDependency(dependency)) {
      return false;
    }
  }

  if (typeof value.status !== 'string' || !isFunctionUnitStatus(value.status)) {
    return false;
  }

  if (value.assigned_agent !== null && typeof value.assigned_agent !== 'string') {
    return false;
  }

  if (value.test_evidence !== null && typeof value.test_evidence !== 'string') {
    return false;
  }

  if (value.failure_reason !== null && typeof value.failure_reason !== 'string') {
    return false;
  }

  return true;
}

function isPlanCycleSnapshotFeature(value: unknown): value is PlanCycleSnapshotFeature {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string') {
    return false;
  }

  if (typeof value.title !== 'string') {
    return false;
  }

  if (typeof value.scope !== 'string') {
    return false;
  }

  if (typeof value.out_of_scope !== 'string') {
    return false;
  }

  if (typeof value.status !== 'string' || !isFeatureStatus(value.status)) {
    return false;
  }

  if (typeof value.priority !== 'string' || !isFeaturePriority(value.priority)) {
    return false;
  }

  if (!isStringArray(value.depends_on)) {
    return false;
  }

  return true;
}

export function isPlanCycleSnapshot(value: unknown): value is PlanCycleSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.captured_at !== 'string') {
    return false;
  }

  if (!isPlanCycleSnapshotFeature(value.feature)) {
    return false;
  }

  if (!Array.isArray(value.function_units)) {
    return false;
  }

  for (const functionUnit of value.function_units) {
    if (!isPlanCycleSnapshotFunctionUnit(functionUnit)) {
      return false;
    }
  }

  return true;
}

export function parsePlanCycleSnapshot(snapshotText: string): PlanCycleSnapshot {
  const parsedSnapshot: unknown = JSON.parse(snapshotText);

  if (!isPlanCycleSnapshot(parsedSnapshot)) {
    throw new TypeError('Invalid plan cycle snapshot returned from database.');
  }

  return parsedSnapshot;
}
