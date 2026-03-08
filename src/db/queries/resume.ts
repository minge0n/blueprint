import type { BuildCycle, Checkpoint, SessionLog } from '../../entities/build-cycle.js';
import {
  BUILD_CYCLE_STATUSES,
  SESSION_LOG_END_REASONS,
} from '../../entities/build-cycle.js';
import type { Feature } from '../../entities/feature.js';
import type { FunctionUnit } from '../../entities/function-unit.js';
import type { Issue } from '../../entities/issue.js';
import { ISSUE_STATUSES } from '../../entities/issue.js';
import type { PlanCycle } from '../../entities/plan-cycle.js';
import {
  isPlanCycleStatus,
  parsePlanCycleSnapshot,
  PLAN_CYCLE_STATUSES,
} from '../../entities/plan-cycle.js';
import {
  FEATURE_PRIORITIES,
  FEATURE_STATUSES,
  FUNCTION_UNIT_STATUSES,
  type FeaturePriority,
  type FeatureStatus,
  type FunctionUnitStatus,
} from '../../entities/types.js';
import type { WorkLock } from '../../entities/work-lock.js';
import { WORK_LOCK_STATUSES } from '../../entities/work-lock.js';
import { ensureBuildSessionLog, getActiveBuildCycleForFeature, getCheckpoint } from './build-cycle.js';
import { expireStaleWorkLocks } from './lock.js';
import { getFeatureById } from './feature.js';
import { listIssues } from './issue.js';
import { getDb } from '../index.js';

export interface BlueprintResumeInput {
  readonly agent_id?: string;
}

export interface ResumeCurrentCycleBuild {
  readonly cycle_type: 'build';
  readonly cycle: BuildCycle;
  readonly session_log: SessionLog | null;
}

export interface ResumeCurrentCyclePlan {
  readonly cycle_type: 'plan';
  readonly cycle: PlanCycle;
}

export type ResumeCurrentCycle = ResumeCurrentCycleBuild | ResumeCurrentCyclePlan;

export interface ResumeCurrentLock {
  readonly lock_id: string;
  readonly fu_id: string;
  readonly agent_id: string;
  readonly acquired_at: string;
  readonly heartbeat_at: string;
  readonly released_at: string | null;
  readonly release_reason: string | null;
  readonly ttl_seconds: number;
  readonly status: WorkLock['status'];
  readonly function_unit: FunctionUnit;
}

export interface ResumeNextFunctionUnit {
  readonly id: string;
  readonly title: string;
  readonly status: FunctionUnit['status'];
  readonly assigned_agent: string | null;
}

export interface ResumeParallelAgentStatus {
  readonly agent_id: string;
  readonly session_log: SessionLog | null;
  readonly checkpoint: Checkpoint | null;
  readonly active_locks: Array<ResumeCurrentLock>;
  readonly next_fu: string | null;
}

export interface BlueprintResumeResult {
  readonly active_feature: Feature | null;
  readonly current_cycle?: ResumeCurrentCycle | null;
  readonly checkpoint?: Checkpoint | null;
  readonly current_lock?: ResumeCurrentLock | null;
  readonly open_issues?: Array<Issue>;
  readonly next_fu?: ResumeNextFunctionUnit | null;
  readonly parallel_agent_status?: Array<ResumeParallelAgentStatus>;
  readonly session_warnings?: Array<string>;
}

interface FeatureRow {
  readonly id: string;
}

interface PlanCycleRow {
  readonly id: string;
  readonly feature_id: string;
  readonly iteration: number | bigint;
  readonly plan_snapshot: string;
  readonly status: string;
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

function isFeatureRow(value: unknown): value is FeatureRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string') {
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

