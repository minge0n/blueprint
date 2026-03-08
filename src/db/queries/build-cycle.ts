import { randomUUID } from 'node:crypto';

import { getDb } from '../index.js';
import {
  BUILD_CYCLE_STATUSES,
  SESSION_LOG_END_REASONS,
  type BuildCycle,
  type BuildCycleStatus,
  type Checkpoint,
  type SessionLog,
  type SessionLogEndReason,
} from '../../entities/build-cycle.js';
import { STATUS_AUDIT_LOG_ENTITY_TYPES } from '../../entities/status-audit-log.js';
import { FEATURE_STATUSES, type FeatureStatus } from '../../entities/types.js';
import { logStatusChange } from './status-audit-log.js';

export interface StartBuildInput {
  readonly feature_id: string;
  readonly agent_id: string;
}

export interface EnsureBuildSessionLogInput {
  readonly build_cycle_id: string;
  readonly agent_id: string;
}

export interface UpdateBuildCycleStatusInput {
  readonly build_cycle_id: string;
  readonly status: BuildCycleStatus;
  readonly changed_by?: string;
  readonly context?: string;
}

export interface StartBuildResult {
  readonly build_cycle: BuildCycle;
  readonly session_log: SessionLog;
}

interface FeatureStatusRow {
  readonly id: string;
  readonly status: string;
}

interface BuildCycleRow {
  readonly id: string;
  readonly feature_id: string;
  readonly iteration: number | bigint;
  readonly agent_id: string;
  readonly status: string;
}

interface SessionLogRow {
  readonly id: string;
  readonly build_cycle_id: string;
  readonly agent_id: string;
  readonly session_id: string;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly end_reason: string | null;
}

interface CheckpointRow {
  readonly id: string;
  readonly build_cycle_id: string;
  readonly agent_id: string;
  readonly completed_fus: string;
  readonly next_fu: string | null;
  readonly notes: string | null;
}

interface MaxIterationRow {
  readonly max_iteration: number | bigint | null;
}

export interface CloseBuildSessionLogInput {
  readonly build_cycle_id: string;
  readonly agent_id: string;
  readonly end_reason: SessionLogEndReason;
}

const trackedSessionIds = new Set<string>();

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

function isSessionLogEndReason(value: string): value is SessionLogEndReason {
  switch (value) {
    case SESSION_LOG_END_REASONS.COMPACT:
    case SESSION_LOG_END_REASONS.DONE:
    case SESSION_LOG_END_REASONS.ERROR:
      return true;
    default:
      return false;
  }
}

