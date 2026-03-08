import {
  ACCEPTANCE_CRITERIA_SEVERITIES,
  ACCEPTANCE_CRITERIA_STATUSES,
  FUNCTION_UNIT_STATUSES,
  type AcceptanceCriteriaSeverity,
  type AcceptanceCriteriaStatus,
  type FunctionUnitStatus,
} from '../entities/types.js';
import {
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
  type IssueSeverity,
  type IssueStatus,
} from '../entities/issue.js';

interface BuildGateFailureCodeMap {
  readonly FUNCTION_UNIT_NOT_PASSED: 'function_unit_not_passed';
  readonly UNRESOLVED_CRITICAL_ISSUES: 'unresolved_critical_issues';
  readonly UNRESOLVED_MAJOR_ISSUES: 'unresolved_major_issues';
  readonly MUST_ACCEPTANCE_CRITERIA_NOT_PASSED: 'must_acceptance_criteria_not_passed';
  readonly ACTIVE_WORK_LOCKS_PRESENT: 'active_work_locks_present';
}

export const BUILD_GATE_FAILURE_CODES: BuildGateFailureCodeMap = {
  FUNCTION_UNIT_NOT_PASSED: 'function_unit_not_passed',
  UNRESOLVED_CRITICAL_ISSUES: 'unresolved_critical_issues',
  UNRESOLVED_MAJOR_ISSUES: 'unresolved_major_issues',
  MUST_ACCEPTANCE_CRITERIA_NOT_PASSED: 'must_acceptance_criteria_not_passed',
  ACTIVE_WORK_LOCKS_PRESENT: 'active_work_locks_present',
};

export type BuildGateFailureCode =
  | 'function_unit_not_passed'
  | 'unresolved_critical_issues'
  | 'unresolved_major_issues'
  | 'must_acceptance_criteria_not_passed'
  | 'active_work_locks_present';

export interface BuildGateIssueSummary {
  readonly id: string;
  readonly fu_id: string;
  readonly title: string;
  readonly severity: IssueSeverity;
  readonly status: IssueStatus;
}

export interface BuildGateAcceptanceCriteriaSummary {
  readonly id: string;
  readonly description: string;
  readonly severity: AcceptanceCriteriaSeverity;
  readonly status: AcceptanceCriteriaStatus;
}

export interface BuildGateFunctionUnitSummary {
  readonly id: string;
  readonly title: string;
  readonly status: FunctionUnitStatus;
  readonly acceptance_criteria: Array<BuildGateAcceptanceCriteriaSummary>;
}

export interface BuildGateActiveWorkLockSummary {
  readonly id: string;
  readonly fu_id: string;
  readonly agent_id: string;
}

export interface BuildGateFeatureSummary {
  readonly id: string;
  readonly function_units: Array<BuildGateFunctionUnitSummary>;
}

export interface BuildApprovalGateInput {
  readonly feature: BuildGateFeatureSummary;
  readonly issues: Array<BuildGateIssueSummary>;
  readonly active_work_locks: Array<BuildGateActiveWorkLockSummary>;
}

export interface BuildGateIssueReference {
  readonly id: string;
  readonly fu_id: string;
  readonly title: string;
  readonly severity: IssueSeverity;
  readonly status: IssueStatus;
}

export interface BuildGateFunctionUnitReference {
  readonly id: string;
  readonly title: string;
  readonly status: FunctionUnitStatus;
}

export interface BuildGateAcceptanceCriteriaReference {
  readonly id: string;
  readonly fu_id: string;
  readonly description: string;
  readonly severity: AcceptanceCriteriaSeverity;
  readonly status: AcceptanceCriteriaStatus;
}

export interface BuildGateWorkLockReference {
  readonly id: string;
  readonly fu_id: string;
  readonly agent_id: string;
}

export interface BuildGateFailure {
  readonly code: BuildGateFailureCode;
  readonly message: string;
  readonly feature_id: string;
  readonly issue_count?: number;
  readonly issues?: Array<BuildGateIssueReference>;
  readonly function_unit?: BuildGateFunctionUnitReference;
  readonly acceptance_criteria?: Array<BuildGateAcceptanceCriteriaReference>;
  readonly work_lock_count?: number;
  readonly work_locks?: Array<BuildGateWorkLockReference>;
}

export interface BuildGateEvaluation {
  readonly passed: boolean;
  readonly failures: Array<BuildGateFailure>;
}

function isResolvedIssueStatus(status: IssueStatus): boolean {
  if (status === ISSUE_STATUSES.RESOLVED) {
    return true;
  }

  return false;
}

function toIssueReferences(
  issues: Array<BuildGateIssueSummary>
): Array<BuildGateIssueReference> {
  const issueReferences: Array<BuildGateIssueReference> = [];

  for (const issue of issues) {
    issueReferences.push({
      id: issue.id,
      fu_id: issue.fu_id,
      title: issue.title,
      severity: issue.severity,
      status: issue.status,
    });
  }

  return issueReferences;
}

