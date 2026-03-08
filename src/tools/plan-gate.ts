import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { getDb } from '../db/index.js';
import { getFullFeatureById } from '../db/queries/feature.js';
import {
  FEATURE_LIFECYCLE_EVENTS,
  transitionFeatureStatusFromLifecycleEvent,
} from '../entities/feature-lifecycle.js';
import { STATUS_AUDIT_LOG_ENTITY_TYPES } from '../entities/status-audit-log.js';
import { FEATURE_STATUSES, type FeatureStatus } from '../entities/types.js';
import {
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
  type IssueSeverity,
  type IssueStatus,
} from '../entities/issue.js';
import {
  PLAN_CYCLE_STATUSES,
  isPlanCycleStatus,
  type PlanCycleStatus,
} from '../entities/plan-cycle.js';
import { logStatusChange } from '../db/queries/status-audit-log.js';
import {
  evaluatePlanApprovalGate,
  type PlanApprovalGateInput,
  type PlanGateIssueSummary,
  type PlanGateFailure,
} from '../gates/plan.js';
import {
  createTextToolResult,
  createToolErrorResult,
  defineTool,
  type BlueprintToolDefinition,
} from './types.js';

interface PlanCycleRow {
  readonly id: string;
  readonly feature_id: string;
  readonly status: string;
}

interface FeatureStatusRow {
  readonly id: string;
  readonly status: string;
}

interface IssueRow {
  readonly id: string;
  readonly title: string;
  readonly severity: string;
  readonly status: string;
}

interface ApprovePlanInput {
  readonly plan_cycle_id: string;
}

interface RejectPlanInput {
  readonly plan_cycle_id: string;
}

interface PlanGateErrorPayload {
  readonly message: string;
  readonly plan_cycle_id: string;
  readonly feature_id?: string;
  readonly failures?: Array<PlanGateFailure>;
}

interface PlanGateSuccessPayload {
  readonly plan_cycle_id: string;
  readonly plan_cycle_status: PlanCycleStatus;
  readonly feature_id: string;
  readonly feature_status: FeatureStatus;
  readonly gate: {
    readonly passed: boolean;
    readonly failures: Array<PlanGateFailure>;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return true;
}

function isPlanCycleRow(value: unknown): value is PlanCycleRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string') {
    return false;
  }

  if (typeof value.feature_id !== 'string') {
    return false;
  }

  if (typeof value.status !== 'string') {
    return false;
  }

  return true;
}

function isFeatureStatusRow(value: unknown): value is FeatureStatusRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string') {
    return false;
  }

  if (typeof value.status !== 'string') {
    return false;
  }

  return true;
}

function isIssueSeverity(value: string): value is IssueSeverity {
  switch (value) {
    case ISSUE_SEVERITIES.CRITICAL:
    case ISSUE_SEVERITIES.MAJOR:
    case ISSUE_SEVERITIES.MINOR:
    case ISSUE_SEVERITIES.NITPICK:
      return true;
    default:
      return false;
  }
}

function isIssueStatus(value: string): value is IssueStatus {
  switch (value) {
    case ISSUE_STATUSES.OPEN:
    case ISSUE_STATUSES.IN_PROGRESS:
    case ISSUE_STATUSES.RESOLVED:
    case ISSUE_STATUSES.WONT_FIX:
      return true;
    default:
      return false;
  }
}

function isIssueRow(value: unknown): value is IssueRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string') {
    return false;
  }

  if (typeof value.title !== 'string') {
    return false;
  }

  if (typeof value.severity !== 'string') {
    return false;
  }

  if (typeof value.status !== 'string') {
    return false;
  }

  return true;
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

function formatToolResult(data: unknown): CallToolResult {
  return createTextToolResult(JSON.stringify(data, null, 2));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

function createStructuredToolErrorResult(payload: PlanGateErrorPayload): CallToolResult {
  return createToolErrorResult(JSON.stringify(payload, null, 2));
}

function getPlanCycleRowById(planCycleId: string): PlanCycleRow {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT id, feature_id, status
        FROM plan_cycles
        WHERE id = ?
      `
    )
    .get(planCycleId);

  if (!isPlanCycleRow(row)) {
    throw new Error(`Plan cycle not found: ${planCycleId}`);
  }

  return row;
}

function getFeatureStatusRowById(featureId: string): FeatureStatusRow {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT id, status
        FROM features
        WHERE id = ?
      `
    )
    .get(featureId);

  if (!isFeatureStatusRow(row)) {
    throw new Error(`Feature not found: ${featureId}`);
  }

  return row;
}

