import { getDb } from '../index.js';
import type { BuildCycle } from '../../entities/build-cycle.js';
import { BUILD_CYCLE_STATUSES } from '../../entities/build-cycle.js';
import {
  FEATURE_LIFECYCLE_EVENTS,
  transitionFeatureStatusFromLifecycleEvent,
} from '../../entities/feature-lifecycle.js';
import type { Feature } from '../../entities/feature.js';
import { STATUS_AUDIT_LOG_ENTITY_TYPES } from '../../entities/status-audit-log.js';
import {
  FEATURE_PRIORITIES,
  FEATURE_STATUSES,
  FUNCTION_UNIT_STATUSES,
  type FeaturePriority,
  type FeatureStatus,
  type FunctionUnitStatus,
} from '../../entities/types.js';
import { WORK_LOCK_STATUSES } from '../../entities/work-lock.js';
import { getBuildCycleById } from './build-cycle.js';
import { getFeatureById } from './feature.js';
import { logStatusChange } from './status-audit-log.js';

export interface SubmitBuildForReviewInput {
  readonly build_cycle_id: string;
}

export interface SubmitBuildForReviewResult {
  readonly build_cycle: BuildCycle;
  readonly feature: Feature;
}

interface BuildCycleRow {
  readonly id: string;
  readonly feature_id: string;
  readonly iteration: number | bigint;
  readonly agent_id: string;
  readonly status: string;
}

interface FeatureRow {
  readonly id: string;
  readonly title: string;
  readonly scope: string;
  readonly out_of_scope: string;
  readonly status: string;
  readonly priority: string;
}

interface FeatureDependencyRow {
  readonly depends_on: string;
}

interface CountRow {
  readonly count: number | bigint;
}

interface FunctionUnitStatusRow {
  readonly id: string;
  readonly status: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return true;
}

function normalizeInteger(value: number | bigint): number {
  if (typeof value === 'bigint') {
    return Number(value);
  }

  return value;
}

function isBuildCycleStatus(value: string): value is BuildCycle['status'] {
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

  if (typeof value.iteration !== 'number' && typeof value.iteration !== 'bigint') {
    return false;
  }

  if (typeof value.agent_id !== 'string') {
    return false;
  }

  if (typeof value.status !== 'string') {
    return false;
  }

  return true;
}

function isFeatureRow(value: unknown): value is FeatureRow {
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

  if (typeof value.status !== 'string') {
    return false;
  }

  if (typeof value.priority !== 'string') {
    return false;
  }

  return true;
}

function isFeatureDependencyRow(value: unknown): value is FeatureDependencyRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.depends_on !== 'string') {
    return false;
  }

  return true;
}

function isCountRow(value: unknown): value is CountRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.count !== 'number' && typeof value.count !== 'bigint') {
    return false;
  }

  return true;
}

function isFunctionUnitStatusRow(value: unknown): value is FunctionUnitStatusRow {
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

function mapBuildCycleRow(row: BuildCycleRow): BuildCycle {
  if (!isBuildCycleStatus(row.status)) {
    throw new TypeError(`Invalid build cycle status returned from database: ${row.status}`);
  }

  return {
    id: row.id,
    feature_id: row.feature_id,
    iteration: normalizeInteger(row.iteration),
    agent_id: row.agent_id,
    status: row.status,
  };
}

function mapFeatureRow(row: FeatureRow, dependsOn: Array<string>): Feature {
  if (!isFeatureStatus(row.status)) {
    throw new TypeError(`Invalid feature status returned from database: ${row.status}`);
  }

  if (!isFeaturePriority(row.priority)) {
    throw new TypeError(`Invalid feature priority returned from database: ${row.priority}`);
  }

  return {
    id: row.id,
    title: row.title,
    scope: row.scope,
    out_of_scope: row.out_of_scope,
    status: row.status,
    priority: row.priority,
    depends_on: dependsOn,
  };
}

function getBuildCycleRowById(buildCycleId: string): BuildCycleRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT id, feature_id, iteration, agent_id, status
        FROM build_cycles
        WHERE id = ?
      `
    )
    .get(buildCycleId);

  if (row === undefined) {
    return null;
  }

  if (!isBuildCycleRow(row)) {
    throw new TypeError('Invalid build cycle row returned from database.');
  }

  return row;
}

function getFeatureRowById(featureId: string): FeatureRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT id, title, scope, out_of_scope, status, priority
        FROM features
        WHERE id = ?
      `
    )
    .get(featureId);

  if (row === undefined) {
    return null;
  }

  if (!isFeatureRow(row)) {
    throw new TypeError('Invalid feature row returned from database.');
  }

  return row;
}

function getFeatureDependencies(featureId: string): Array<string> {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT depends_on
        FROM feature_dependencies
        WHERE feature_id = ?
        ORDER BY depends_on ASC
      `
    )
    .all(featureId);
  const dependsOn: Array<string> = [];

  for (const row of rows) {
    if (!isFeatureDependencyRow(row)) {
      throw new TypeError('Invalid feature dependency row returned from database.');
    }

    dependsOn.push(row.depends_on);
  }

  return dependsOn;
}

function getFeature(featureId: string): Feature {
  const featureRow = getFeatureRowById(featureId);

  if (featureRow === null) {
    throw new Error(`Feature not found: ${featureId}`);
  }

  const dependsOn = getFeatureDependencies(featureId);

  return mapFeatureRow(featureRow, dependsOn);
}

function getActiveWorkLockCountForFeature(featureId: string): number {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM work_locks
        INNER JOIN function_units ON function_units.id = work_locks.fu_id
        WHERE function_units.feature_id = ?
          AND work_locks.status = ?
      `
    )
    .get(featureId, WORK_LOCK_STATUSES.ACTIVE);

  if (!isCountRow(row)) {
    throw new TypeError('Invalid active work lock count row returned from database.');
  }

  return normalizeInteger(row.count);
}

