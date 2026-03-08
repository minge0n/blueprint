import type { FunctionUnit } from '../../entities/function-unit.js';
import {
  FUNCTION_UNIT_DEPENDENCY_TYPES,
  FUNCTION_UNIT_STATUSES,
} from '../../entities/types.js';
import { WORK_LOCK_STATUSES, type WorkLock } from '../../entities/work-lock.js';
import type { MergePoint } from '../../entities/merge-point.js';
import { getDb } from '../index.js';
import { getTopologicalOrder, getUnblockedFUs } from './dependency.js';
import { expireStaleWorkLocks } from './lock.js';
import {
  checkMergeReady,
  createMergePointBlockCheck,
  getBlockingMergePointForFunctionUnit,
  listMergePoints,
} from './merge-point.js';

export interface ParallelStatusAgent {
  readonly agent_id: string;
  readonly fu_id: string;
  readonly lock_id: string;
  readonly lock_acquired_at: string;
  readonly last_heartbeat: string;
}

export interface ParallelStatusBlockedFunctionUnit {
  readonly fu_id: string;
  readonly title: string;
  readonly reason: string;
}

export interface ParallelStatusAvailableFunctionUnit {
  readonly fu_id: string;
  readonly title: string;
}

export interface ParallelStatusMergePoint extends MergePoint {
  readonly ready: boolean;
  readonly pending_trigger_fus: Array<string>;
}

export interface ParallelStatusResult {
  readonly agents: Array<ParallelStatusAgent>;
  readonly merge_points: Array<ParallelStatusMergePoint>;
  readonly blocked_fus: Array<ParallelStatusBlockedFunctionUnit>;
  readonly available_fus: Array<ParallelStatusAvailableFunctionUnit>;
}

interface ActiveWorkLockRow {
  readonly id: string;
  readonly fu_id: string;
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

function getActiveLocksForFeature(featureId: string): Array<WorkLock> {
  const db = getDb();
  const rows = db.prepare(
    `
      SELECT
        work_locks.id,
        work_locks.fu_id,
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
      ORDER BY work_locks.acquired_at ASC, work_locks.id ASC
    `
  ).all(featureId, WORK_LOCK_STATUSES.ACTIVE);
  const activeLocks: Array<WorkLock> = [];

  for (const row of rows) {
    if (!isActiveWorkLockRow(row)) {
      throw new TypeError('Invalid active work lock row returned from database.');
    }

    activeLocks.push({
      id: row.id,
      fu_id: row.fu_id,
      agent_id: row.agent_id,
      acquired_at: row.acquired_at,
      heartbeat_at: row.heartbeat_at,
      released_at: row.released_at,
      release_reason: row.release_reason,
      ttl_seconds: typeof row.ttl_seconds === 'bigint' ? Number(row.ttl_seconds) : row.ttl_seconds,
      status: WORK_LOCK_STATUSES.ACTIVE,
    });
  }

  return activeLocks;
}

function createLockMap(workLocks: Array<WorkLock>): Map<string, WorkLock> {
  const lockMap = new Map<string, WorkLock>();

  for (const workLock of workLocks) {
    lockMap.set(workLock.fu_id, workLock);
  }

  return lockMap;
}

function buildBlockedReason(
  functionUnit: FunctionUnit,
  featureId: string,
  functionUnitMap: Map<string, FunctionUnit>
): string {
  const blockingMergePoint = getBlockingMergePointForFunctionUnit(featureId, functionUnit.id);

  if (blockingMergePoint !== null) {
    const mergeReadyState = checkMergeReady(blockingMergePoint.id);

    if (!mergeReadyState.ready) {
      return `merge point waiting on ${mergeReadyState.pending_trigger_fus.join(', ')}`;
    }
  }

  for (const dependency of functionUnit.depends_on) {
    if (dependency.type !== FUNCTION_UNIT_DEPENDENCY_TYPES.HARD) {
      continue;
    }

    const dependencyFunctionUnit = functionUnitMap.get(dependency.fu_id);

    if (dependencyFunctionUnit === undefined) {
      return `dependency ${dependency.fu_id} is not passed`;
    }

    if (dependencyFunctionUnit.status === FUNCTION_UNIT_STATUSES.PASSED) {
      continue;
    }

    return `dependency ${dependency.fu_id} is ${dependencyFunctionUnit.status}`;
  }

  return 'blocked by unresolved dependency';
}

export function getParallelStatus(featureId: string): ParallelStatusResult {
  expireStaleWorkLocks();

  const topologicalOrder = getTopologicalOrder(featureId);
  const blockCheck = createMergePointBlockCheck(featureId);
  const unblockedFunctionUnits = getUnblockedFUs(featureId, blockCheck);
  const unblockedFunctionUnitIds = new Set<string>();

  for (const functionUnit of unblockedFunctionUnits) {
    if (
      functionUnit.status !== FUNCTION_UNIT_STATUSES.PASSED &&
      functionUnit.status !== FUNCTION_UNIT_STATUSES.FAILED
    ) {
      unblockedFunctionUnitIds.add(functionUnit.id);
    }
  }

  const workLocks = getActiveLocksForFeature(featureId);
  const lockMap = createLockMap(workLocks);
  const functionUnitMap = new Map<string, FunctionUnit>();

  for (const functionUnit of topologicalOrder) {
    functionUnitMap.set(functionUnit.id, functionUnit);
  }

  const agents: Array<ParallelStatusAgent> = workLocks.map((workLock) => {
    return {
      agent_id: workLock.agent_id,
      fu_id: workLock.fu_id,
      lock_id: workLock.id,
      lock_acquired_at: workLock.acquired_at,
      last_heartbeat: workLock.heartbeat_at,
    };
  });
  const mergePoints = listMergePoints(featureId).map((mergePoint) => {
    const readiness = checkMergeReady(mergePoint.id);

    return {
      ...readiness.merge_point,
      ready: readiness.ready,
      pending_trigger_fus: readiness.pending_trigger_fus,
    };
  });
  const blockedFUs: Array<ParallelStatusBlockedFunctionUnit> = [];
  const availableFUs: Array<ParallelStatusAvailableFunctionUnit> = [];

  for (const functionUnit of topologicalOrder) {
    if (
      functionUnit.status === FUNCTION_UNIT_STATUSES.PASSED ||
      functionUnit.status === FUNCTION_UNIT_STATUSES.FAILED
    ) {
      continue;
    }

    const activeLock = lockMap.get(functionUnit.id);

    if (unblockedFunctionUnitIds.has(functionUnit.id) && activeLock === undefined) {
      availableFUs.push({
        fu_id: functionUnit.id,
        title: functionUnit.title,
      });

      continue;
    }

    if (!unblockedFunctionUnitIds.has(functionUnit.id)) {
      blockedFUs.push({
        fu_id: functionUnit.id,
        title: functionUnit.title,
        reason: buildBlockedReason(functionUnit, featureId, functionUnitMap),
      });
    }
  }

  return {
    agents,
    merge_points: mergePoints,
    blocked_fus: blockedFUs,
    available_fus: availableFUs,
  };
}
