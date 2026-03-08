import { getDb } from '../index.js';
import type { FunctionUnitStatus } from '../../entities/types.js';
import { FUNCTION_UNIT_STATUSES } from '../../entities/types.js';
import {
  MERGE_POINT_STATUSES,
  type MergePoint,
  type MergePointStatus,
} from '../../entities/merge-point.js';
import type { AdditionalBlockCheck } from '../../graph/types.js';

export interface AddMergePointInput {
  readonly feature_id: string;
  readonly trigger_fus: Array<string>;
  readonly merged_fu: string;
}

export interface CheckMergeReadyResult {
  readonly merge_point: MergePoint;
  readonly ready: boolean;
  readonly pending_trigger_fus: Array<string>;
}

interface MergePointRow {
  readonly id: string;
  readonly feature_id: string;
  readonly trigger_fus: string;
  readonly merged_fu: string;
  readonly status: string;
}

interface FunctionUnitFeatureRow {
  readonly id: string;
  readonly feature_id: string;
  readonly status: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return true;
}

function isMergePointStatus(value: string): value is MergePointStatus {
  switch (value) {
    case MERGE_POINT_STATUSES.WAITING:
    case MERGE_POINT_STATUSES.READY:
    case MERGE_POINT_STATUSES.PASSED:
    case MERGE_POINT_STATUSES.FAILED:
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

function isMergePointRow(value: unknown): value is MergePointRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string') {
    return false;
  }

  if (typeof value.feature_id !== 'string') {
    return false;
  }

  if (typeof value.trigger_fus !== 'string') {
    return false;
  }

  if (typeof value.merged_fu !== 'string') {
    return false;
  }

  if (typeof value.status !== 'string') {
    return false;
  }

  return true;
}

