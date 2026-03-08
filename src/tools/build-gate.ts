import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { getDb } from '../db/index.js';
import { resetMergePointsForMergedFunctionUnits } from '../db/queries/merge-point.js';
import { getFullFeatureById } from '../db/queries/feature.js';
import { logStatusChange } from '../db/queries/status-audit-log.js';
import { BUILD_CYCLE_STATUSES, type BuildCycleStatus } from '../entities/build-cycle.js';
import {
  FEATURE_LIFECYCLE_EVENTS,
  transitionFeatureStatusFromLifecycleEvent,
} from '../entities/feature-lifecycle.js';
import {
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
  type IssueSeverity,
  type IssueStatus,
} from '../entities/issue.js';
import { STATUS_AUDIT_LOG_ENTITY_TYPES } from '../entities/status-audit-log.js';
import {
  FEATURE_STATUSES,
  FUNCTION_UNIT_STATUSES,
  ACCEPTANCE_CRITERIA_SEVERITIES,
  ACCEPTANCE_CRITERIA_STATUSES,
  type AcceptanceCriteriaSeverity,
  type AcceptanceCriteriaStatus,
  type FeatureStatus,
  type FunctionUnitStatus,
} from '../entities/types.js';
import { WORK_LOCK_STATUSES } from '../entities/work-lock.js';
import {
  evaluateBuildApprovalGate,
  type BuildApprovalGateInput,
  type BuildGateActiveWorkLockSummary,
  type BuildGateFailure,
  type BuildGateIssueSummary,
} from '../gates/build.js';
import {
  createTextToolResult,
  createToolErrorResult,
  defineTool,
  type BlueprintToolDefinition,
} from './types.js';

interface BuildCycleRow {
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
  readonly fu_id: string;
  readonly title: string;
  readonly severity: string;
  readonly status: string;
}

interface ActiveWorkLockRow {
  readonly id: string;
  readonly fu_id: string;
  readonly agent_id: string;
}

interface ApproveBuildInput {
  readonly build_cycle_id: string;
}

interface RejectBuildInput {
  readonly build_cycle_id: string;
}

interface BuildGateErrorPayload {
  readonly message: string;
  readonly build_cycle_id: string;
  readonly feature_id?: string;
  readonly failures?: Array<BuildGateFailure>;
}

interface ResetReasonIssue {
  readonly id: string;
  readonly title: string;
  readonly severity: IssueSeverity;
  readonly status: IssueStatus;
}

interface ResetReason {
  readonly code: 'blocking_issue' | 'failed_in_review';
  readonly message: string;
  readonly issues?: Array<ResetReasonIssue>;
}

interface ResetFunctionUnitSummary {
  readonly fu_id: string;
  readonly title: string;
  readonly old_status: FunctionUnitStatus;
  readonly new_status: FunctionUnitStatus;
  readonly reasons: Array<ResetReason>;
}

interface BuildGateSuccessPayload {
  readonly build_cycle_id: string;
  readonly build_cycle_status: BuildCycleStatus;
  readonly feature_id: string;
  readonly feature_status: FeatureStatus;
  readonly gate: {
    readonly passed: boolean;
    readonly failures: Array<BuildGateFailure>;
  };
  readonly reset_function_units?: Array<ResetFunctionUnitSummary>;
}

interface BuildGateFunctionUnitRecord {
  readonly id: string;
  readonly title: string;
  readonly status: FunctionUnitStatus;
}

interface FunctionUnitResetAccumulator {
  readonly fu_id: string;
  readonly title: string;
  readonly old_status: FunctionUnitStatus;
  readonly issues: Array<ResetReasonIssue>;
  failed_in_review: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return true;
}

function isBuildCycleRow(value: unknown): value is BuildCycleRow {
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

function isIssueRow(value: unknown): value is IssueRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string') {
    return false;
  }

  if (typeof value.fu_id !== 'string') {
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

function isActiveWorkLockRow(value: unknown): value is ActiveWorkLockRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string') {
    return false;
  }

  if (typeof value.fu_id !== 'string') {
    return false;
  }

  if (typeof value.agent_id !== 'string') {
    return false;
  }

  return true;
}

