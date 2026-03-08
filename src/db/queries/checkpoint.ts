import { randomUUID } from 'node:crypto';

import { getDb } from '../index.js';
import { getActiveBuildCycleForFeature, getBuildCycleById } from './build-cycle.js';
import { syncMergePointOutcomeForMergedFunctionUnit } from './merge-point.js';
import { logStatusChange } from './status-audit-log.js';
import {
  STATUS_AUDIT_LOG_ENTITY_TYPES,
} from '../../entities/status-audit-log.js';
import type { Checkpoint } from '../../entities/build-cycle.js';
import {
  FUNCTION_UNIT_STATUSES,
  type FunctionUnitStatus,
} from '../../entities/types.js';
import { WORK_LOCK_STATUSES } from '../../entities/work-lock.js';
import type { FunctionUnit } from '../../entities/function-unit.js';

export interface BlueprintCheckpointInput {
  readonly build_cycle_id: string;
  readonly agent_id: string;
  readonly completed_fu?: string;
  readonly next_fu?: string;
  readonly notes?: string;
}

export interface BlueprintCompleteFuInput {
  readonly build_cycle_id: string;
  readonly fu_id: string;
  readonly agent_id: string;
  readonly evidence: string;
}

export interface BlueprintFailFuInput {
  readonly fu_id: string;
  readonly reason: string;
}

interface CheckpointRow {
  readonly id: string;
  readonly build_cycle_id: string;
  readonly agent_id: string;
  readonly completed_fus: string;
  readonly next_fu: string | null;
  readonly notes: string | null;
}

interface FunctionUnitRow {
  readonly id: string;
  readonly feature_id: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly assigned_agent: string | null;
  readonly test_evidence: string | null;
  readonly failure_reason: string | null;
}

interface WorkLockRow {
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

function isCheckpointRow(value: unknown): value is CheckpointRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string') {
    return false;
  }

  if (typeof value.build_cycle_id !== 'string') {
    return false;
  }

  if (typeof value.agent_id !== 'string') {
    return false;
  }

  if (typeof value.completed_fus !== 'string') {
    return false;
  }

  if (value.next_fu !== null && typeof value.next_fu !== 'string') {
    return false;
  }

  if (value.notes !== null && typeof value.notes !== 'string') {
    return false;
  }

  return true;
}

