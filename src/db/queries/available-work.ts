import { randomUUID } from 'node:crypto';

import { getDb } from '../index.js';
import { getUnblockedFUs, getTopologicalOrder } from './dependency.js';
import { expireStaleWorkLocks } from './lock.js';
import { createMergePointBlockCheck } from './merge-point.js';
import { getFullFeatureById } from './feature.js';
import { getActiveBuildCycleForFeature } from './build-cycle.js';
import { logStatusChange } from './status-audit-log.js';
import { STATUS_AUDIT_LOG_ENTITY_TYPES } from '../../entities/status-audit-log.js';
import type { FunctionUnit } from '../../entities/function-unit.js';
import { FEATURE_PRIORITIES, FUNCTION_UNIT_STATUSES } from '../../entities/types.js';
import type { BuildCycle } from '../../entities/build-cycle.js';
import { WORK_LOCK_STATUSES, type WorkLock } from '../../entities/work-lock.js';

export interface BlueprintGetAvailableWorkInput {
  readonly agent_id: string;
}

export interface AvailableWorkResult {
  readonly build_cycle_id: string;
  readonly lock_id: string;
  readonly fu: FunctionUnit;
  readonly work_lock: WorkLock;
}

interface CandidateFeatureRow {
  readonly feature_id: string;
  readonly priority: string;
}

interface ActiveWorkLockRow {
  readonly id: string;
  readonly fu_id: string;
  readonly feature_id: string;
  readonly agent_id: string;
  readonly acquired_at: string;
  readonly heartbeat_at: string;
  readonly released_at: string | null;
  readonly release_reason: string | null;
  readonly ttl_seconds: number | bigint;
  readonly status: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return true;
}