function isBuildCycleStatus(value: string): value is BuildCycleStatus {
  switch (value) {
    case BUILD_CYCLE_STATUSES.BUILDING:
    case BUILD_CYCLE_STATUSES.REVIEWING:
    case BUILD_CYCLE_STATUSES.APPROVED:
    case BUILD_CYCLE_STATUSES.REJECTED:
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

function formatToolResult(data: unknown): CallToolResult {
  return createTextToolResult(JSON.stringify(data, null, 2));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

function createStructuredToolErrorResult(payload: BuildGateErrorPayload): CallToolResult {
  return createToolErrorResult(JSON.stringify(payload, null, 2));
}

function getBuildCycleRowById(buildCycleId: string): BuildCycleRow {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT id, feature_id, status
        FROM build_cycles
        WHERE id = ?
      `
    )
    .get(buildCycleId);

  if (!isBuildCycleRow(row)) {
    throw new Error(`Build cycle not found: ${buildCycleId}`);
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

function getBuildIssues(buildCycleId: string): Array<BuildGateIssueSummary> {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT id, fu_id, title, severity, status
        FROM issues
        WHERE parent_type = 'build'
          AND parent_id = ?
        ORDER BY id ASC
      `
    )
    .all(buildCycleId);
  const issues: Array<BuildGateIssueSummary> = [];

  for (const row of rows) {
    if (!isIssueRow(row)) {
      throw new TypeError('Invalid build issue row returned from database.');
    }

    if (!isIssueSeverity(row.severity)) {
      throw new TypeError(`Invalid issue severity returned from database: ${row.severity}`);
    }

    if (!isIssueStatus(row.status)) {
      throw new TypeError(`Invalid issue status returned from database: ${row.status}`);
    }

    issues.push({
      id: row.id,
      fu_id: row.fu_id,
      title: row.title,
      severity: row.severity,
      status: row.status,
    });
  }

  return issues;
}

function getActiveWorkLocks(featureId: string): Array<BuildGateActiveWorkLockSummary> {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT work_locks.id, work_locks.fu_id, work_locks.agent_id
        FROM work_locks
        INNER JOIN function_units ON function_units.id = work_locks.fu_id
        WHERE function_units.feature_id = ?
          AND work_locks.status = ?
        ORDER BY work_locks.id ASC
      `
    )
    .all(featureId, WORK_LOCK_STATUSES.ACTIVE);
  const activeWorkLocks: Array<BuildGateActiveWorkLockSummary> = [];

  for (const row of rows) {
    if (!isActiveWorkLockRow(row)) {
      throw new TypeError('Invalid active work lock row returned from database.');
    }

    activeWorkLocks.push({
      id: row.id,
      fu_id: row.fu_id,
      agent_id: row.agent_id,
    });
  }

  return activeWorkLocks;
}

function assertReviewingBuildCycle(status: BuildCycleStatus, buildCycleId: string): void {
  if (status === BUILD_CYCLE_STATUSES.REVIEWING) {
    return;
  }

  throw new Error(
    `Build cycle must be in 'reviewing' status. Current: ${status}. build_cycle_id=${buildCycleId}`
  );
}

function assertBuildReviewFeatureStatus(status: FeatureStatus, featureId: string): void {
  if (status === FEATURE_STATUSES.BUILD_REVIEW) {
    return;
  }

  throw new Error(
    `Feature must be in 'build_review' status. Current: ${status}. feature_id=${featureId}`
  );
}

function buildBuildApprovalGateInput(
  featureId: string,
  buildCycleId: string
): BuildApprovalGateInput {
  const feature = getFullFeatureById(featureId);

  if (feature === null) {
    throw new Error(`Feature not found: ${featureId}`);
  }

  const functionUnits = feature.function_units.map((functionUnit) => {
    if (!isFunctionUnitStatus(functionUnit.status)) {
      throw new TypeError(`Invalid function unit status returned from database: ${functionUnit.status}`);
    }

    return {
      id: functionUnit.id,
      title: functionUnit.title,
      status: functionUnit.status,
      acceptance_criteria: functionUnit.acceptance_criteria.map((acceptanceCriteria) => {
        if (!isAcceptanceCriteriaSeverity(acceptanceCriteria.severity)) {
          throw new TypeError(
            `Invalid acceptance criteria severity returned from database: ${acceptanceCriteria.severity}`
          );
        }

        if (!isAcceptanceCriteriaStatus(acceptanceCriteria.status)) {
          throw new TypeError(
            `Invalid acceptance criteria status returned from database: ${acceptanceCriteria.status}`
          );
        }

        return {
          id: acceptanceCriteria.id,
          description: acceptanceCriteria.description,
          severity: acceptanceCriteria.severity,
          status: acceptanceCriteria.status,
        };
      }),
    };
  });

  return {
    feature: {
      id: feature.id,
      function_units: functionUnits,
    },
    issues: getBuildIssues(buildCycleId),
    active_work_locks: getActiveWorkLocks(featureId),
  };
}

function getFunctionUnitRecords(featureId: string): Map<string, BuildGateFunctionUnitRecord> {
  const feature = getFullFeatureById(featureId);

  if (feature === null) {
    throw new Error(`Feature not found: ${featureId}`);
  }

  const functionUnitRecords = new Map<string, BuildGateFunctionUnitRecord>();

  for (const functionUnit of feature.function_units) {
    if (!isFunctionUnitStatus(functionUnit.status)) {
      throw new TypeError(`Invalid function unit status returned from database: ${functionUnit.status}`);
    }

    functionUnitRecords.set(functionUnit.id, {
      id: functionUnit.id,
      title: functionUnit.title,
      status: functionUnit.status,
    });
  }

  return functionUnitRecords;
}

function isBlockingIssue(issue: BuildGateIssueSummary): boolean {
  if (
    issue.severity !== ISSUE_SEVERITIES.CRITICAL &&
    issue.severity !== ISSUE_SEVERITIES.MAJOR
  ) {
    return false;
  }

  if (issue.status === ISSUE_STATUSES.RESOLVED) {
    return false;
  }

  return true;
}

function buildResetAccumulators(
  featureId: string,
  issues: Array<BuildGateIssueSummary>
): Map<string, FunctionUnitResetAccumulator> {
  const functionUnitRecords = getFunctionUnitRecords(featureId);
  const resetAccumulators = new Map<string, FunctionUnitResetAccumulator>();

  for (const functionUnit of functionUnitRecords.values()) {
    if (functionUnit.status === FUNCTION_UNIT_STATUSES.FAILED) {
      resetAccumulators.set(functionUnit.id, {
        fu_id: functionUnit.id,
        title: functionUnit.title,
        old_status: functionUnit.status,
        issues: [],
        failed_in_review: true,
      });
    }
  }

  for (const issue of issues) {
    if (!isBlockingIssue(issue)) {
      continue;
    }

    const functionUnit = functionUnitRecords.get(issue.fu_id);

    if (functionUnit === undefined) {
      throw new Error(
        `Build issue ${issue.id} references unknown function unit ${issue.fu_id} for feature ${featureId}`
      );
    }

    const existingAccumulator = resetAccumulators.get(issue.fu_id);

    if (existingAccumulator === undefined) {
      resetAccumulators.set(issue.fu_id, {
        fu_id: functionUnit.id,
        title: functionUnit.title,
        old_status: functionUnit.status,
        issues: [
          {
            id: issue.id,
            title: issue.title,
            severity: issue.severity,
            status: issue.status,
          },
        ],
        failed_in_review: false,
      });
      continue;
    }

    existingAccumulator.issues.push({
      id: issue.id,
      title: issue.title,
      severity: issue.severity,
      status: issue.status,
    });
  }

  return resetAccumulators;
}

function updateFunctionUnitStatusToPending(
  buildCycleId: string,
  accumulator: FunctionUnitResetAccumulator
): ResetFunctionUnitSummary {
  const db = getDb();

  db.prepare(
    `
      UPDATE function_units
      SET status = ?
      WHERE id = ?
    `
  ).run(FUNCTION_UNIT_STATUSES.PENDING, accumulator.fu_id);

  if (accumulator.old_status !== FUNCTION_UNIT_STATUSES.PENDING) {
    logStatusChange({
      entity_type: STATUS_AUDIT_LOG_ENTITY_TYPES.FUNCTION_UNIT,
      entity_id: accumulator.fu_id,
      old_status: accumulator.old_status,
      new_status: FUNCTION_UNIT_STATUSES.PENDING,
      context: JSON.stringify({
        event: 'blueprint_reject_build',
        build_cycle_id: buildCycleId,
        reset_reasons: {
          failed_in_review: accumulator.failed_in_review,
          issue_ids: accumulator.issues.map((issue) => issue.id),
        },
      }),
    });
  }

  const reasons: Array<ResetReason> = [];

  if (accumulator.issues.length > 0) {
    reasons.push({
      code: 'blocking_issue',
      message: 'Function unit reset because the build review found unresolved critical or major issues.',
      issues: accumulator.issues,
    });
  }

  if (accumulator.failed_in_review) {
    reasons.push({
      code: 'failed_in_review',
      message: 'Function unit reset because it was marked failed during build review.',
    });
  }

  return {
    fu_id: accumulator.fu_id,
    title: accumulator.title,
    old_status: accumulator.old_status,
    new_status: FUNCTION_UNIT_STATUSES.PENDING,
    reasons,
  };
}

function approveBuild(input: ApproveBuildInput): BuildGateSuccessPayload {
  const db = getDb();
  const runApproval = db.transaction(
    (currentInput: ApproveBuildInput): BuildGateSuccessPayload => {
      const buildCycleRow = getBuildCycleRowById(currentInput.build_cycle_id);

      if (!isBuildCycleStatus(buildCycleRow.status)) {
        throw new TypeError(
          `Invalid build cycle status returned from database: ${buildCycleRow.status}`
        );
      }

      assertReviewingBuildCycle(buildCycleRow.status, currentInput.build_cycle_id);

      const featureStatusRow = getFeatureStatusRowById(buildCycleRow.feature_id);

      if (!isFeatureStatus(featureStatusRow.status)) {
        throw new TypeError(
          `Invalid feature status returned from database: ${featureStatusRow.status}`
        );
      }

      assertBuildReviewFeatureStatus(featureStatusRow.status, buildCycleRow.feature_id);

      const gateEvaluation = evaluateBuildApprovalGate(
        buildBuildApprovalGateInput(buildCycleRow.feature_id, currentInput.build_cycle_id)
      );

      if (!gateEvaluation.passed) {
        throw new Error(
          JSON.stringify(
            {
              message: 'Build approval gate failed.',
              build_cycle_id: currentInput.build_cycle_id,
              feature_id: buildCycleRow.feature_id,
              failures: gateEvaluation.failures,
            },
            null,
            2
          )
        );
      }

      db.prepare(
        `
          UPDATE build_cycles
          SET status = ?
          WHERE id = ?
        `
      ).run(BUILD_CYCLE_STATUSES.APPROVED, currentInput.build_cycle_id);

      logStatusChange({
        entity_type: STATUS_AUDIT_LOG_ENTITY_TYPES.BUILD_CYCLE,
        entity_id: currentInput.build_cycle_id,
        old_status: BUILD_CYCLE_STATUSES.REVIEWING,
        new_status: BUILD_CYCLE_STATUSES.APPROVED,
        context: 'blueprint_approve_build',
      });

      const nextFeatureStatus = transitionFeatureStatusFromLifecycleEvent(
        featureStatusRow.status,
        FEATURE_LIFECYCLE_EVENTS.BUILD_APPROVED,
        {
          hasApprovedBuildCycle: true,
          hasBlockingOpenIssues: false,
        }
      );

      db.prepare(
        `
          UPDATE features
          SET status = ?
          WHERE id = ?
        `
      ).run(nextFeatureStatus, buildCycleRow.feature_id);

      logStatusChange({
        entity_type: STATUS_AUDIT_LOG_ENTITY_TYPES.FEATURE,
        entity_id: buildCycleRow.feature_id,
        old_status: featureStatusRow.status,
        new_status: nextFeatureStatus,
        context: 'blueprint_approve_build',
      });

      return {
        build_cycle_id: currentInput.build_cycle_id,
        build_cycle_status: BUILD_CYCLE_STATUSES.APPROVED,
        feature_id: buildCycleRow.feature_id,
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

function rejectBuild(input: RejectBuildInput): BuildGateSuccessPayload {
  const db = getDb();
  const runRejection = db.transaction(
    (currentInput: RejectBuildInput): BuildGateSuccessPayload => {
      const buildCycleRow = getBuildCycleRowById(currentInput.build_cycle_id);

      if (!isBuildCycleStatus(buildCycleRow.status)) {
        throw new TypeError(
          `Invalid build cycle status returned from database: ${buildCycleRow.status}`
        );
      }

      assertReviewingBuildCycle(buildCycleRow.status, currentInput.build_cycle_id);

      const featureStatusRow = getFeatureStatusRowById(buildCycleRow.feature_id);

      if (!isFeatureStatus(featureStatusRow.status)) {
        throw new TypeError(
          `Invalid feature status returned from database: ${featureStatusRow.status}`
        );
      }

      assertBuildReviewFeatureStatus(featureStatusRow.status, buildCycleRow.feature_id);

      const issues = getBuildIssues(currentInput.build_cycle_id);
      const gateEvaluation = evaluateBuildApprovalGate({
        feature: buildBuildApprovalGateInput(buildCycleRow.feature_id, currentInput.build_cycle_id).feature,
        issues,
        active_work_locks: getActiveWorkLocks(buildCycleRow.feature_id),
      });
      const resetAccumulators = buildResetAccumulators(buildCycleRow.feature_id, issues);
      const resetFunctionUnits: Array<ResetFunctionUnitSummary> = [];

      for (const accumulator of resetAccumulators.values()) {
        resetFunctionUnits.push(
          updateFunctionUnitStatusToPending(currentInput.build_cycle_id, accumulator)
        );
      }

      resetMergePointsForMergedFunctionUnits(
        resetFunctionUnits.map((functionUnit) => functionUnit.fu_id)
      );

      db.prepare(
        `
          UPDATE build_cycles
          SET status = ?
          WHERE id = ?
        `
      ).run(BUILD_CYCLE_STATUSES.REJECTED, currentInput.build_cycle_id);

      logStatusChange({
        entity_type: STATUS_AUDIT_LOG_ENTITY_TYPES.BUILD_CYCLE,
        entity_id: currentInput.build_cycle_id,
        old_status: BUILD_CYCLE_STATUSES.REVIEWING,
        new_status: BUILD_CYCLE_STATUSES.REJECTED,
        context: 'blueprint_reject_build',
      });

      const nextFeatureStatus = transitionFeatureStatusFromLifecycleEvent(
        featureStatusRow.status,
        FEATURE_LIFECYCLE_EVENTS.BUILD_REJECTED
      );

      db.prepare(
        `
          UPDATE features
          SET status = ?
          WHERE id = ?
        `
      ).run(nextFeatureStatus, buildCycleRow.feature_id);

      logStatusChange({
        entity_type: STATUS_AUDIT_LOG_ENTITY_TYPES.FEATURE,
        entity_id: buildCycleRow.feature_id,
        old_status: featureStatusRow.status,
        new_status: nextFeatureStatus,
        context: 'blueprint_reject_build',
      });

      return {
        build_cycle_id: currentInput.build_cycle_id,
        build_cycle_status: BUILD_CYCLE_STATUSES.REJECTED,
        feature_id: buildCycleRow.feature_id,
        feature_status: nextFeatureStatus,
        gate: {
          passed: gateEvaluation.passed,
          failures: gateEvaluation.failures,
        },
        reset_function_units: resetFunctionUnits,
      };
    }
  );

  return runRejection(input);
}

const approveBuildTool = defineTool({
  name: 'blueprint_approve_build',
  description: 'Approve a build review cycle after enforcing build gate rules.',
  inputSchema: {
    build_cycle_id: z.string().min(1),
  },
  handler: async ({ build_cycle_id }): Promise<CallToolResult> => {
    try {
      const result = approveBuild({ build_cycle_id });

      return formatToolResult(result);
    } catch (error: unknown) {
      const message = getErrorMessage(error);

      if (message.startsWith('{')) {
        return createToolErrorResult(message);
      }

      return createStructuredToolErrorResult({
        message,
        build_cycle_id,
      });
    }
  },
});

const rejectBuildTool = defineTool({
  name: 'blueprint_reject_build',
  description: 'Reject a build review cycle, restore the feature to building, and reset blocked work.',
  inputSchema: {
    build_cycle_id: z.string().min(1),
  },
  handler: async ({ build_cycle_id }): Promise<CallToolResult> => {
    try {
      const result = rejectBuild({ build_cycle_id });

      return formatToolResult(result);
    } catch (error: unknown) {
      return createStructuredToolErrorResult({
        message: getErrorMessage(error),
        build_cycle_id,
      });
    }
  },
});

export const buildGateToolDefinitions: Array<BlueprintToolDefinition> = [
  approveBuildTool,
  rejectBuildTool,
];

export { approveBuild, rejectBuild };
