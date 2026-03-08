import { getDb } from '../index.js';
import type { FullFeature } from './feature.js';
import { getFullFeatureById } from './feature.js';
import { logStatusChange } from './status-audit-log.js';
import {
  FEATURE_LIFECYCLE_EVENTS,
  transitionFeatureStatusFromLifecycleEvent,
} from '../../entities/feature-lifecycle.js';
import { STATUS_AUDIT_LOG_ENTITY_TYPES } from '../../entities/status-audit-log.js';
import {
  FEATURE_STATUSES,
  type FeatureStatus,
} from '../../entities/types.js';
import {
  PLAN_CYCLE_STATUSES,
  parsePlanCycleSnapshot,
  isPlanCycleStatus,
  type PlanCycle,
  type PlanCycleSnapshot,
} from '../../entities/plan-cycle.js';

export interface StartPlanReviewInput {
  readonly feature_id: string;
}

interface PlanCycleRow {
  readonly id: string;
  readonly feature_id: string;
  readonly iteration: number;
  readonly plan_snapshot: string;
  readonly status: string;
}

interface FeatureStatusRow {
  readonly status: string;
}

interface ActivePlanCycleCountRow {
  readonly active_cycle_count: number;
}

interface MaxIterationRow {
  readonly max_iteration: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
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

  if (typeof value.iteration !== 'number') {
    return false;
  }

  if (typeof value.plan_snapshot !== 'string') {
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

  if (typeof value.status !== 'string') {
    return false;
  }

  return true;
}

function isActivePlanCycleCountRow(value: unknown): value is ActivePlanCycleCountRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.active_cycle_count !== 'number') {
    return false;
  }

  return true;
}

function isMaxIterationRow(value: unknown): value is MaxIterationRow {
  if (!isRecord(value)) {
    return false;
  }

  if (value.max_iteration !== null && typeof value.max_iteration !== 'number') {
    return false;
  }

  return true;
}

function mapPlanCycleRow(row: PlanCycleRow): PlanCycle {
  if (!isPlanCycleStatus(row.status)) {
    throw new TypeError(`Invalid plan cycle status returned from database: ${row.status}`);
  }

  return {
    id: row.id,
    feature_id: row.feature_id,
    iteration: row.iteration,
    plan_snapshot: parsePlanCycleSnapshot(row.plan_snapshot),
    status: row.status,
  };
}

function createPlanCycleId(featureId: string, iteration: number): string {
  return `plan_cycle_${featureId}_${iteration}`;
}

function assertFeatureStatusAllowsPlanReview(status: FeatureStatus): void {
  if (status === FEATURE_STATUSES.DRAFT || status === FEATURE_STATUSES.PLAN_REVIEW) {
    return;
  }

  throw new Error(
    `Feature must be in 'draft' or 'plan_review' status. Current: ${status}`
  );
}

function getActivePlanCycleCount(featureId: string): number {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT COUNT(*) AS active_cycle_count
        FROM plan_cycles
        WHERE feature_id = ?
          AND status IN (?, ?)
      `
    )
    .get(
      featureId,
      PLAN_CYCLE_STATUSES.DRAFTING,
      PLAN_CYCLE_STATUSES.REVIEWING,
    );

  if (!isActivePlanCycleCountRow(row)) {
    throw new TypeError('Invalid active plan cycle count row returned from database.');
  }

  return row.active_cycle_count;
}

function assertNoActivePlanCycle(featureId: string): void {
  const activePlanCycleCount = getActivePlanCycleCount(featureId);

  if (activePlanCycleCount > 0) {
    throw new Error(`Feature already has an active plan cycle: ${featureId}`);
  }
}

function getNextPlanCycleIteration(featureId: string): number {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT MAX(iteration) AS max_iteration
        FROM plan_cycles
        WHERE feature_id = ?
      `
    )
    .get(featureId);

  if (!isMaxIterationRow(row)) {
    throw new TypeError('Invalid max plan cycle iteration row returned from database.');
  }

  if (row.max_iteration === null) {
    return 1;
  }

  return row.max_iteration + 1;
}