function isFunctionUnitFeatureRow(value: unknown): value is FunctionUnitFeatureRow {
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

function parseTriggerFunctionUnits(value: string): Array<string> {
  const parsedValue: unknown = JSON.parse(value);

  if (!Array.isArray(parsedValue)) {
    throw new TypeError('Invalid merge point trigger_fus returned from database.');
  }

  const triggerFunctionUnits: Array<string> = [];

  for (const entry of parsedValue) {
    if (typeof entry !== 'string') {
      throw new TypeError('Invalid merge point trigger_fus entry returned from database.');
    }

    triggerFunctionUnits.push(entry);
  }

  return triggerFunctionUnits;
}

function normalizeTriggerFunctionUnits(triggerFus: Array<string>): Array<string> {
  const dedupedTriggerFus = new Set<string>();

  for (const triggerFu of triggerFus) {
    const normalizedTriggerFu = triggerFu.trim();

    if (normalizedTriggerFu.length > 0) {
      dedupedTriggerFus.add(normalizedTriggerFu);
    }
  }

  return Array.from(dedupedTriggerFus);
}

function mapMergePointRow(row: MergePointRow): MergePoint {
  if (!isMergePointStatus(row.status)) {
    throw new TypeError(`Invalid merge point status returned from database: ${row.status}`);
  }

  return {
    id: row.id,
    feature_id: row.feature_id,
    trigger_fus: parseTriggerFunctionUnits(row.trigger_fus),
    merged_fu: row.merged_fu,
    status: row.status,
  };
}

function getFunctionUnitFeatureRowById(fuId: string): FunctionUnitFeatureRow {
  const db = getDb();
  const row = db.prepare(
    `
      SELECT id, feature_id, status
      FROM function_units
      WHERE id = ?
    `
  ).get(fuId);

  if (!isFunctionUnitFeatureRow(row)) {
    throw new Error(`Function unit not found: ${fuId}`);
  }

  if (!isFunctionUnitStatus(row.status)) {
    throw new TypeError(`Invalid function unit status returned from database: ${row.status}`);
  }

  return row;
}

function createMergePointId(featureId: string): string {
  const db = getDb();
  const row = db.prepare(
    `
      SELECT COUNT(*) AS merge_point_count
      FROM merge_points
      WHERE feature_id = ?
    `
  ).get(featureId);

  if (!isRecord(row) || (typeof row.merge_point_count !== 'number' && typeof row.merge_point_count !== 'bigint')) {
    throw new TypeError('Invalid merge point counter row returned from database.');
  }

  const mergePointCount = typeof row.merge_point_count === 'bigint'
    ? Number(row.merge_point_count)
    : row.merge_point_count;

  return `merge_point_${featureId}_${mergePointCount + 1}`;
}

function getMergePointRowById(mergePointId: string): MergePointRow | null {
  const db = getDb();
  const row = db.prepare(
    `
      SELECT id, feature_id, trigger_fus, merged_fu, status
      FROM merge_points
      WHERE id = ?
    `
  ).get(mergePointId);

  if (row === undefined) {
    return null;
  }

  if (!isMergePointRow(row)) {
    throw new TypeError('Invalid merge point row returned from database.');
  }

  return row;
}

function updateMergePointStatus(mergePointId: string, status: MergePointStatus): MergePoint {
  const db = getDb();
  db.prepare(
    `
      UPDATE merge_points
      SET status = ?
      WHERE id = ?
    `
  ).run(status, mergePointId);

  const mergePoint = getMergePointById(mergePointId);

  if (mergePoint === null) {
    throw new Error(`Merge point not found after update: ${mergePointId}`);
  }

  return mergePoint;
}

function getPendingTriggerFunctionUnits(mergePoint: MergePoint): Array<string> {
  const pendingTriggerFunctionUnits: Array<string> = [];

  for (const triggerFuId of mergePoint.trigger_fus) {
    const functionUnit = getFunctionUnitFeatureRowById(triggerFuId);

    if (functionUnit.status !== FUNCTION_UNIT_STATUSES.PASSED) {
      pendingTriggerFunctionUnits.push(triggerFuId);
    }
  }

  return pendingTriggerFunctionUnits;
}

export function getMergePointById(mergePointId: string): MergePoint | null {
  const row = getMergePointRowById(mergePointId);

  if (row === null) {
    return null;
  }

  return mapMergePointRow(row);
}

export function listMergePoints(featureId: string): Array<MergePoint> {
  const db = getDb();
  const rows = db.prepare(
    `
      SELECT id, feature_id, trigger_fus, merged_fu, status
      FROM merge_points
      WHERE feature_id = ?
      ORDER BY id ASC
    `
  ).all(featureId);
  const mergePoints: Array<MergePoint> = [];

  for (const row of rows) {
    if (!isMergePointRow(row)) {
      throw new TypeError('Invalid merge point row returned from database.');
    }

    mergePoints.push(mapMergePointRow(row));
  }

  return mergePoints;
}

export function addMergePoint(input: AddMergePointInput): MergePoint {
  const triggerFunctionUnits = normalizeTriggerFunctionUnits(input.trigger_fus);

  if (triggerFunctionUnits.length === 0) {
    throw new Error('trigger_fus must contain at least one function unit');
  }

  const db = getDb();
  const runAddMergePoint = db.transaction((currentInput: AddMergePointInput): MergePoint => {
    for (const triggerFuId of triggerFunctionUnits) {
      const triggerFunctionUnit = getFunctionUnitFeatureRowById(triggerFuId);

      if (triggerFunctionUnit.feature_id !== currentInput.feature_id) {
        throw new Error(
          `Trigger function unit ${triggerFuId} does not belong to feature ${currentInput.feature_id}`
        );
      }
    }

    const mergedFunctionUnit = getFunctionUnitFeatureRowById(currentInput.merged_fu);

    if (mergedFunctionUnit.feature_id !== currentInput.feature_id) {
      throw new Error(
        `Merged function unit ${currentInput.merged_fu} does not belong to feature ${currentInput.feature_id}`
      );
    }

    const mergePointId = createMergePointId(currentInput.feature_id);

    db.prepare(
      `
        INSERT INTO merge_points (id, feature_id, trigger_fus, merged_fu, status)
        VALUES (?, ?, ?, ?, ?)
      `
    ).run(
      mergePointId,
      currentInput.feature_id,
      JSON.stringify(triggerFunctionUnits),
      currentInput.merged_fu,
      MERGE_POINT_STATUSES.WAITING
    );

    const mergePoint = getMergePointById(mergePointId);

    if (mergePoint === null) {
      throw new Error(`Merge point not found after creation: ${mergePointId}`);
    }

    return mergePoint;
  });

  return runAddMergePoint(input);
}

export function checkMergeReady(mergePointId: string): CheckMergeReadyResult {
  const db = getDb();
  const runCheckMergeReady = db.transaction((currentMergePointId: string): CheckMergeReadyResult => {
    const existingMergePoint = getMergePointById(currentMergePointId);

    if (existingMergePoint === null) {
      throw new Error(`Merge point not found: ${currentMergePointId}`);
    }

    const pendingTriggerFunctionUnits = getPendingTriggerFunctionUnits(existingMergePoint);
    const ready = pendingTriggerFunctionUnits.length === 0;
    let mergePoint = existingMergePoint;

    if (ready && existingMergePoint.status === MERGE_POINT_STATUSES.WAITING) {
      mergePoint = updateMergePointStatus(currentMergePointId, MERGE_POINT_STATUSES.READY);
    }

    return {
      merge_point: mergePoint,
      ready,
      pending_trigger_fus: pendingTriggerFunctionUnits,
    };
  });

  return runCheckMergeReady(mergePointId);
}

export function createMergePointBlockCheck(featureId: string): AdditionalBlockCheck {
  const mergePoints = listMergePoints(featureId);
  const blockedFunctionUnits = new Set<string>();

  for (const mergePoint of mergePoints) {
    if (
      mergePoint.status === MERGE_POINT_STATUSES.WAITING ||
      mergePoint.status === MERGE_POINT_STATUSES.FAILED
    ) {
      blockedFunctionUnits.add(mergePoint.merged_fu);
    }
  }

  return (fuId: string): boolean => {
    return blockedFunctionUnits.has(fuId);
  };
}

export function getBlockingMergePointForFunctionUnit(featureId: string, fuId: string): MergePoint | null {
  const mergePoints = listMergePoints(featureId);

  for (const mergePoint of mergePoints) {
    if (
      mergePoint.merged_fu === fuId &&
      (mergePoint.status === MERGE_POINT_STATUSES.WAITING ||
        mergePoint.status === MERGE_POINT_STATUSES.FAILED)
    ) {
      return mergePoint;
    }
  }

  return null;
}

export function syncMergePointOutcomeForMergedFunctionUnit(
  mergedFuId: string,
  outcomeStatus: typeof FUNCTION_UNIT_STATUSES.PASSED | typeof FUNCTION_UNIT_STATUSES.FAILED
): Array<MergePoint> {
  const db = getDb();
  const nextMergePointStatus =
    outcomeStatus === FUNCTION_UNIT_STATUSES.PASSED
      ? MERGE_POINT_STATUSES.PASSED
      : MERGE_POINT_STATUSES.FAILED;
  const runSync = db.transaction((currentMergedFuId: string): Array<MergePoint> => {
    const rows = db.prepare(
      `
        SELECT id, feature_id, trigger_fus, merged_fu, status
        FROM merge_points
        WHERE merged_fu = ?
        ORDER BY id ASC
      `
    ).all(currentMergedFuId);
    const mergePoints: Array<MergePoint> = [];

    for (const row of rows) {
      if (!isMergePointRow(row)) {
        throw new TypeError('Invalid merge point row returned from database.');
      }

      const mergePoint = mapMergePointRow(row);

      if (
        mergePoint.status === MERGE_POINT_STATUSES.READY ||
        mergePoint.status === MERGE_POINT_STATUSES.PASSED ||
        mergePoint.status === MERGE_POINT_STATUSES.FAILED
      ) {
        mergePoints.push(updateMergePointStatus(mergePoint.id, nextMergePointStatus));
      }
    }

    return mergePoints;
  });

  return runSync(mergedFuId);
}

export function resetMergePointsForMergedFunctionUnits(mergedFuIds: Array<string>): number {
  if (mergedFuIds.length === 0) {
    return 0;
  }

  const db = getDb();
  const placeholders = mergedFuIds.map(() => '?').join(', ');
  const result = db.prepare(
    `
      UPDATE merge_points
      SET status = ?
      WHERE merged_fu IN (${placeholders})
        AND status IN (?, ?, ?)
    `
  ).run(
    MERGE_POINT_STATUSES.WAITING,
    ...mergedFuIds,
    MERGE_POINT_STATUSES.READY,
    MERGE_POINT_STATUSES.PASSED,
    MERGE_POINT_STATUSES.FAILED
  );

  const rows = db.prepare(
    `
      SELECT id, feature_id, trigger_fus, merged_fu, status
      FROM merge_points
      WHERE merged_fu IN (${placeholders})
      ORDER BY id ASC
    `
  ).all(...mergedFuIds);

  for (const row of rows) {
    if (!isMergePointRow(row)) {
      throw new TypeError('Invalid merge point row returned from database.');
    }

    checkMergeReady(row.id);
  }

  return result.changes;
}