function isCandidateFeatureRow(value: unknown): value is CandidateFeatureRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.feature_id !== 'string') {
    return false;
  }

  if (typeof value.priority !== 'string') {
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

  if (typeof value.feature_id !== 'string') {
    return false;
  }

  if (typeof value.acquired_at !== 'string') {
    return false;
  }

  if (typeof value.heartbeat_at !== 'string') {
    return false;
  }

  if (value.released_at !== null && typeof value.released_at !== 'string') {
    return false;
  }

  if (value.release_reason !== null && typeof value.release_reason !== 'string') {
    return false;
  }

  if (typeof value.ttl_seconds !== 'number' && typeof value.ttl_seconds !== 'bigint') {
    return false;
  }

  if (typeof value.status !== 'string') {
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

function mapWorkLockRow(row: ActiveWorkLockRow): WorkLock {
  return {
    id: row.id,
    fu_id: row.fu_id,
    agent_id: row.agent_id,
    acquired_at: row.acquired_at,
    heartbeat_at: row.heartbeat_at,
    released_at: row.released_at,
    release_reason: row.release_reason,
    ttl_seconds: normalizeInteger(row.ttl_seconds),
    status: WORK_LOCK_STATUSES.ACTIVE,
  };
}

function getActiveLockForAgent(agentId: string): ActiveWorkLockRow | null {
  const db = getDb();
  const row = db.prepare(
    `
      SELECT
        work_locks.id,
        work_locks.fu_id,
        function_units.feature_id,
        work_locks.agent_id,
        work_locks.acquired_at,
        work_locks.heartbeat_at,
        work_locks.released_at,
        work_locks.release_reason,
        work_locks.ttl_seconds,
        work_locks.status
      FROM work_locks
      INNER JOIN function_units ON function_units.id = work_locks.fu_id
      WHERE work_locks.agent_id = ?
        AND work_locks.status = ?
      ORDER BY work_locks.acquired_at DESC, work_locks.id DESC
      LIMIT 1
    `
  ).get(agentId, WORK_LOCK_STATUSES.ACTIVE);

  if (row === undefined) {
    return null;
  }

  if (!isActiveWorkLockRow(row)) {
    throw new TypeError('Invalid active work lock row returned from database.');
  }

  return row;
}

function getCandidateFeatureIds(): Array<string> {
  const db = getDb();
  const rows = db.prepare(
    `
      SELECT features.id AS feature_id, features.priority
      FROM features
      INNER JOIN build_cycles ON build_cycles.feature_id = features.id
      WHERE build_cycles.status = 'building'
      ORDER BY
        CASE features.priority
          WHEN 'p0' THEN 0
          WHEN 'p1' THEN 1
          WHEN 'p2' THEN 2
          ELSE 3
        END ASC,
        build_cycles.iteration ASC,
        features.id ASC
    `
  ).all();
  const candidateFeatureIds: Array<string> = [];

  for (const row of rows) {
    if (!isCandidateFeatureRow(row)) {
      throw new TypeError('Invalid available work feature row returned from database.');
    }

    if (
      row.priority !== FEATURE_PRIORITIES.P0 &&
      row.priority !== FEATURE_PRIORITIES.P1 &&
      row.priority !== FEATURE_PRIORITIES.P2
    ) {
      throw new TypeError(`Invalid feature priority returned from database: ${row.priority}`);
    }

    candidateFeatureIds.push(row.feature_id);
  }

  return candidateFeatureIds;
}

function getActiveLocksForFeature(featureId: string): Map<string, WorkLock> {
  const db = getDb();
  const rows = db.prepare(
    `
      SELECT
        work_locks.id,
        work_locks.fu_id,
        function_units.feature_id,
        work_locks.agent_id,
        work_locks.acquired_at,
        work_locks.heartbeat_at,
        work_locks.released_at,
        work_locks.release_reason,
        work_locks.ttl_seconds,
        work_locks.status
      FROM work_locks
      INNER JOIN function_units ON function_units.id = work_locks.fu_id
      WHERE function_units.feature_id = ?
        AND work_locks.status = ?
      ORDER BY work_locks.acquired_at DESC, work_locks.id DESC
    `
  ).all(featureId, WORK_LOCK_STATUSES.ACTIVE);
  const activeLocks = new Map<string, WorkLock>();

  for (const row of rows) {
    if (!isActiveWorkLockRow(row)) {
      throw new TypeError('Invalid active work lock row returned from database.');
    }

    if (!activeLocks.has(row.fu_id)) {
      activeLocks.set(row.fu_id, mapWorkLockRow(row));
    }
  }

  return activeLocks;
}

function getFunctionUnitById(featureId: string, fuId: string): FunctionUnit {
  const feature = getFullFeatureById(featureId);

  if (feature === null) {
    throw new Error(`Feature not found: ${featureId}`);
  }

  for (const functionUnit of feature.function_units) {
    if (functionUnit.id === fuId) {
      return functionUnit;
    }
  }

  throw new Error(`Function unit not found in feature ${featureId}: ${fuId}`);
}

function buildExistingAssignment(activeLockRow: ActiveWorkLockRow): AvailableWorkResult | null {
  const buildCycle = getActiveBuildCycleForFeature(activeLockRow.feature_id);

  if (buildCycle === null) {
    return null;
  }

  const functionUnit = getFunctionUnitById(activeLockRow.feature_id, activeLockRow.fu_id);
  const workLock = mapWorkLockRow(activeLockRow);

  return {
    build_cycle_id: buildCycle.id,
    lock_id: workLock.id,
    fu: functionUnit,
    work_lock: workLock,
  };
}

function beginImmediateTransaction(): void {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
}

function commitTransaction(): void {
  const db = getDb();
  db.exec('COMMIT');
}

function rollbackTransaction(): void {
  const db = getDb();
  db.exec('ROLLBACK');
}

function createWorkLockId(): string {
  return `work_lock_${randomUUID()}`;
}

function insertWorkLock(fuId: string, agentId: string, acquiredAt: string): WorkLock {
  const db = getDb();
  const workLockId = createWorkLockId();

  db.prepare(
    `
      INSERT INTO work_locks (
        id,
        fu_id,
        agent_id,
        acquired_at,
        heartbeat_at,
        released_at,
        release_reason,
        ttl_seconds,
        status
      )
      VALUES (?, ?, ?, ?, ?, NULL, NULL, 300, ?)
    `
  ).run(workLockId, fuId, agentId, acquiredAt, acquiredAt, WORK_LOCK_STATUSES.ACTIVE);

  return {
    id: workLockId,
    fu_id: fuId,
    agent_id: agentId,
    acquired_at: acquiredAt,
    heartbeat_at: acquiredAt,
    released_at: null,
    release_reason: null,
    ttl_seconds: 300,
    status: WORK_LOCK_STATUSES.ACTIVE,
  };
}

function markFunctionUnitInProgress(
  buildCycle: BuildCycle,
  functionUnit: FunctionUnit,
  agentId: string
): void {
  const db = getDb();

  db.prepare(
    `
      UPDATE function_units
      SET status = ?,
          assigned_agent = ?
      WHERE id = ?
    `
  ).run(FUNCTION_UNIT_STATUSES.IN_PROGRESS, agentId, functionUnit.id);

  if (functionUnit.status !== FUNCTION_UNIT_STATUSES.IN_PROGRESS) {
    logStatusChange({
      entity_type: STATUS_AUDIT_LOG_ENTITY_TYPES.FUNCTION_UNIT,
      entity_id: functionUnit.id,
      old_status: functionUnit.status,
      new_status: FUNCTION_UNIT_STATUSES.IN_PROGRESS,
      changed_by: agentId,
      context: JSON.stringify({
        build_cycle_id: buildCycle.id,
        event: 'blueprint_get_available_work',
      }),
    });
  }
}

function selectFunctionUnitForFeature(featureId: string, agentId: string): AvailableWorkResult | null {
  const buildCycle = getActiveBuildCycleForFeature(featureId);

  if (buildCycle === null) {
    return null;
  }

  const blockCheck = createMergePointBlockCheck(featureId);
  const topologicalOrder = getTopologicalOrder(featureId);
  const unblockedFunctionUnits = getUnblockedFUs(featureId, blockCheck);
  const availableFunctionUnitIds = new Set<string>();

  for (const functionUnit of unblockedFunctionUnits) {
    if (
      functionUnit.status !== FUNCTION_UNIT_STATUSES.PASSED &&
      functionUnit.status !== FUNCTION_UNIT_STATUSES.FAILED
    ) {
      availableFunctionUnitIds.add(functionUnit.id);
    }
  }

  if (availableFunctionUnitIds.size === 0) {
    return null;
  }

  const activeLocks = getActiveLocksForFeature(featureId);

  for (const functionUnit of topologicalOrder) {
    if (!availableFunctionUnitIds.has(functionUnit.id)) {
      continue;
    }

    const existingLock = activeLocks.get(functionUnit.id);

    if (existingLock !== undefined && existingLock.agent_id !== agentId) {
      continue;
    }

    const assignedFunctionUnit = getFunctionUnitById(featureId, functionUnit.id);

    if (existingLock !== undefined) {
      return {
        build_cycle_id: buildCycle.id,
        lock_id: existingLock.id,
        fu: assignedFunctionUnit,
        work_lock: existingLock,
      };
    }

    const acquiredAt = new Date().toISOString();
    const workLock = insertWorkLock(functionUnit.id, agentId, acquiredAt);
    markFunctionUnitInProgress(buildCycle, functionUnit, agentId);

    return {
      build_cycle_id: buildCycle.id,
      lock_id: workLock.id,
      fu: getFunctionUnitById(featureId, functionUnit.id),
      work_lock: workLock,
    };
  }

  return null;
}

export function blueprintGetAvailableWork(
  input: BlueprintGetAvailableWorkInput
): AvailableWorkResult | null {
  beginImmediateTransaction();

  try {
    expireStaleWorkLocks();
    const existingLock = getActiveLockForAgent(input.agent_id);

    if (existingLock !== null) {
      const existingAssignment = buildExistingAssignment(existingLock);

      commitTransaction();

      return existingAssignment;
    }

    for (const featureId of getCandidateFeatureIds()) {
      const selection = selectFunctionUnitForFeature(featureId, input.agent_id);

      if (selection !== null) {
        commitTransaction();

        return selection;
      }
    }

    commitTransaction();

    return null;
  } catch (error: unknown) {
    rollbackTransaction();
    throw error;
  }
}