function createPlanCycleSnapshot(feature: FullFeature): PlanCycleSnapshot {
  return {
    captured_at: new Date().toISOString(),
    feature: {
      id: feature.id,
      title: feature.title,
      scope: feature.scope,
      out_of_scope: feature.out_of_scope,
      status: feature.status,
      priority: feature.priority,
      depends_on: feature.depends_on,
    },
    function_units: feature.function_units.map((functionUnit) => ({
      id: functionUnit.id,
      feature_id: functionUnit.feature_id,
      title: functionUnit.title,
      description: functionUnit.description,
      acceptance_criteria: functionUnit.acceptance_criteria.map((acceptanceCriteria) => ({
        id: acceptanceCriteria.id,
        fu_id: acceptanceCriteria.fu_id,
        description: acceptanceCriteria.description,
        type: acceptanceCriteria.type,
        severity: acceptanceCriteria.severity,
        status: acceptanceCriteria.status,
        verified_in: acceptanceCriteria.verified_in,
        evidence: acceptanceCriteria.evidence,
      })),
      depends_on: functionUnit.depends_on.map((dependency) => ({
        fu_id: dependency.fu_id,
        type: dependency.type,
      })),
      status: functionUnit.status,
      assigned_agent: functionUnit.assigned_agent,
      test_evidence: functionUnit.test_evidence,
      failure_reason: functionUnit.failure_reason,
    })),
  };
}

function getFeatureStatusRow(featureId: string): FeatureStatusRow {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT status
        FROM features
        WHERE id = ?
      `
    )
    .get(featureId);

  if (!isFeatureStatusRow(row)) {
    throw new Error(`Feature not found: ${featureId}`);
  }

  if (!isFeatureStatus(row.status)) {
    throw new TypeError(`Invalid feature status returned from database: ${row.status}`);
  }

  return row;
}

function getPlanCycleRowById(planCycleId: string): PlanCycleRow {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT
          id,
          feature_id,
          iteration,
          plan_snapshot,
          status
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

export function startPlanReview(input: StartPlanReviewInput): PlanCycle {
  const feature = getFullFeatureById(input.feature_id);

  if (feature === null) {
    throw new Error(`Feature not found: ${input.feature_id}`);
  }

  assertFeatureStatusAllowsPlanReview(feature.status);
  assertNoActivePlanCycle(feature.id);

  const iteration = getNextPlanCycleIteration(feature.id);
  const planCycleId = createPlanCycleId(feature.id, iteration);
  const planSnapshot = createPlanCycleSnapshot(feature);
  const serializedPlanSnapshot = JSON.stringify(planSnapshot);
  const db = getDb();
  const runStartPlanReview = db.transaction(
    (currentFeatureId: string, currentFeatureStatus: FeatureStatus): PlanCycle => {
      const latestFeatureStatusRow = getFeatureStatusRow(currentFeatureId);

      if (!isFeatureStatus(latestFeatureStatusRow.status)) {
        throw new TypeError(
          `Invalid feature status returned from database: ${latestFeatureStatusRow.status}`
        );
      }

      assertFeatureStatusAllowsPlanReview(latestFeatureStatusRow.status);
      assertNoActivePlanCycle(currentFeatureId);

      db.prepare(
        `
          INSERT INTO plan_cycles (
            id,
            feature_id,
            iteration,
            plan_snapshot,
            status
          )
          VALUES (?, ?, ?, ?, ?)
        `
      ).run(
        planCycleId,
        currentFeatureId,
        iteration,
        serializedPlanSnapshot,
        PLAN_CYCLE_STATUSES.DRAFTING,
      );

      logStatusChange({
        entity_type: STATUS_AUDIT_LOG_ENTITY_TYPES.PLAN_CYCLE,
        entity_id: planCycleId,
        old_status: null,
        new_status: PLAN_CYCLE_STATUSES.DRAFTING,
        context: 'blueprint_start_plan_review',
      });

      db.prepare(
        `
          UPDATE plan_cycles
          SET status = ?
          WHERE id = ?
        `
      ).run(PLAN_CYCLE_STATUSES.REVIEWING, planCycleId);

      logStatusChange({
        entity_type: STATUS_AUDIT_LOG_ENTITY_TYPES.PLAN_CYCLE,
        entity_id: planCycleId,
        old_status: PLAN_CYCLE_STATUSES.DRAFTING,
        new_status: PLAN_CYCLE_STATUSES.REVIEWING,
        context: 'blueprint_start_plan_review',
      });

      if (currentFeatureStatus === FEATURE_STATUSES.DRAFT) {
        const nextFeatureStatus = transitionFeatureStatusFromLifecycleEvent(
          currentFeatureStatus,
          FEATURE_LIFECYCLE_EVENTS.PLAN_REVIEW_STARTED
        );

        db.prepare(
          `
            UPDATE features
            SET status = ?
            WHERE id = ?
          `
        ).run(nextFeatureStatus, currentFeatureId);

        logStatusChange({
          entity_type: STATUS_AUDIT_LOG_ENTITY_TYPES.FEATURE,
          entity_id: currentFeatureId,
          old_status: FEATURE_STATUSES.DRAFT,
          new_status: nextFeatureStatus,
          context: 'blueprint_start_plan_review',
        });
      }

      return mapPlanCycleRow(getPlanCycleRowById(planCycleId));
    }
  );

  return runStartPlanReview(feature.id, feature.status);
}