function normalizeInteger(value: number | bigint): number {
  if (typeof value === 'bigint') {
    return Number(value);
  }

  return value;
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

function isSessionLogRow(value: unknown): value is SessionLogRow {
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

  if (typeof value.session_id !== 'string') {
    return false;
  }

  if (typeof value.started_at !== 'string') {
    return false;
  }

  if (value.ended_at !== null && typeof value.ended_at !== 'string') {
    return false;
  }

  if (value.end_reason !== null && typeof value.end_reason !== 'string') {
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

function isMaxIterationRow(value: unknown): value is MaxIterationRow {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.max_iteration !== null &&
    typeof value.max_iteration !== 'number' &&
    typeof value.max_iteration !== 'bigint'
  ) {
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

function mapSessionLogRow(row: SessionLogRow): SessionLog {
  if (row.end_reason !== null && !isSessionLogEndReason(row.end_reason)) {
    throw new TypeError(`Invalid session log end reason returned from database: ${row.end_reason}`);
  }

  return {
    id: row.id,
    build_cycle_id: row.build_cycle_id,
    agent_id: row.agent_id,
    session_id: row.session_id,
    started_at: row.started_at,
    ended_at: row.ended_at,
    end_reason: row.end_reason,
  };
}

function parseCompletedFunctionUnits(value: string): Array<string> {
  const parsedValue = JSON.parse(value);

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

function getFeatureStatusRow(featureId: string): FeatureStatusRow | null {
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

  if (row === undefined) {
    return null;
  }

  if (!isFeatureStatusRow(row)) {
    throw new TypeError('Invalid feature status row returned from database.');
  }

  return row;
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

function getOpenSessionLogRow(buildCycleId: string, agentId: string): SessionLogRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT
          id,
          build_cycle_id,
          agent_id,
          session_id,
          started_at,
          ended_at,
          end_reason
        FROM session_logs
        WHERE build_cycle_id = ? AND agent_id = ? AND ended_at IS NULL
        ORDER BY started_at DESC, id DESC
        LIMIT 1
      `
    )
    .get(buildCycleId, agentId);

  if (row === undefined) {
    return null;
  }

  if (!isSessionLogRow(row)) {
    throw new TypeError('Invalid session log row returned from database.');
  }

  return row;
}

function getNextBuildIteration(featureId: string): number {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT MAX(iteration) AS max_iteration
        FROM build_cycles
        WHERE feature_id = ?
      `
    )
    .get(featureId);

  if (row === undefined) {
    return 1;
  }

  if (!isMaxIterationRow(row)) {
    throw new TypeError('Invalid max iteration row returned from database.');
  }

  if (row.max_iteration === null) {
    return 1;
  }

  return normalizeInteger(row.max_iteration) + 1;
}

function createBuildCycleId(featureId: string, iteration: number): string {
  return `build_cycle_${featureId}_${iteration}`;
}

function createSessionLogId(): string {
  return `session_log_${randomUUID()}`;
}

function createSessionId(): string {
  return `session_${randomUUID()}`;
}

function trackSessionLog(sessionLog: SessionLog): SessionLog {
  trackedSessionIds.add(sessionLog.session_id);

  return sessionLog;
}

function updateOpenSessionLog(sessionId: string, endReason: SessionLogEndReason, endedAt: string): number {
  const db = getDb();
  const result = db
    .prepare(
      `
        UPDATE session_logs
        SET ended_at = ?, end_reason = ?
        WHERE session_id = ? AND ended_at IS NULL
      `
    )
    .run(endedAt, endReason, sessionId);

  return result.changes;
}

export function getBuildCycleById(buildCycleId: string): BuildCycle | null {
  const row = getBuildCycleRowById(buildCycleId);

  if (row === null) {
    return null;
  }

  return mapBuildCycleRow(row);
}

export function getActiveBuildCycleForFeature(featureId: string): BuildCycle | null {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT id, feature_id, iteration, agent_id, status
        FROM build_cycles
        WHERE feature_id = ? AND status IN (?, ?)
        ORDER BY iteration DESC
        LIMIT 1
      `
    )
    .get(featureId, BUILD_CYCLE_STATUSES.BUILDING, BUILD_CYCLE_STATUSES.REVIEWING);

  if (row === undefined) {
    return null;
  }

  if (!isBuildCycleRow(row)) {
    throw new TypeError('Invalid active build cycle row returned from database.');
  }

  return mapBuildCycleRow(row);
}

export function getOpenSessionLog(buildCycleId: string, agentId: string): SessionLog | null {
  const row = getOpenSessionLogRow(buildCycleId, agentId);

  if (row === null) {
    return null;
  }

  return trackSessionLog(mapSessionLogRow(row));
}

export function getCheckpoint(buildCycleId: string, agentId: string): Checkpoint | null {
  const db = getDb();
  const row = db
    .prepare(
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
    )
    .get(buildCycleId, agentId);

  if (row === undefined) {
    return null;
  }

  if (!isCheckpointRow(row)) {
    throw new TypeError('Invalid checkpoint row returned from database.');
  }

  return mapCheckpointRow(row);
}

export function ensureBuildSessionLog(input: EnsureBuildSessionLogInput): SessionLog {
  const db = getDb();
  const ensureSessionLog = db.transaction(
    (currentInput: EnsureBuildSessionLogInput): SessionLog => {
      const existingSessionLogRow = getOpenSessionLogRow(
        currentInput.build_cycle_id,
        currentInput.agent_id
      );

      if (existingSessionLogRow !== null) {
        return trackSessionLog(mapSessionLogRow(existingSessionLogRow));
      }

      const sessionLogId = createSessionLogId();
      const sessionId = createSessionId();
      const startedAt = new Date().toISOString();

      db.prepare(
        `
          INSERT INTO session_logs (
            id,
            build_cycle_id,
            agent_id,
            session_id,
            started_at,
            ended_at,
            end_reason
          )
          VALUES (?, ?, ?, ?, ?, NULL, NULL)
        `
      ).run(
        sessionLogId,
        currentInput.build_cycle_id,
        currentInput.agent_id,
        sessionId,
        startedAt
      );

      const sessionLogRow = getOpenSessionLogRow(currentInput.build_cycle_id, currentInput.agent_id);

      if (sessionLogRow === null) {
        throw new Error('Created session log could not be loaded.');
      }

      return trackSessionLog(mapSessionLogRow(sessionLogRow));
    }
  );

  return ensureSessionLog(input);
}

export function closeOpenBuildSessionLog(input: CloseBuildSessionLogInput): SessionLog | null {
  const db = getDb();
  const closeSessionLog = db.transaction(
    (currentInput: CloseBuildSessionLogInput): SessionLog | null => {
      const openSessionLogRow = getOpenSessionLogRow(currentInput.build_cycle_id, currentInput.agent_id);

      if (openSessionLogRow === null) {
        return null;
      }

      const endedAt = new Date().toISOString();
      const updatedCount = updateOpenSessionLog(
        openSessionLogRow.session_id,
        currentInput.end_reason,
        endedAt
      );

      if (updatedCount === 0) {
        return null;
      }

      trackedSessionIds.delete(openSessionLogRow.session_id);

      return {
        id: openSessionLogRow.id,
        build_cycle_id: openSessionLogRow.build_cycle_id,
        agent_id: openSessionLogRow.agent_id,
        session_id: openSessionLogRow.session_id,
        started_at: openSessionLogRow.started_at,
        ended_at: endedAt,
        end_reason: currentInput.end_reason,
      };
    }
  );

  return closeSessionLog(input);
}

export function closeTrackedBuildSessions(endReason: SessionLogEndReason): number {
  const db = getDb();
  const trackedIds = Array.from(trackedSessionIds);

  if (trackedIds.length === 0) {
    return 0;
  }

  const endedAt = new Date().toISOString();
  const closeSessions = db.transaction((sessionIds: Array<string>): number => {
    let closedCount = 0;

    for (const sessionId of sessionIds) {
      closedCount += updateOpenSessionLog(sessionId, endReason, endedAt);
    }

    return closedCount;
  });
  const closedCount = closeSessions(trackedIds);

  for (const sessionId of trackedIds) {
    trackedSessionIds.delete(sessionId);
  }

  return closedCount;
}

export function updateBuildCycleStatus(input: UpdateBuildCycleStatusInput): BuildCycle {
  const db = getDb();
  const updateStatus = db.transaction((currentInput: UpdateBuildCycleStatusInput): BuildCycle => {
    const existingBuildCycleRow = getBuildCycleRowById(currentInput.build_cycle_id);

    if (existingBuildCycleRow === null) {
      throw new Error(`Build cycle not found: ${currentInput.build_cycle_id}`);
    }

    const buildCycle = mapBuildCycleRow(existingBuildCycleRow);

    if (buildCycle.status === currentInput.status) {
      return buildCycle;
    }

    db.prepare(
      `
        UPDATE build_cycles
        SET status = ?
        WHERE id = ?
      `
    ).run(currentInput.status, currentInput.build_cycle_id);

    logStatusChange({
      entity_type: STATUS_AUDIT_LOG_ENTITY_TYPES.BUILD_CYCLE,
      entity_id: currentInput.build_cycle_id,
      old_status: buildCycle.status,
      new_status: currentInput.status,
      changed_by: currentInput.changed_by,
      context: currentInput.context,
    });

    const updatedBuildCycleRow = getBuildCycleRowById(currentInput.build_cycle_id);

    if (updatedBuildCycleRow === null) {
      throw new Error(`Updated build cycle could not be loaded: ${currentInput.build_cycle_id}`);
    }

    return mapBuildCycleRow(updatedBuildCycleRow);
  });

  return updateStatus(input);
}

export function startBuild(input: StartBuildInput): StartBuildResult {
  const db = getDb();
  const startBuildTransaction = db.transaction((currentInput: StartBuildInput): StartBuildResult => {
    const featureRow = getFeatureStatusRow(currentInput.feature_id);

    if (featureRow === null) {
      throw new Error(`Feature not found: ${currentInput.feature_id}`);
    }

    if (!isFeatureStatus(featureRow.status)) {
      throw new TypeError(`Invalid feature status returned from database: ${featureRow.status}`);
    }

    if (featureRow.status !== FEATURE_STATUSES.BUILDING) {
      throw new Error(`Feature must be in 'building' status. Current: ${featureRow.status}`);
    }

    const activeBuildCycle = getActiveBuildCycleForFeature(currentInput.feature_id);

    if (activeBuildCycle !== null) {
      throw new Error(
        `Feature already has an active build cycle: ${activeBuildCycle.id}`
      );
    }

    const iteration = getNextBuildIteration(currentInput.feature_id);
    const buildCycleId = createBuildCycleId(currentInput.feature_id, iteration);

    db.prepare(
      `
        INSERT INTO build_cycles (
          id,
          feature_id,
          iteration,
          agent_id,
          status
        )
        VALUES (?, ?, ?, ?, ?)
      `
    ).run(
      buildCycleId,
      currentInput.feature_id,
      iteration,
      currentInput.agent_id,
      BUILD_CYCLE_STATUSES.BUILDING
    );

    logStatusChange({
      entity_type: STATUS_AUDIT_LOG_ENTITY_TYPES.BUILD_CYCLE,
      entity_id: buildCycleId,
      old_status: null,
      new_status: BUILD_CYCLE_STATUSES.BUILDING,
      changed_by: currentInput.agent_id,
      context: JSON.stringify({
        feature_id: currentInput.feature_id,
        iteration,
        event: 'blueprint_start_build',
      }),
    });

    const buildCycle = getBuildCycleById(buildCycleId);

    if (buildCycle === null) {
      throw new Error(`Created build cycle could not be loaded: ${buildCycleId}`);
    }

    const sessionLog = ensureBuildSessionLog({
      build_cycle_id: buildCycleId,
      agent_id: currentInput.agent_id,
    });

    return {
      build_cycle: buildCycle,
      session_log: sessionLog,
    };
  });

  return startBuildTransaction(input);
}