function toWorkLockReferences(
  workLocks: Array<BuildGateActiveWorkLockSummary>
): Array<BuildGateWorkLockReference> {
  const workLockReferences: Array<BuildGateWorkLockReference> = [];

  for (const workLock of workLocks) {
    workLockReferences.push({
      id: workLock.id,
      fu_id: workLock.fu_id,
      agent_id: workLock.agent_id,
    });
  }

  return workLockReferences;
}

function getUnresolvedIssuesBySeverity(
  issues: Array<BuildGateIssueSummary>,
  severity: IssueSeverity
): Array<BuildGateIssueSummary> {
  const unresolvedIssues: Array<BuildGateIssueSummary> = [];

  for (const issue of issues) {
    if (issue.severity !== severity) {
      continue;
    }

    if (!isResolvedIssueStatus(issue.status)) {
      unresolvedIssues.push(issue);
    }
  }

  return unresolvedIssues;
}

function getFailingMustAcceptanceCriteria(
  functionUnit: BuildGateFunctionUnitSummary
): Array<BuildGateAcceptanceCriteriaReference> {
  const failingAcceptanceCriteria: Array<BuildGateAcceptanceCriteriaReference> = [];

  for (const acceptanceCriteria of functionUnit.acceptance_criteria) {
    if (acceptanceCriteria.severity !== ACCEPTANCE_CRITERIA_SEVERITIES.MUST) {
      continue;
    }

    if (acceptanceCriteria.status === ACCEPTANCE_CRITERIA_STATUSES.PASSED) {
      continue;
    }

    failingAcceptanceCriteria.push({
      id: acceptanceCriteria.id,
      fu_id: functionUnit.id,
      description: acceptanceCriteria.description,
      severity: acceptanceCriteria.severity,
      status: acceptanceCriteria.status,
    });
  }

  return failingAcceptanceCriteria;
}

export function evaluateBuildApprovalGate(
  input: BuildApprovalGateInput
): BuildGateEvaluation {
  const failures: Array<BuildGateFailure> = [];
  const unresolvedCriticalIssues = getUnresolvedIssuesBySeverity(
    input.issues,
    ISSUE_SEVERITIES.CRITICAL
  );
  const unresolvedMajorIssues = getUnresolvedIssuesBySeverity(input.issues, ISSUE_SEVERITIES.MAJOR);

  if (unresolvedCriticalIssues.length > 0) {
    failures.push({
      code: BUILD_GATE_FAILURE_CODES.UNRESOLVED_CRITICAL_ISSUES,
      message: 'Build approval requires all critical issues to be resolved.',
      feature_id: input.feature.id,
      issue_count: unresolvedCriticalIssues.length,
      issues: toIssueReferences(unresolvedCriticalIssues),
    });
  }

  if (unresolvedMajorIssues.length > 0) {
    failures.push({
      code: BUILD_GATE_FAILURE_CODES.UNRESOLVED_MAJOR_ISSUES,
      message: 'Build approval requires all major issues to be resolved.',
      feature_id: input.feature.id,
      issue_count: unresolvedMajorIssues.length,
      issues: toIssueReferences(unresolvedMajorIssues),
    });
  }

  for (const functionUnit of input.feature.function_units) {
    if (functionUnit.status !== FUNCTION_UNIT_STATUSES.PASSED) {
      failures.push({
        code: BUILD_GATE_FAILURE_CODES.FUNCTION_UNIT_NOT_PASSED,
        message: 'Build approval requires every function unit to be passed.',
        feature_id: input.feature.id,
        function_unit: {
          id: functionUnit.id,
          title: functionUnit.title,
          status: functionUnit.status,
        },
      });
    }

    const failingAcceptanceCriteria = getFailingMustAcceptanceCriteria(functionUnit);

    if (failingAcceptanceCriteria.length > 0) {
      failures.push({
        code: BUILD_GATE_FAILURE_CODES.MUST_ACCEPTANCE_CRITERIA_NOT_PASSED,
        message: 'Build approval requires every must acceptance criterion to be passed.',
        feature_id: input.feature.id,
        function_unit: {
          id: functionUnit.id,
          title: functionUnit.title,
          status: functionUnit.status,
        },
        acceptance_criteria: failingAcceptanceCriteria,
      });
    }
  }

  if (input.active_work_locks.length > 0) {
    failures.push({
      code: BUILD_GATE_FAILURE_CODES.ACTIVE_WORK_LOCKS_PRESENT,
      message: 'Build approval requires all active work locks to be released.',
      feature_id: input.feature.id,
      work_lock_count: input.active_work_locks.length,
      work_locks: toWorkLockReferences(input.active_work_locks),
    });
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}