function isFunctionUnitRow(value: unknown): value is FunctionUnitRow {
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

  if (typeof value.status !== 'string') {
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

function isWorkLockRow(value: unknown): value is WorkLockRow {
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

function normalizeOptionalString(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  return value;
}

function normalizeInteger(value: number | bigint): number {
  if (typeof value === 'bigint') {
    return Number(value);
  }

  return value;
}

function parseCompletedFunctionUnits(value: string): Array<string> {
  const parsedValue: unknown = JSON.parse(value);

  if (!Array.isArray(parsedValue)) {
    throw new TypeError('Invalid checkpoint completed_fus returned from database.');
  }

  const completedFunctionUnits: Array<string> = [];

  for (const entry of parsedValue) {
    if (typeof entry !== 'string') {
      throw new TypeError('Invalid checkpoint completed_fus entry returned from database.');
    }

    completedFunctionUnits.push(entry);
  }

  return completedFunctionUnits;
}

function mapCheckpointRow(row: CheckpointRow): Checkpoint {
  return {
    id: row.id,
    build_cycle_id: row.build_cycle_id,
    agent_id: row.agent_id,
    completed_fus: parseCompletedFunctionUnits(row.completed_fus),
    next_fu: row.next_fu,
    notes: row.notes,
  };
}

function mapFunctionUnitRow(row: FunctionUnitRow): FunctionUnit {
  if (!isFunctionUnitStatus(row.status)) {
    throw new TypeError(`Invalid function unit status returned from database: ${row.status}`);
  }

  return {
    id: row.id,
    feature_id: row.feature_id,
    title: row.title,
    description: row.description,
    acceptance_criteria: [],
    depends_on: [],
    status: row.status,
    assigned_agent: row.assigned_agent,
    test_evidence: row.test_evidence,
    failure_reason: row.failure_reason,
  };
}

function getCheckpointRow(buildCycleId: string, agentId: string): CheckpointRow | null {
  const db = getDb();
  const row = db.prepare(
    `
      SELECT
        id,
        build_cycle_id,
        agent_id,
        completed_fus,
        next_fu,
        notes
      FROM checkpoints
      WHERE build_cycle_id = ? AND agent_id = ?
    `
  ).get(buildCycleId, agentId);

  if (row === undefined) {
    return null;
  }

  if (!isCheckpointRow(row)) {
    throw new TypeError('Invalid checkpoint row returned from database.');
  }

  return row;
}

function getFunctionUnitRowById(fuId: string): FunctionUnitRow {
  const db = getDb();
  const row = db.prepare(
    `
      SELECT
        id,
        feature_id,
        title,
        description,
        status,
        assigned_agent,
        test_evidence,
        failure_reason
      FROM function_units
      WHERE id = ?
    `
  ).get(fuId);

  if (!isFunctionUnitRow(row)) {
    throw new Error(`Function unit not found: ${fuId}`);
  }

  return row;
}

function getActiveWorkLockRowForFunctionUnit(fuId: string): WorkLockRow | null {
  const db = getDb();
  const row = db.prepare(
    `
      SELECT
        id,
        fu_id,
        agent_id,
        acquired_at,
        heartbeat_at,
        released_at,
        release_reason,
        ttl_seconds,
        status
      FROM work_locks
      WHERE fu_id = ? AND status = ?
      ORDER BY acquired_at DESC, id DESC
      LIMIT 1
    `
  ).get(fuId, WORK_LOCK_STATUSES.ACTIVE);

  if (row === undefined) {
    return null;
  }

  if (!isWorkLockRow(row)) {
    throw new TypeError('Invalid work lock row returned from database.');
  }

  return row;
}

function createCheckpointId(): string {
  return `checkpoint_${randomUUID()}`;
}

function accumulateCompletedFunctionUnits(
  existingCompletedFus: Array<string>,
  completedFu: string | undefined
): Array<string> {
  const dedupedCompletedFus = new Set<string>();

  for (const existingCompletedFu of existingCompletedFus) {
    dedupedCompletedFus.add(existingCompletedFu);
  }

  if (completedFu !== undefined) {
    dedupedCompletedFus.add(completedFu);
  }

  return Array.from(dedupedCompletedFus);
}

function requireCheckpointBuildCycle(buildCycleId: string): void {
  const buildCycle = getBuildCycleById(buildCycleId);

  if (buildCycle === null) {
    throw new Error(`Build cycle not found: ${buildCycleId}`);
  }
}

function validateEvidence(evidence: string): string {
  if (evidence.trim().length === 0) {
    throw new Error('evidence is required');
  }

  return evidence;
}

function validateFailureReason(reason: string): string {
  if (reason.trim().length === 0) {
    throw new Error('reason is required');
  }

  return reason;
}

function requireCompleteableFunctionUnitStatus(status: FunctionUnitStatus, fuId: string): void {
  if (status === FUNCTION_UNIT_STATUSES.PENDING || status === FUNCTION_UNIT_STATUSES.IN_PROGRESS) {
    return;
  }

  throw new Error(
    `Function unit ${fuId} must be pending or in_progress to complete. Current: ${status}`
  );
}

function requireFailurableFunctionUnitStatus(status: FunctionUnitStatus, fuId: string): void {
  if (status === FUNCTION_UNIT_STATUSES.IN_PROGRESS || status === FUNCTION_UNIT_STATUSES.PASSED) {
    return;
  }

  throw new Error(
    `Function unit ${fuId} must be in_progress or passed to fail. Current: ${status}`
  );
}

function requireMatchingActiveBuildCycle(buildCycleId: string, functionUnit: FunctionUnitRow): void {
  const buildCycle = getBuildCycleById(buildCycleId);

  if (buildCycle === null) {
    throw new Error(`Build cycle not found: ${buildCycleId}`);
  }

  if (buildCycle.feature_id !== functionUnit.feature_id) {
    throw new Error(
      `Function unit ${functionUnit.id} does not belong to build cycle ${buildCycleId}`
    );
  }

  const activeBuildCycle = getActiveBuildCycleForFeature(functionUnit.feature_id);

  if (activeBuildCycle === null) {
    throw new Error(`Feature ${functionUnit.feature_id} does not have an active build cycle`);
  }

  if (activeBuildCycle.id !== buildCycleId) {
    throw new Error(
      `Build cycle ${buildCycleId} is not the current active build cycle for feature ${functionUnit.feature_id}`
    );
  }
}

function requireWorkLockOwnership(fuId: string, agentId: string): void {
  const activeWorkLock = getActiveWorkLockRowForFunctionUnit(fuId);

  if (activeWorkLock === null) {
    return;
  }

  if (activeWorkLock.agent_id !== agentId) {
    throw new Error(
      `Function unit ${fuId} is locked by agent ${activeWorkLock.agent_id}; agent ${agentId} cannot complete it`
    );
  }
}

export function getCheckpoint(buildCycleId: string, agentId: string): Checkpoint | null {
  const checkpointRow = getCheckpointRow(buildCycleId, agentId);

  if (checkpointRow === null) {
    return null;
  }

  return mapCheckpointRow(checkpointRow);
}

export function blueprintCheckpoint(input: BlueprintCheckpointInput): Checkpoint {
  requireCheckpointBuildCycle(input.build_cycle_id);

  const db = getDb();
  const runCheckpoint = db.transaction((currentInput: BlueprintCheckpointInput): Checkpoint => {
    const existingCheckpoint = getCheckpoint(currentInput.build_cycle_id, currentInput.agent_id);
    const checkpointId = existingCheckpoint === null ? createCheckpointId() : existingCheckpoint.id;
    const completedFus = accumulateCompletedFunctionUnits(
      existingCheckpoint === null ? [] : existingCheckpoint.completed_fus,
      currentInput.completed_fu
    );
    const nextFu = normalizeOptionalString(currentInput.next_fu);
    const notes = normalizeOptionalString(currentInput.notes);
    const completedFusJson = JSON.stringify(completedFus);

    db.prepare(
      `
        INSERT INTO checkpoints (
          id,
          build_cycle_id,
          agent_id,
          completed_fus,
          next_fu,
          notes
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(build_cycle_id, agent_id)
        DO UPDATE SET
          completed_fus = excluded.completed_fus,
          next_fu = excluded.next_fu,
          notes = excluded.notes
      `
    ).run(
      checkpointId,
      currentInput.build_cycle_id,
      currentInput.agent_id,
      completedFusJson,
      nextFu,
      notes
    );

    const updatedCheckpoint = getCheckpoint(currentInput.build_cycle_id, currentInput.agent_id);

    if (updatedCheckpoint === null) {
      throw new Error('Checkpoint could not be loaded after upsert.');
    }

    return updatedCheckpoint;
  });

  return runCheckpoint(input);
}

export function blueprintCompleteFu(input: BlueprintCompleteFuInput): FunctionUnit {
  const evidence = validateEvidence(input.evidence);
  const db = getDb();
  const runCompleteFu = db.transaction((currentInput: BlueprintCompleteFuInput): FunctionUnit => {
    const existingFunctionUnitRow = getFunctionUnitRowById(currentInput.fu_id);

    if (!isFunctionUnitStatus(existingFunctionUnitRow.status)) {
      throw new TypeError(
        `Invalid function unit status returned from database: ${existingFunctionUnitRow.status}`
      );
    }

    requireMatchingActiveBuildCycle(currentInput.build_cycle_id, existingFunctionUnitRow);
    requireWorkLockOwnership(currentInput.fu_id, currentInput.agent_id);
    requireCompleteableFunctionUnitStatus(existingFunctionUnitRow.status, currentInput.fu_id);

    db.prepare(
      `
        UPDATE function_units
        SET status = ?,
            test_evidence = ?,
            failure_reason = NULL
        WHERE id = ?
      `
    ).run(FUNCTION_UNIT_STATUSES.PASSED, evidence, currentInput.fu_id);

    if (existingFunctionUnitRow.status !== FUNCTION_UNIT_STATUSES.PASSED) {
      logStatusChange({
        entity_type: STATUS_AUDIT_LOG_ENTITY_TYPES.FUNCTION_UNIT,
        entity_id: currentInput.fu_id,
        old_status: existingFunctionUnitRow.status,
        new_status: FUNCTION_UNIT_STATUSES.PASSED,
        changed_by: currentInput.agent_id,
        context: JSON.stringify({
          build_cycle_id: currentInput.build_cycle_id,
          evidence,
          event: 'blueprint_complete_fu',
        }),
      });
    }

    const updatedFunctionUnitRow = getFunctionUnitRowById(currentInput.fu_id);

    syncMergePointOutcomeForMergedFunctionUnit(currentInput.fu_id, FUNCTION_UNIT_STATUSES.PASSED);

    return mapFunctionUnitRow(updatedFunctionUnitRow);
  });

  return runCompleteFu(input);
}

export function blueprintFailFu(input: BlueprintFailFuInput): FunctionUnit {
  const reason = validateFailureReason(input.reason);
  const db = getDb();
  const runFailFu = db.transaction((currentInput: BlueprintFailFuInput): FunctionUnit => {
    const existingFunctionUnitRow = getFunctionUnitRowById(currentInput.fu_id);

    if (!isFunctionUnitStatus(existingFunctionUnitRow.status)) {
      throw new TypeError(
        `Invalid function unit status returned from database: ${existingFunctionUnitRow.status}`
      );
    }

    requireFailurableFunctionUnitStatus(existingFunctionUnitRow.status, currentInput.fu_id);

    db.prepare(
      `
        UPDATE function_units
        SET status = ?,
            failure_reason = ?
        WHERE id = ?
      `
    ).run(FUNCTION_UNIT_STATUSES.FAILED, reason, currentInput.fu_id);

    logStatusChange({
      entity_type: STATUS_AUDIT_LOG_ENTITY_TYPES.FUNCTION_UNIT,
      entity_id: currentInput.fu_id,
      old_status: existingFunctionUnitRow.status,
      new_status: FUNCTION_UNIT_STATUSES.FAILED,
      context: JSON.stringify({
        reason,
        event: 'blueprint_fail_fu',
      }),
    });

    const updatedFunctionUnitRow = getFunctionUnitRowById(currentInput.fu_id);

    syncMergePointOutcomeForMergedFunctionUnit(currentInput.fu_id, FUNCTION_UNIT_STATUSES.FAILED);

    return mapFunctionUnitRow(updatedFunctionUnitRow);
  });

  return runFailFu(input);
}