function getPlanIssues(planCycleId: string): Array<PlanGateIssueSummary> {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT id, title, severity, status
        FROM issues
        WHERE parent_type = 'plan'
          AND parent_id = ?
        ORDER BY id ASC
      `
    )
    .all(planCycleId);
  const issues: Array<PlanGateIssueSummary> = [];

  for (const row of rows) {
    if (!isIssueRow(row)) {
      throw new TypeError('Invalid plan issue row returned from database.');
    }

    if (!isIssueSeverity(row.severity)) {
      throw new TypeError(`Invalid issue severity returned from database: ${row.severity}`);
    }

    if (!isIssueStatus(row.status)) {
      throw new TypeError(`Invalid issue status returned from database: ${row.status}`);
    }

    issues.push({
      id: row.id,
      title: row.title,
      severity: row.severity,
      status: row.status,
    });
  }

  return issues;
}

function assertReviewingPlanCycle(status: PlanCycleStatus, planCycleId: string): void {
  if (status === PLAN_CYCLE_STATUSES.REVIEWING) {
    return;
  }

  throw new Error(
    `Plan cycle must be in 'reviewing' status. Current: ${status}. plan_cycle_id=${planCycleId}`
  );
}

function assertPlanReviewFeatureStatus(status: FeatureStatus, featureId: string): void {
  if (status === FEATURE_STATUSES.PLAN_REVIEW) {
    return;
  }

  throw new Error(
    `Feature must be in 'plan_review' status. Current: ${status}. feature_id=${featureId}`
  );
}

function buildPlanApprovalGateInput(
  featureId: string,
  planCycleId: string
): PlanApprovalGateInput {
  const feature = getFullFeatureById(featureId);

  if (feature === null) {
    throw new Error(`Feature not found: ${featureId}`);
  }

  const functionUnits = feature.function_units.map((functionUnit) => ({
    id: functionUnit.id,
    title: functionUnit.title,
    acceptance_criteria: functionUnit.acceptance_criteria.map((acceptanceCriteria) => ({
      id: acceptanceCriteria.id,
      severity: acceptanceCriteria.severity,
    })),
  }));
  const issues = getPlanIssues(planCycleId);

  return {
    feature: {
      id: feature.id,
      out_of_scope: feature.out_of_scope,
      function_units: functionUnits,
    },
    issues,
  };
}

function approvePlan(input: ApprovePlanInput): PlanGateSuccessPayload {
  const db = getDb();
  const runApproval = db.transaction(
    (currentInput: ApprovePlanInput): PlanGateSuccessPayload => {
      const planCycleRow = getPlanCycleRowById(currentInput.plan_cycle_id);

      if (!isPlanCycleStatus(planCycleRow.status)) {
        throw new TypeError(
          `Invalid plan cycle status returned from database: ${planCycleRow.status}`
        );
      }

      assertReviewingPlanCycle(planCycleRow.status, currentInput.plan_cycle_id);

      const featureStatusRow = getFeatureStatusRowById(planCycleRow.feature_id);

      if (!isFeatureStatus(featureStatusRow.status)) {
        throw new TypeError(
          `Invalid feature status returned from database: ${featureStatusRow.status}`
        );
      }

      assertPlanReviewFeatureStatus(featureStatusRow.status, planCycleRow.feature_id);

      const gateInput = buildPlanApprovalGateInput(
        planCycleRow.feature_id,
        currentInput.plan_cycle_id
      );
      const gateEvaluation = evaluatePlanApprovalGate(gateInput);

      if (!gateEvaluation.passed) {
        throw new Error(
          JSON.stringify(
            {
              message: 'Plan approval gate failed.',
              plan_cycle_id: currentInput.plan_cycle_id,
              feature_id: planCycleRow.feature_id,
              failures: gateEvaluation.failures,
            },
            null,
            2
          )
        );
      }

      db.prepare(
        `
          UPDATE plan_cycles
          SET status = ?
          WHERE id = ?
        `
      ).run(PLAN_CYCLE_STATUSES.APPROVED, currentInput.plan_cycle_id);

      logStatusChange({
        entity_type: STATUS_AUDIT_LOG_ENTITY_TYPES.PLAN_CYCLE,
        entity_id: currentInput.plan_cycle_id,
        old_status: PLAN_CYCLE_STATUSES.REVIEWING,
        new_status: PLAN_CYCLE_STATUSES.APPROVED,
        context: 'blueprint_approve_plan',
      });

      const nextFeatureStatus = transitionFeatureStatusFromLifecycleEvent(
        featureStatusRow.status,
        FEATURE_LIFECYCLE_EVENTS.PLAN_APPROVED
      );

      db.prepare(
        `
          UPDATE features
          SET status = ?
          WHERE id = ?
        `
      ).run(nextFeatureStatus, planCycleRow.feature_id);

      logStatusChange({
        entity_type: STATUS_AUDIT_LOG_ENTITY_TYPES.FEATURE,
        entity_id: planCycleRow.feature_id,
        old_status: featureStatusRow.status,
        new_status: nextFeatureStatus,
        context: 'blueprint_approve_plan',
      });

      return {
        plan_cycle_id: currentInput.plan_cycle_id,
        plan_cycle_status: PLAN_CYCLE_STATUSES.APPROVED,
        feature_id: planCycleRow.feature_id,
        feature_status: nextFeatureStatus,
        gate: {
          passed: true,
          failures: [],
        },
      };
    }
  );

  return runApproval(input);
}

function rejectPlan(input: RejectPlanInput): PlanGateSuccessPayload {
  const db = getDb();
  const runRejection = db.transaction(
    (currentInput: RejectPlanInput): PlanGateSuccessPayload => {
      const planCycleRow = getPlanCycleRowById(currentInput.plan_cycle_id);

      if (!isPlanCycleStatus(planCycleRow.status)) {
        throw new TypeError(
          `Invalid plan cycle status returned from database: ${planCycleRow.status}`
        );
      }

      assertReviewingPlanCycle(planCycleRow.status, currentInput.plan_cycle_id);

      const featureStatusRow = getFeatureStatusRowById(planCycleRow.feature_id);

      if (!isFeatureStatus(featureStatusRow.status)) {
        throw new TypeError(
          `Invalid feature status returned from database: ${featureStatusRow.status}`
        );
      }

      assertPlanReviewFeatureStatus(featureStatusRow.status, planCycleRow.feature_id);

      const gateEvaluation = evaluatePlanApprovalGate(
        buildPlanApprovalGateInput(planCycleRow.feature_id, currentInput.plan_cycle_id)
      );
      const nextFeatureStatus = transitionFeatureStatusFromLifecycleEvent(
        featureStatusRow.status,
        FEATURE_LIFECYCLE_EVENTS.PLAN_REJECTED
      );

      db.prepare(
        `
          UPDATE plan_cycles
          SET status = ?
          WHERE id = ?
        `
      ).run(PLAN_CYCLE_STATUSES.REJECTED, currentInput.plan_cycle_id);

      logStatusChange({
        entity_type: STATUS_AUDIT_LOG_ENTITY_TYPES.PLAN_CYCLE,
        entity_id: currentInput.plan_cycle_id,
        old_status: PLAN_CYCLE_STATUSES.REVIEWING,
        new_status: PLAN_CYCLE_STATUSES.REJECTED,
        context: 'blueprint_reject_plan',
      });

      return {
        plan_cycle_id: currentInput.plan_cycle_id,
        plan_cycle_status: PLAN_CYCLE_STATUSES.REJECTED,
        feature_id: planCycleRow.feature_id,
        feature_status: nextFeatureStatus,
        gate: {
          passed: false,
          failures: gateEvaluation.failures,
        },
      };
    }
  );

  return runRejection(input);
}

const approvePlanTool = defineTool({
  name: 'blueprint_approve_plan',
  description: 'Approve a plan review cycle after enforcing plan gate rules.',
  inputSchema: {
    plan_cycle_id: z.string().min(1),
  },
  handler: async ({ plan_cycle_id }): Promise<CallToolResult> => {
    try {
      const result = approvePlan({ plan_cycle_id });

      return formatToolResult(result);
    } catch (error: unknown) {
      const message = getErrorMessage(error);

      if (message.startsWith('{')) {
        return createToolErrorResult(message);
      }

      return createStructuredToolErrorResult({
        message,
        plan_cycle_id,
      });
    }
  },
});

const rejectPlanTool = defineTool({
  name: 'blueprint_reject_plan',
  description: 'Reject a plan review cycle and keep the feature in plan review.',
  inputSchema: {
    plan_cycle_id: z.string().min(1),
  },
  handler: async ({ plan_cycle_id }): Promise<CallToolResult> => {
    try {
      const result = rejectPlan({ plan_cycle_id });

      return formatToolResult(result);
    } catch (error: unknown) {
      return createStructuredToolErrorResult({
        message: getErrorMessage(error),
        plan_cycle_id,
      });
    }
  },
});

export const planGateToolDefinitions: Array<BlueprintToolDefinition> = [
  approvePlanTool,
  rejectPlanTool,
];

export { approvePlan, rejectPlan };