function getIncompleteFunctionUnits(featureId: string): Array<FunctionUnitStatusRow> {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT id, status
        FROM function_units
        WHERE feature_id = ?
          AND status != ?
        ORDER BY id ASC
      `
    )
    .all(featureId, FUNCTION_UNIT_STATUSES.PASSED);
  const incompleteFunctionUnits: Array<FunctionUnitStatusRow> = [];

  for (const row of rows) {
    if (!isFunctionUnitStatusRow(row)) {
      throw new TypeError('Invalid function unit status row returned from database.');
    }

    if (!isFunctionUnitStatus(row.status)) {
      throw new TypeError(`Invalid function unit status returned from database: ${row.status}`);
    }

    incompleteFunctionUnits.push(row);
  }

  return incompleteFunctionUnits;
}

function createAuditContext(buildCycleId: string, featureId: string): string {
  return JSON.stringify({
    event: 'blueprint_submit_for_review',
    build_cycle_id: buildCycleId,
    feature_id: featureId,
  });
}

export function submitBuildForReview(
  input: SubmitBuildForReviewInput
): SubmitBuildForReviewResult {
  const db = getDb();
  const runSubmitForReview = db.transaction(
    (currentInput: SubmitBuildForReviewInput): SubmitBuildForReviewResult => {
      const existingBuildCycleRow = getBuildCycleRowById(currentInput.build_cycle_id);

      if (existingBuildCycleRow === null) {
        throw new Error(`Build cycle not found: ${currentInput.build_cycle_id}`);
      }

      const buildCycle = mapBuildCycleRow(existingBuildCycleRow);

      if (buildCycle.status !== BUILD_CYCLE_STATUSES.BUILDING) {
        throw new Error(
          `Build cycle must be in 'building' status. Current: ${buildCycle.status}`
        );
      }

      const feature = getFeature(buildCycle.feature_id);

      if (feature.status !== FEATURE_STATUSES.BUILDING) {
        throw new Error(`Feature must be in 'building' status. Current: ${feature.status}`);
      }

      const activeWorkLockCount = getActiveWorkLockCountForFeature(feature.id);

      if (activeWorkLockCount > 0) {
        throw new Error(
          `Cannot submit build cycle for review while ${activeWorkLockCount} active work lock(s) remain on the feature.`
        );
      }

      const incompleteFunctionUnits = getIncompleteFunctionUnits(feature.id);

      if (incompleteFunctionUnits.length > 0) {
        const incompleteFunctionUnitIds = incompleteFunctionUnits.map((functionUnit) => functionUnit.id);

        throw new Error(
          `Cannot submit build cycle for review until all function units are passed. Incomplete: ${incompleteFunctionUnitIds.join(', ')}`
        );
      }

      const auditContext = createAuditContext(buildCycle.id, feature.id);
      const nextFeatureStatus = transitionFeatureStatusFromLifecycleEvent(
        feature.status,
        FEATURE_LIFECYCLE_EVENTS.BUILD_REVIEW_STARTED
      );

      db.prepare(
        `
          UPDATE build_cycles
          SET status = ?
          WHERE id = ?
        `
      ).run(BUILD_CYCLE_STATUSES.REVIEWING, buildCycle.id);

      logStatusChange({
        entity_type: STATUS_AUDIT_LOG_ENTITY_TYPES.BUILD_CYCLE,
        entity_id: buildCycle.id,
        old_status: buildCycle.status,
        new_status: BUILD_CYCLE_STATUSES.REVIEWING,
        context: auditContext,
      });

      db.prepare(
        `
          UPDATE session_logs
          SET ended_at = ?, end_reason = 'done'
          WHERE build_cycle_id = ? AND ended_at IS NULL
        `
      ).run(new Date().toISOString(), buildCycle.id);

      db.prepare(
        `
          UPDATE features
          SET status = ?
          WHERE id = ?
        `
      ).run(nextFeatureStatus, feature.id);

      logStatusChange({
        entity_type: STATUS_AUDIT_LOG_ENTITY_TYPES.FEATURE,
        entity_id: feature.id,
        old_status: feature.status,
        new_status: nextFeatureStatus,
        context: auditContext,
      });

      const updatedBuildCycle = getBuildCycleById(buildCycle.id);

      if (updatedBuildCycle === null) {
        throw new Error(`Updated build cycle could not be loaded: ${buildCycle.id}`);
      }

      const updatedFeature = getFeatureById(feature.id);

      if (updatedFeature === null) {
        throw new Error(`Updated feature could not be loaded: ${feature.id}`);
      }

      return {
        build_cycle: updatedBuildCycle,
        feature: updatedFeature,
      };
    }
  );

  return runSubmitForReview(input);
}