  if (typeof value.iteration !== 'number' && typeof value.iteration !== 'bigint') {
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

function mapPlanCycleRow(row: PlanCycleRow): PlanCycle {
  if (!isPlanCycleStatus(row.status)) {
    throw new TypeError(`Invalid plan cycle status returned from database: ${row.status}`);
  }

  return {
    id: row.id,
    feature_id: row.feature_id,
    iteration: normalizeInteger(row.iteration),
    plan_snapshot: parsePlanCycleSnapshot(row.plan_snapshot),
    status: row.status,
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

function mapSessionLogRow(row: SessionLogRow): SessionLog {
  if (
    row.end_reason !== null &&
    row.end_reason !== SESSION_LOG_END_REASONS.COMPACT &&
    row.end_reason !== SESSION_LOG_END_REASONS.DONE &&
    row.end_reason !== SESSION_LOG_END_REASONS.ERROR
  ) {
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

function mapWorkLockRow(row: WorkLockRow, functionUnit: FunctionUnit): ResumeCurrentLock {
  if (
    row.status !== WORK_LOCK_STATUSES.ACTIVE &&
    row.status !== WORK_LOCK_STATUSES.RELEASED &&
    row.status !== WORK_LOCK_STATUSES.EXPIRED
  ) {
    throw new TypeError(`Invalid work lock status returned from database: ${row.status}`);
  }

  return {
    lock_id: row.id,
    fu_id: row.fu_id,
    agent_id: row.agent_id,
    acquired_at: row.acquired_at,
    heartbeat_at: row.heartbeat_at,
    released_at: row.released_at,
    release_reason: row.release_reason,
    ttl_seconds: normalizeInteger(row.ttl_seconds),
    status: row.status,
    function_unit: functionUnit,
  };
}

function getActiveFeatureId(): string | null {
  const db = getDb();
  const activeBuildFeatureRow = db
    .prepare(
      `
        SELECT features.id
        FROM features
        INNER JOIN build_cycles ON build_cycles.feature_id = features.id
        WHERE build_cycles.status IN (?, ?)
        ORDER BY build_cycles.iteration DESC, features.id DESC
        LIMIT 1
      `
    )
    .get(BUILD_CYCLE_STATUSES.BUILDING, BUILD_CYCLE_STATUSES.REVIEWING);

  if (activeBuildFeatureRow !== undefined) {
    if (!isFeatureRow(activeBuildFeatureRow)) {
      throw new TypeError('Invalid active build feature row returned from database.');
    }

    return activeBuildFeatureRow.id;
  }

  const activePlanFeatureRow = db
    .prepare(
      `
        SELECT features.id
        FROM features
        INNER JOIN plan_cycles ON plan_cycles.feature_id = features.id
        WHERE plan_cycles.status IN (?, ?)
        ORDER BY plan_cycles.iteration DESC, features.id DESC
        LIMIT 1
      `
    )
    .get(PLAN_CYCLE_STATUSES.DRAFTING, PLAN_CYCLE_STATUSES.REVIEWING);

  if (activePlanFeatureRow !== undefined) {
    if (!isFeatureRow(activePlanFeatureRow)) {
      throw new TypeError('Invalid active plan feature row returned from database.');
    }

    return activePlanFeatureRow.id;
  }

  const fallbackFeatureRow = db
    .prepare(
      `
        SELECT id
        FROM features
        WHERE status IN (?, ?, ?, ?)
        ORDER BY
          CASE status
            WHEN 'build_review' THEN 0
            WHEN 'building' THEN 1
            WHEN 'plan_review' THEN 2
            WHEN 'draft' THEN 3
            ELSE 4
          END ASC,
          id DESC
        LIMIT 1
      `
    )
    .get(
      FEATURE_STATUSES.DRAFT,
      FEATURE_STATUSES.PLAN_REVIEW,
      FEATURE_STATUSES.BUILDING,
      FEATURE_STATUSES.BUILD_REVIEW,
    );

  if (fallbackFeatureRow === undefined) {
    return null;
  }

  if (!isFeatureRow(fallbackFeatureRow)) {
    throw new TypeError('Invalid fallback feature row returned from database.');
  }

  return fallbackFeatureRow.id;
}

function getActivePlanCycleForFeature(featureId: string): PlanCycle | null {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT id, feature_id, iteration, plan_snapshot, status
        FROM plan_cycles
        WHERE feature_id = ? AND status IN (?, ?)
        ORDER BY iteration DESC
        LIMIT 1
      `
    )
    .get(featureId, PLAN_CYCLE_STATUSES.DRAFTING, PLAN_CYCLE_STATUSES.REVIEWING);

  if (row === undefined) {
    return null;
  }

  if (!isPlanCycleRow(row)) {
    throw new TypeError('Invalid active plan cycle row returned from database.');
  }

  return mapPlanCycleRow(row);
}

function getFunctionUnitRowsForFeature(featureId: string): Array<FunctionUnitRow> {
  const db = getDb();
  const rows = db
    .prepare(
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
        WHERE feature_id = ?
        ORDER BY id ASC
      `
    )
    .all(featureId);
  const functionUnitRows: Array<FunctionUnitRow> = [];

  for (const row of rows) {
    if (!isFunctionUnitRow(row)) {
      throw new TypeError('Invalid function unit row returned from database.');
    }

    functionUnitRows.push(row);
  }

  return functionUnitRows;
}

function getActiveWorkLockRowsForFeature(featureId: string): Array<WorkLockRow> {
  const db = getDb();
  const rows = db
    .prepare(
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
        ORDER BY work_locks.acquired_at DESC, work_locks.id DESC
      `
    )
    .all(featureId, WORK_LOCK_STATUSES.ACTIVE);
  const workLockRows: Array<WorkLockRow> = [];

  for (const row of rows) {
    if (!isWorkLockRow(row)) {
      throw new TypeError('Invalid work lock row returned from database.');
    }

    workLockRows.push(row);
  }

  return workLockRows;
}

function getOpenSessionLogForAgent(buildCycleId: string, agentId: string): SessionLog | null {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT id, build_cycle_id, agent_id, session_id, started_at, ended_at, end_reason
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
    throw new TypeError('Invalid open session log row returned from database.');
  }

  return mapSessionLogRow(row);
}

function getLatestClosedSessionLogRow(buildCycleId: string, agentId: string): SessionLogRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT id, build_cycle_id, agent_id, session_id, started_at, ended_at, end_reason
        FROM session_logs
        WHERE build_cycle_id = ? AND agent_id = ? AND ended_at IS NOT NULL
        ORDER BY ended_at DESC, id DESC
        LIMIT 1
      `
    )
    .get(buildCycleId, agentId);

  if (row === undefined) {
    return null;
  }

  if (!isSessionLogRow(row)) {
    throw new TypeError('Invalid closed session log row returned from database.');
  }

  return row;
}

function getCheckpointRowForAgent(buildCycleId: string, agentId: string): Checkpoint | null {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT id, build_cycle_id, agent_id, completed_fus, next_fu, notes
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

function getAgentIdsForBuildCycle(featureId: string, buildCycleId: string): Array<string> {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT agent_id
        FROM (
          SELECT agent_id FROM build_cycles WHERE id = ?
          UNION
          SELECT agent_id FROM session_logs WHERE build_cycle_id = ?
          UNION
          SELECT agent_id FROM checkpoints WHERE build_cycle_id = ?
          UNION
          SELECT work_locks.agent_id
          FROM work_locks
          INNER JOIN function_units ON function_units.id = work_locks.fu_id
          WHERE function_units.feature_id = ? AND work_locks.status = ?
        )
        ORDER BY agent_id ASC
      `
    )
    .all(buildCycleId, buildCycleId, buildCycleId, featureId, WORK_LOCK_STATUSES.ACTIVE);
  const agentIds: Array<string> = [];

  for (const row of rows) {
    if (!isRecord(row) || typeof row.agent_id !== 'string') {
      throw new TypeError('Invalid parallel agent row returned from database.');
    }

    agentIds.push(row.agent_id);
  }

  return agentIds;
}

function buildFunctionUnitMap(functionUnitRows: Array<FunctionUnitRow>): Map<string, FunctionUnit> {
  const functionUnitMap = new Map<string, FunctionUnit>();

  for (const functionUnitRow of functionUnitRows) {
    functionUnitMap.set(functionUnitRow.id, mapFunctionUnitRow(functionUnitRow));
  }

  return functionUnitMap;
}

function buildActiveLockList(
  workLockRows: Array<WorkLockRow>,
  functionUnitMap: Map<string, FunctionUnit>,
  agentId: string,
): Array<ResumeCurrentLock> {
  const locks: Array<ResumeCurrentLock> = [];

  for (const workLockRow of workLockRows) {
    if (workLockRow.agent_id !== agentId) {
      continue;
    }

    const functionUnit = functionUnitMap.get(workLockRow.fu_id);

    if (functionUnit === undefined) {
      throw new Error(`Function unit not found for work lock ${workLockRow.id}`);
    }

    locks.push(mapWorkLockRow(workLockRow, functionUnit));
  }

  return locks;
}

function getRelevantFunctionUnitIds(
  currentLock: ResumeCurrentLock | null,
  checkpoint: Checkpoint | null,
): Array<string> {
  const functionUnitIds = new Set<string>();

  if (currentLock !== null) {
    functionUnitIds.add(currentLock.fu_id);
  }

  if (checkpoint !== null) {
    for (const completedFunctionUnitId of checkpoint.completed_fus) {
      functionUnitIds.add(completedFunctionUnitId);
    }

    if (checkpoint.next_fu !== null) {
      functionUnitIds.add(checkpoint.next_fu);
    }
  }

  return Array.from(functionUnitIds);
}

function filterIssuesForRelevantFunctionUnits(
  issues: Array<Issue>,
  relevantFunctionUnitIds: Array<string>,
): Array<Issue> {
  if (relevantFunctionUnitIds.length === 0) {
    return issues;
  }

  const allowedFunctionUnitIds = new Set<string>();

  for (const functionUnitId of relevantFunctionUnitIds) {
    allowedFunctionUnitIds.add(functionUnitId);
  }

  const filteredIssues: Array<Issue> = [];

  for (const issue of issues) {
    if (allowedFunctionUnitIds.has(issue.fu_id)) {
      filteredIssues.push(issue);
    }
  }

  return filteredIssues;
}

function getFunctionUnitById(
  functionUnitMap: Map<string, FunctionUnit>,
  functionUnitId: string,
): FunctionUnit | null {
  const functionUnit = functionUnitMap.get(functionUnitId);

  if (functionUnit === undefined) {
    return null;
  }

  return functionUnit;
}

function buildNextFunctionUnitSummary(functionUnit: FunctionUnit): ResumeNextFunctionUnit {
  return {
    id: functionUnit.id,
    title: functionUnit.title,
    status: functionUnit.status,
    assigned_agent: functionUnit.assigned_agent,
  };
}

function getFirstArrayItem<TValue>(values: Array<TValue>): TValue | null {
  for (const value of values) {
    return value;
  }

  return null;
}

function getStatusRank(status: FunctionUnitStatus): number {
  switch (status) {
    case FUNCTION_UNIT_STATUSES.IN_PROGRESS:
      return 0;
    case FUNCTION_UNIT_STATUSES.PENDING:
      return 1;
    case FUNCTION_UNIT_STATUSES.FAILED:
      return 2;
    case FUNCTION_UNIT_STATUSES.PASSED:
      return 3;
  }
}

function selectNextFunctionUnit(
  functionUnits: Array<FunctionUnit>,
  currentLock: ResumeCurrentLock | null,
  activeLocks: Array<ResumeCurrentLock>,
  checkpoint: Checkpoint | null,
  agentId: string | undefined,
): ResumeNextFunctionUnit | null {
  if (checkpoint !== null && checkpoint.next_fu !== null) {
    for (const functionUnit of functionUnits) {
      if (functionUnit.id === checkpoint.next_fu) {
        return buildNextFunctionUnitSummary(functionUnit);
      }
    }
  }

  if (currentLock !== null) {
    return buildNextFunctionUnitSummary(currentLock.function_unit);
  }

  const lockedFunctionUnitIds = new Map<string, string>();

  for (const activeLock of activeLocks) {
    lockedFunctionUnitIds.set(activeLock.fu_id, activeLock.agent_id);
  }

  let bestFunctionUnit: FunctionUnit | null = null;
  let bestScore: number | null = null;

  for (const functionUnit of functionUnits) {
    if (functionUnit.status === FUNCTION_UNIT_STATUSES.PASSED) {
      continue;
    }

    const lockingAgentId = lockedFunctionUnitIds.get(functionUnit.id);

    if (lockingAgentId !== undefined && agentId !== undefined && lockingAgentId !== agentId) {
      continue;
    }

    const assignmentRank =
      agentId !== undefined && functionUnit.assigned_agent === agentId
        ? 0
        : functionUnit.assigned_agent === null
          ? 1
          : 2;
    const score = assignmentRank * 10 + getStatusRank(functionUnit.status);

    if (bestScore === null || score < bestScore) {
      bestFunctionUnit = functionUnit;
      bestScore = score;
    }
  }

  if (bestFunctionUnit === null) {
    return null;
  }

  return buildNextFunctionUnitSummary(bestFunctionUnit);
}

function getSessionWarnings(
  featureId: string,
  buildCycleId: string,
  agentId: string | undefined,
): Array<string> {
  if (agentId === undefined) {
    return [];
  }

  const latestClosedSessionRow = getLatestClosedSessionLogRow(buildCycleId, agentId);

  if (latestClosedSessionRow === null) {
    return [];
  }

  const warnings = new Set<string>();

  if (latestClosedSessionRow.end_reason === SESSION_LOG_END_REASONS.COMPACT) {
    warnings.add('Last session ended due to compact.');
  }

  if (latestClosedSessionRow.end_reason === SESSION_LOG_END_REASONS.ERROR) {
    warnings.add('Last session ended with an error.');
  }

  if (latestClosedSessionRow.ended_at !== null) {
    const db = getDb();
    const expiredLockRow = db
      .prepare(
        `
          SELECT work_locks.id
          FROM work_locks
          INNER JOIN function_units ON function_units.id = work_locks.fu_id
          WHERE function_units.feature_id = ?
            AND work_locks.agent_id = ?
            AND work_locks.status = ?
            AND work_locks.release_reason = ?
            AND work_locks.released_at >= ?
            AND work_locks.released_at <= ?
          ORDER BY work_locks.released_at DESC, work_locks.id DESC
          LIMIT 1
        `
      )
      .get(
        featureId,
        agentId,
        WORK_LOCK_STATUSES.EXPIRED,
        'watchdog_timeout',
        latestClosedSessionRow.started_at,
        latestClosedSessionRow.ended_at,
      );

    if (expiredLockRow !== undefined) {
      warnings.add('WorkLock expired during last session.');
    }
  }

  return Array.from(warnings);
}

function buildParallelAgentStatus(
  featureId: string,
  buildCycle: BuildCycle,
  functionUnitMap: Map<string, FunctionUnit>,
  activeWorkLockRows: Array<WorkLockRow>,
): Array<ResumeParallelAgentStatus> {
  const agentIds = getAgentIdsForBuildCycle(featureId, buildCycle.id);
  const statuses: Array<ResumeParallelAgentStatus> = [];

  for (const agentId of agentIds) {
    const activeLocks = buildActiveLockList(activeWorkLockRows, functionUnitMap, agentId);
    const sessionLog = getOpenSessionLogForAgent(buildCycle.id, agentId);
    const checkpoint = getCheckpointRowForAgent(buildCycle.id, agentId);

    statuses.push({
      agent_id: agentId,
      session_log: sessionLog,
      checkpoint,
      active_locks: activeLocks,
      next_fu: checkpoint === null ? null : checkpoint.next_fu,
    });
  }

  return statuses;
}

export function blueprintResume(input: BlueprintResumeInput = {}): BlueprintResumeResult {
  expireStaleWorkLocks();

  const activeFeatureId = getActiveFeatureId();

  if (activeFeatureId === null) {
    return {
      active_feature: null,
    };
  }

  const activeFeature = getFeatureById(activeFeatureId);

  if (activeFeature === null) {
    throw new Error(`Active feature not found: ${activeFeatureId}`);
  }

  if (!isFeatureStatus(activeFeature.status)) {
    throw new TypeError(`Invalid feature status returned from database: ${activeFeature.status}`);
  }

  if (!isFeaturePriority(activeFeature.priority)) {
    throw new TypeError(`Invalid feature priority returned from database: ${activeFeature.priority}`);
  }

  const activeBuildCycle = getActiveBuildCycleForFeature(activeFeature.id);
  const activePlanCycle = activeBuildCycle === null ? getActivePlanCycleForFeature(activeFeature.id) : null;
  const functionUnitRows = getFunctionUnitRowsForFeature(activeFeature.id);
  const functionUnitMap = buildFunctionUnitMap(functionUnitRows);
  const functionUnits = Array.from(functionUnitMap.values());
  const activeWorkLockRows = getActiveWorkLockRowsForFeature(activeFeature.id);
  let checkpoint: Checkpoint | null = null;
  let currentLock: ResumeCurrentLock | null = null;
  let currentCycle: ResumeCurrentCycle | null = null;
  let parallelAgentStatus: Array<ResumeParallelAgentStatus> = [];
  let sessionWarnings: Array<string> = [];

  if (activeBuildCycle !== null) {
    const sessionLog =
      input.agent_id === undefined
        ? getOpenSessionLogForAgent(activeBuildCycle.id, activeBuildCycle.agent_id)
        : ensureBuildSessionLog({
            build_cycle_id: activeBuildCycle.id,
            agent_id: input.agent_id,
          });

    currentCycle = {
      cycle_type: 'build',
      cycle: activeBuildCycle,
      session_log: sessionLog,
    };

    const checkpointAgentId = input.agent_id === undefined ? activeBuildCycle.agent_id : input.agent_id;
    checkpoint = getCheckpoint(activeBuildCycle.id, checkpointAgentId);

    const relevantLockAgentId = input.agent_id === undefined ? activeBuildCycle.agent_id : input.agent_id;
    const activeLocks = buildActiveLockList(activeWorkLockRows, functionUnitMap, relevantLockAgentId);

    currentLock = getFirstArrayItem(activeLocks);

    parallelAgentStatus = buildParallelAgentStatus(
      activeFeature.id,
      activeBuildCycle,
      functionUnitMap,
      activeWorkLockRows,
    );
    sessionWarnings = getSessionWarnings(activeFeature.id, activeBuildCycle.id, input.agent_id);
  } else if (activePlanCycle !== null) {
    currentCycle = {
      cycle_type: 'plan',
      cycle: activePlanCycle,
    };
  }

  const openIssues = listIssues({
    feature_id: activeFeature.id,
    status: ISSUE_STATUSES.OPEN,
  });
  const relevantFunctionUnitIds = input.agent_id === undefined ? [] : getRelevantFunctionUnitIds(currentLock, checkpoint);
  const scopedOpenIssues = filterIssuesForRelevantFunctionUnits(openIssues, relevantFunctionUnitIds);
  const allActiveLocksForSelection: Array<ResumeCurrentLock> = [];

  for (const workLockRow of activeWorkLockRows) {
    const functionUnit = functionUnitMap.get(workLockRow.fu_id);

    if (functionUnit === undefined) {
      throw new Error(`Function unit not found for work lock ${workLockRow.id}`);
    }

    allActiveLocksForSelection.push(mapWorkLockRow(workLockRow, functionUnit));
  }

  const nextFu = selectNextFunctionUnit(
    functionUnits,
    currentLock,
    allActiveLocksForSelection,
    checkpoint,
    input.agent_id,
  );

  return {
    active_feature: activeFeature,
    current_cycle: currentCycle,
    checkpoint,
    current_lock: currentLock,
    open_issues: scopedOpenIssues,
    next_fu: nextFu,
    parallel_agent_status: parallelAgentStatus,
    session_warnings: sessionWarnings,
  };
}
