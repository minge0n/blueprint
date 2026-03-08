import {
  ACCEPTANCE_CRITERIA_SEVERITIES,
  type AcceptanceCriteriaSeverity,
} from '../entities/types.js';
import {
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
  type IssueSeverity,
  type IssueStatus,
} from '../entities/issue.js';

interface PlanGateFailureCodeMap {
  readonly OPEN_CRITICAL_ISSUES: 'open_critical_issues';
  readonly UNRESOLVED_MAJOR_ISSUES: 'unresolved_major_issues';
  readonly FUNCTION_UNIT_MISSING_MUST_AC: 'function_unit_missing_must_ac';
  readonly EMPTY_OUT_OF_SCOPE: 'empty_out_of_scope';
}

export const PLAN_GATE_FAILURE_CODES: PlanGateFailureCodeMap = {
  OPEN_CRITICAL_ISSUES: 'open_critical_issues',
  UNRESOLVED_MAJOR_ISSUES: 'unresolved_major_issues',
  FUNCTION_UNIT_MISSING_MUST_AC: 'function_unit_missing_must_ac',
  EMPTY_OUT_OF_SCOPE: 'empty_out_of_scope',
};

export type PlanGateFailureCode =
  | 'open_critical_issues'
  | 'unresolved_major_issues'
  | 'function_unit_missing_must_ac'
  | 'empty_out_of_scope';

export interface PlanGateIssueSummary {
  readonly id: string;
  readonly title: string;
  readonly severity: IssueSeverity;
  readonly status: IssueStatus;
}

export interface PlanGateAcceptanceCriteriaSummary {
  readonly id: string;
  readonly severity: AcceptanceCriteriaSeverity;
}

export interface PlanGateFunctionUnitSummary {
  readonly id: string;
  readonly title: string;
  readonly acceptance_criteria: Array<PlanGateAcceptanceCriteriaSummary>;
}

export interface PlanGateFeatureSummary {
  readonly id: string;
  readonly out_of_scope: string;
  readonly function_units: Array<PlanGateFunctionUnitSummary>;
}

export interface PlanApprovalGateInput {
  readonly feature: PlanGateFeatureSummary;
  readonly issues: Array<PlanGateIssueSummary>;
}

export interface PlanGateIssueReference {
  readonly id: string;
  readonly title: string;
  readonly severity: IssueSeverity;
  readonly status: IssueStatus;
}

export interface PlanGateFunctionUnitReference {
  readonly id: string;
  readonly title: string;
}

export interface PlanGateFailure {
  readonly code: PlanGateFailureCode;
  readonly message: string;
  readonly feature_id: string;
  readonly issue_count?: number;
  readonly issues?: Array<PlanGateIssueReference>;
  readonly function_unit?: PlanGateFunctionUnitReference;
}

export interface PlanGateEvaluation {
  readonly passed: boolean;
  readonly failures: Array<PlanGateFailure>;
}

function hasClosedIssueStatus(status: IssueStatus): boolean {
  if (status === ISSUE_STATUSES.RESOLVED || status === ISSUE_STATUSES.WONT_FIX) {
    return true;
  }

  return false;
}

function hasNonWhitespaceText(value: string): boolean {
  if (value.trim().length > 0) {
    return true;
  }

  return false;
}

function toIssueReferences(
  issues: Array<PlanGateIssueSummary>
): Array<PlanGateIssueReference> {
  return issues.map((issue) => ({
    id: issue.id,
    title: issue.title,
    severity: issue.severity,
    status: issue.status,
  }));
}

function getFunctionUnitsMissingMustAcceptanceCriteria(
  functionUnits: Array<PlanGateFunctionUnitSummary>
): Array<PlanGateFunctionUnitSummary> {
  return functionUnits.filter((functionUnit) => {
    const mustAcceptanceCriteria = functionUnit.acceptance_criteria.filter(
      (acceptanceCriteria) => acceptanceCriteria.severity === ACCEPTANCE_CRITERIA_SEVERITIES.MUST
    );

    if (mustAcceptanceCriteria.length === 0) {
      return true;
    }

    return false;
  });
}

export function evaluatePlanApprovalGate(
  input: PlanApprovalGateInput
): PlanGateEvaluation {
  const failures: Array<PlanGateFailure> = [];
  const openCriticalIssues = input.issues.filter(
    (issue) =>
      issue.severity === ISSUE_SEVERITIES.CRITICAL && issue.status === ISSUE_STATUSES.OPEN
  );
  const unresolvedMajorIssues = input.issues.filter(
    (issue) =>
      issue.severity === ISSUE_SEVERITIES.MAJOR && !hasClosedIssueStatus(issue.status)
  );
  const functionUnitsMissingMustAcceptanceCriteria =
    getFunctionUnitsMissingMustAcceptanceCriteria(input.feature.function_units);

  if (!hasNonWhitespaceText(input.feature.out_of_scope)) {
    failures.push({
      code: PLAN_GATE_FAILURE_CODES.EMPTY_OUT_OF_SCOPE,
      message: 'Feature out_of_scope must not be empty.',
      feature_id: input.feature.id,
    });
  }

  if (openCriticalIssues.length > 0) {
    failures.push({
      code: PLAN_GATE_FAILURE_CODES.OPEN_CRITICAL_ISSUES,
      message: 'Plan approval requires all critical issues to be closed.',
      feature_id: input.feature.id,
      issue_count: openCriticalIssues.length,
      issues: toIssueReferences(openCriticalIssues),
    });
  }

  if (unresolvedMajorIssues.length > 0) {
    failures.push({
      code: PLAN_GATE_FAILURE_CODES.UNRESOLVED_MAJOR_ISSUES,
      message: 'Plan approval requires all major issues to be resolved or marked wont_fix.',
      feature_id: input.feature.id,
      issue_count: unresolvedMajorIssues.length,
      issues: toIssueReferences(unresolvedMajorIssues),
    });
  }

  for (const functionUnit of functionUnitsMissingMustAcceptanceCriteria) {
    failures.push({
      code: PLAN_GATE_FAILURE_CODES.FUNCTION_UNIT_MISSING_MUST_AC,
      message: 'Each function unit must include at least one must acceptance criterion.',
      feature_id: input.feature.id,
      function_unit: {
        id: functionUnit.id,
        title: functionUnit.title,
      },
    });
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}
