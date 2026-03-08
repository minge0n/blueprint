import type { AcceptanceCriteria } from '../../entities/acceptance-criteria.js';
import type { BuildCycle, Checkpoint, SessionLog, SessionLogEndReason } from '../../entities/build-cycle.js';
import { BUILD_CYCLE_STATUSES, SESSION_LOG_END_REASONS } from '../../entities/build-cycle.js';
import type { Feature } from '../../entities/feature.js';
import type { FunctionUnit } from '../../entities/function-unit.js';
import type { Issue } from '../../entities/issue.js';
import { ISSUE_PARENT_TYPES } from '../../entities/issue.js';
import type { PlanCycle } from '../../entities/plan-cycle.js';
import { isPlanCycleStatus, parsePlanCycleSnapshot } from '../../entities/plan-cycle.js';
import {
  STATUS_AUDIT_LOG_ENTITY_TYPES,
  type StatusAuditLog,
  type StatusAuditLogEntityType,
} from '../../entities/status-audit-log.js';
import {
  ACCEPTANCE_CRITERIA_SEVERITIES,
  ACCEPTANCE_CRITERIA_STATUSES,
  ACCEPTANCE_CRITERIA_TYPES,
  FEATURE_PRIORITIES,
  FEATURE_STATUSES,
  FUNCTION_UNIT_STATUSES,
  type AcceptanceCriteriaSeverity,
  type AcceptanceCriteriaStatus,
  type AcceptanceCriteriaType,
  type FeaturePriority,
  type FeatureStatus,
  type FunctionUnitStatus,
} from '../../entities/types.js';
import type { WorkLock, WorkLockStatus } from '../../entities/work-lock.js';
import { WORK_LOCK_STATUSES } from '../../entities/work-lock.js';
import { getDb } from '../index.js';
import { getFullFeatureById } from './feature.js';
import { listIssues } from './issue.js';
import { getStatusHistory } from './status-audit-log.js';

export interface BlueprintGetContextInput {
  readonly feature_id?: string;
}

export interface ContextPlanCycle extends PlanCycle {
  readonly issues: Array<Issue>;
}

export interface ContextBuildCycle extends BuildCycle {
  readonly issues: Array<Issue>;
  readonly session_logs: Array<SessionLog>;
  readonly checkpoints: Array<Checkpoint>;
}

export interface ContextStatusAuditHistory {
  readonly feature: Array<StatusAuditLog>;
  readonly function_units: Array<ContextStatusAuditHistoryEntry>;
  readonly acceptance_criteria: Array<ContextStatusAuditHistoryEntry>;
  readonly plan_cycles: Array<ContextStatusAuditHistoryEntry>;
  readonly build_cycles: Array<ContextStatusAuditHistoryEntry>;
}

export interface ContextStatusAuditHistoryEntry {
  readonly entity_id: string;
  readonly history: Array<StatusAuditLog>;
}

export interface BlueprintGetContextResult {
  readonly feature: Feature | null;
  readonly function_units: Array<FunctionUnit>;
  readonly plan_cycles: Array<ContextPlanCycle>;
  readonly build_cycles: Array<ContextBuildCycle>;
  readonly issues: Array<Issue>;
  readonly work_locks: Array<WorkLock>;
  readonly status_audit_history: ContextStatusAuditHistory;
}

interface FeatureIdRow {
  readonly id: string;
}

interface PlanCycleRow {
  readonly id: string;
  readonly feature_id: string;
  readonly iteration: number | bigint;
  readonly plan_snapshot: string;
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

interface AcceptanceCriteriaRow {
  readonly id: string;
  readonly fu_id: string;
  readonly description: string;
  readonly type: string;
  readonly severity: string;
  readonly status: string;
  readonly verified_in: string | null;
  readonly evidence: string | null;
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

function isFeatureIdRow(value: unknown): value is FeatureIdRow {
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

function isAcceptanceCriteriaType(value: string): value is AcceptanceCriteriaType {
  switch (value) {
    case ACCEPTANCE_CRITERIA_TYPES.FUNCTIONAL:
    case ACCEPTANCE_CRITERIA_TYPES.PERFORMANCE:
    case ACCEPTANCE_CRITERIA_TYPES.SECURITY:
    case ACCEPTANCE_CRITERIA_TYPES.EDGE_CASE:
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

function isAcceptanceCriteriaRow(value: unknown): value is AcceptanceCriteriaRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string') {
    return false;
  }

  if (typeof value.fu_id !== 'string') {
    return false;
  }

  if (typeof value.description !== 'string') {
    return false;
  }

  if (typeof value.type !== 'string') {
    return false;
  }

  if (typeof value.severity !== 'string') {
    return false;
  }

  if (typeof value.status !== 'string') {
    return false;
  }

  if (value.verified_in !== null && typeof value.verified_in !== 'string') {
    return false;
  }

  if (value.evidence !== null && typeof value.evidence !== 'string') {
    return false;
  }

  return true;
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

function isWorkLockStatus(value: string): value is WorkLockStatus {
  switch (value) {
    case WORK_LOCK_STATUSES.ACTIVE:
    case WORK_LOCK_STATUSES.RELEASED:
    case WORK_LOCK_STATUSES.EXPIRED:
      return true;
    default:
      return false;
  }
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

function mapWorkLockRow(row: WorkLockRow): WorkLock {
  if (!isWorkLockStatus(row.status)) {
    throw new TypeError(`Invalid work lock status returned from database: ${row.status}`);
  }

  return {
    id: row.id,
    fu_id: row.fu_id,
    agent_id: row.agent_id,
    acquired_at: row.acquired_at,
    heartbeat_at: row.heartbeat_at,
    released_at: row.released_at,
    release_reason: row.release_reason,
    ttl_seconds: normalizeInteger(row.ttl_seconds),
    status: row.status,
  };
}

function mapAcceptanceCriteriaRow(row: AcceptanceCriteriaRow): AcceptanceCriteria {
  if (!isAcceptanceCriteriaType(row.type)) {
    throw new TypeError(`Invalid acceptance criteria type returned from database: ${row.type}`);
  }

  if (!isAcceptanceCriteriaSeverity(row.severity)) {
    throw new TypeError(
      `Invalid acceptance criteria severity returned from database: ${row.severity}`
    );
  }

  if (!isAcceptanceCriteriaStatus(row.status)) {
    throw new TypeError(`Invalid acceptance criteria status returned from database: ${row.status}`);
  }

  return {
    id: row.id,
    fu_id: row.fu_id,
    description: row.description,
    type: row.type,
    severity: row.severity,
    status: row.status,
    verified_in: row.verified_in,
    evidence: row.evidence,
  };
}

function createEmptyStatusAuditHistory(): ContextStatusAuditHistory {
  return {
    feature: [],
    function_units: [],
    acceptance_criteria: [],
    plan_cycles: [],
    build_cycles: [],
  };
}

function createEmptyContextResult(): BlueprintGetContextResult {
  return {
    feature: null,
    function_units: [],
    plan_cycles: [],
    build_cycles: [],
    issues: [],
    work_locks: [],
    status_audit_history: createEmptyStatusAuditHistory(),
  };
}

function getMostRecentlyActiveFeatureId(): string | null {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT features.id
        FROM features
        LEFT JOIN (
          SELECT feature_id, MAX(changed_at) AS last_changed_at
          FROM (
            SELECT features.id AS feature_id, status_audit_log.changed_at
            FROM features
            INNER JOIN status_audit_log
              ON status_audit_log.entity_type = ?
             AND status_audit_log.entity_id = features.id

            UNION ALL

            SELECT function_units.feature_id AS feature_id, status_audit_log.changed_at
            FROM function_units
            INNER JOIN status_audit_log
              ON status_audit_log.entity_type = ?
             AND status_audit_log.entity_id = function_units.id

            UNION ALL

            SELECT function_units.feature_id AS feature_id, status_audit_log.changed_at
            FROM acceptance_criteria
            INNER JOIN function_units
              ON function_units.id = acceptance_criteria.fu_id
            INNER JOIN status_audit_log
              ON status_audit_log.entity_type = ?
             AND status_audit_log.entity_id = acceptance_criteria.id

            UNION ALL

            SELECT plan_cycles.feature_id AS feature_id, status_audit_log.changed_at
            FROM plan_cycles
            INNER JOIN status_audit_log
              ON status_audit_log.entity_type = ?
             AND status_audit_log.entity_id = plan_cycles.id

            UNION ALL

            SELECT build_cycles.feature_id AS feature_id, status_audit_log.changed_at
            FROM build_cycles
            INNER JOIN status_audit_log
              ON status_audit_log.entity_type = ?
             AND status_audit_log.entity_id = build_cycles.id
          ) AS activity
          GROUP BY feature_id
        ) AS feature_activity
          ON feature_activity.feature_id = features.id
        ORDER BY
          CASE
            WHEN feature_activity.last_changed_at IS NULL THEN 1
            ELSE 0
          END ASC,
          feature_activity.last_changed_at DESC,
          CASE features.status
            WHEN 'build_review' THEN 0
            WHEN 'building' THEN 1
            WHEN 'plan_review' THEN 2
            WHEN 'draft' THEN 3
            WHEN 'done' THEN 4
            ELSE 5
          END ASC,
          features.id DESC
        LIMIT 1
      `
    )
    .get(
      STATUS_AUDIT_LOG_ENTITY_TYPES.FEATURE,
      STATUS_AUDIT_LOG_ENTITY_TYPES.FUNCTION_UNIT,
      STATUS_AUDIT_LOG_ENTITY_TYPES.ACCEPTANCE_CRITERIA,
      STATUS_AUDIT_LOG_ENTITY_TYPES.PLAN_CYCLE,
      STATUS_AUDIT_LOG_ENTITY_TYPES.BUILD_CYCLE,
    );

  if (row === undefined) {
    return null;
  }

  if (!isFeatureIdRow(row)) {
    throw new TypeError('Invalid most recently active feature row returned from database.');
  }

  return row.id;
}

function getPlanCycleRows(featureId: string): Array<PlanCycleRow> {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT id, feature_id, iteration, plan_snapshot, status
        FROM plan_cycles
        WHERE feature_id = ?
        ORDER BY iteration ASC, id ASC
      `
    )
    .all(featureId);
  const planCycleRows: Array<PlanCycleRow> = [];

  for (const row of rows) {
    if (!isPlanCycleRow(row)) {
      throw new TypeError('Invalid plan cycle row returned from database.');
    }

    planCycleRows.push(row);
  }

  return planCycleRows;
}

function getBuildCycleRows(featureId: string): Array<BuildCycleRow> {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT id, feature_id, iteration, agent_id, status
        FROM build_cycles
        WHERE feature_id = ?
        ORDER BY iteration ASC, id ASC
      `
    )
    .all(featureId);
  const buildCycleRows: Array<BuildCycleRow> = [];

  for (const row of rows) {
    if (!isBuildCycleRow(row)) {
      throw new TypeError('Invalid build cycle row returned from database.');
    }

    buildCycleRows.push(row);
  }

  return buildCycleRows;
}

function getSessionLogRows(buildCycleIds: Array<string>): Array<SessionLogRow> {
  if (buildCycleIds.length === 0) {
    return [];
  }

  const db = getDb();
  const placeholders = Array.from({ length: buildCycleIds.length }, () => '?').join(', ');
  const rows = db
    .prepare(
      `
        SELECT id, build_cycle_id, agent_id, session_id, started_at, ended_at, end_reason
        FROM session_logs
        WHERE build_cycle_id IN (${placeholders})
        ORDER BY build_cycle_id ASC, started_at ASC, id ASC
      `
    )
    .all(...buildCycleIds);
  const sessionLogRows: Array<SessionLogRow> = [];

  for (const row of rows) {
    if (!isSessionLogRow(row)) {
      throw new TypeError('Invalid session log row returned from database.');
    }

    sessionLogRows.push(row);
  }

  return sessionLogRows;
}

function getCheckpointRows(buildCycleIds: Array<string>): Array<CheckpointRow> {
  if (buildCycleIds.length === 0) {
    return [];
  }

  const db = getDb();
  const placeholders = Array.from({ length: buildCycleIds.length }, () => '?').join(', ');
  const rows = db
    .prepare(
      `
        SELECT id, build_cycle_id, agent_id, completed_fus, next_fu, notes
        FROM checkpoints
        WHERE build_cycle_id IN (${placeholders})
        ORDER BY build_cycle_id ASC, agent_id ASC, id ASC
      `
    )
    .all(...buildCycleIds);
  const checkpointRows: Array<CheckpointRow> = [];

  for (const row of rows) {
    if (!isCheckpointRow(row)) {
      throw new TypeError('Invalid checkpoint row returned from database.');
    }

    checkpointRows.push(row);
  }

  return checkpointRows;
}

function getWorkLockRows(featureId: string): Array<WorkLockRow> {
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
        ORDER BY work_locks.acquired_at ASC, work_locks.id ASC
      `
    )
    .all(featureId);
  const workLockRows: Array<WorkLockRow> = [];

  for (const row of rows) {
    if (!isWorkLockRow(row)) {
      throw new TypeError('Invalid work lock row returned from database.');
    }

    workLockRows.push(row);
  }

  return workLockRows;
}

function getAcceptanceCriteriaRows(functionUnitIds: Array<string>): Array<AcceptanceCriteriaRow> {
  if (functionUnitIds.length === 0) {
    return [];
  }

  const db = getDb();
  const placeholders = Array.from({ length: functionUnitIds.length }, () => '?').join(', ');
  const rows = db
    .prepare(
      `
        SELECT id, fu_id, description, type, severity, status, verified_in, evidence
        FROM acceptance_criteria
        WHERE fu_id IN (${placeholders})
        ORDER BY fu_id ASC, id ASC
      `
    )
    .all(...functionUnitIds);
  const acceptanceCriteriaRows: Array<AcceptanceCriteriaRow> = [];

  for (const row of rows) {
    if (!isAcceptanceCriteriaRow(row)) {
      throw new TypeError('Invalid acceptance criteria row returned from database.');
    }

    acceptanceCriteriaRows.push(row);
  }

  return acceptanceCriteriaRows;
}

function buildIssueMapByParent(issues: Array<Issue>, parentType: Issue['parent_type']): Map<string, Array<Issue>> {
  const issueMap = new Map<string, Array<Issue>>();

  for (const issue of issues) {
    if (issue.parent_type !== parentType) {
      continue;
    }

    const issuesForParent = issueMap.get(issue.parent_id);

    if (issuesForParent === undefined) {
      issueMap.set(issue.parent_id, [issue]);
      continue;
    }

    issuesForParent.push(issue);
  }

  return issueMap;
}

function buildSessionLogMap(sessionLogRows: Array<SessionLogRow>): Map<string, Array<SessionLog>> {
  const sessionLogMap = new Map<string, Array<SessionLog>>();

  for (const row of sessionLogRows) {
    const sessionLog = mapSessionLogRow(row);
    const sessionLogs = sessionLogMap.get(row.build_cycle_id);

    if (sessionLogs === undefined) {
      sessionLogMap.set(row.build_cycle_id, [sessionLog]);
      continue;
    }

    sessionLogs.push(sessionLog);
  }

  return sessionLogMap;
}

function buildCheckpointMap(checkpointRows: Array<CheckpointRow>): Map<string, Array<Checkpoint>> {
  const checkpointMap = new Map<string, Array<Checkpoint>>();

  for (const row of checkpointRows) {
    const checkpoint = mapCheckpointRow(row);
    const checkpoints = checkpointMap.get(row.build_cycle_id);

    if (checkpoints === undefined) {
      checkpointMap.set(row.build_cycle_id, [checkpoint]);
      continue;
    }

    checkpoints.push(checkpoint);
  }

  return checkpointMap;
}

function buildFunctionUnits(functionUnits: Array<FunctionUnit>): Array<FunctionUnit> {
  const normalizedFunctionUnits: Array<FunctionUnit> = [];

  for (const functionUnit of functionUnits) {
    if (!isFunctionUnitStatus(functionUnit.status)) {
      throw new TypeError(`Invalid function unit status returned from database: ${functionUnit.status}`);
    }

    normalizedFunctionUnits.push(functionUnit);
  }

  return normalizedFunctionUnits;
}

function buildAcceptanceCriteriaHistoryEntries(functionUnitIds: Array<string>): Array<ContextStatusAuditHistoryEntry> {
  const acceptanceCriteriaRows = getAcceptanceCriteriaRows(functionUnitIds);
  const entries: Array<ContextStatusAuditHistoryEntry> = [];

  for (const acceptanceCriteriaRow of acceptanceCriteriaRows) {
    const acceptanceCriteria = mapAcceptanceCriteriaRow(acceptanceCriteriaRow);

    entries.push({
      entity_id: acceptanceCriteria.id,
      history: getStatusHistory(
        STATUS_AUDIT_LOG_ENTITY_TYPES.ACCEPTANCE_CRITERIA,
        acceptanceCriteria.id,
      ),
    });
  }

  return entries;
}

function buildStatusAuditHistoryEntries(
  entityType: StatusAuditLogEntityType,
  entityIds: Array<string>,
): Array<ContextStatusAuditHistoryEntry> {
  const entries: Array<ContextStatusAuditHistoryEntry> = [];

  for (const entityId of entityIds) {
    entries.push({
      entity_id: entityId,
      history: getStatusHistory(entityType, entityId),
    });
  }

  return entries;
}

function buildStatusAuditHistory(
  featureId: string,
  functionUnits: Array<FunctionUnit>,
  planCycles: Array<PlanCycle>,
  buildCycles: Array<BuildCycle>,
): ContextStatusAuditHistory {
  const functionUnitIds = functionUnits.map((functionUnit) => functionUnit.id);

  return {
    feature: getStatusHistory(STATUS_AUDIT_LOG_ENTITY_TYPES.FEATURE, featureId),
    function_units: buildStatusAuditHistoryEntries(
      STATUS_AUDIT_LOG_ENTITY_TYPES.FUNCTION_UNIT,
      functionUnitIds,
    ),
    acceptance_criteria: buildAcceptanceCriteriaHistoryEntries(functionUnitIds),
    plan_cycles: buildStatusAuditHistoryEntries(
      STATUS_AUDIT_LOG_ENTITY_TYPES.PLAN_CYCLE,
      planCycles.map((planCycle) => planCycle.id),
    ),
    build_cycles: buildStatusAuditHistoryEntries(
      STATUS_AUDIT_LOG_ENTITY_TYPES.BUILD_CYCLE,
      buildCycles.map((buildCycle) => buildCycle.id),
    ),
  };
}

function validateFeature(feature: Feature): Feature {
  if (!isFeatureStatus(feature.status)) {
    throw new TypeError(`Invalid feature status returned from database: ${feature.status}`);
  }

  if (!isFeaturePriority(feature.priority)) {
    throw new TypeError(`Invalid feature priority returned from database: ${feature.priority}`);
  }

  return feature;
}

export function blueprintGetContext(
  input: BlueprintGetContextInput = {},
): BlueprintGetContextResult {
  const featureId = input.feature_id === undefined ? getMostRecentlyActiveFeatureId() : input.feature_id;

  if (featureId === null) {
    return createEmptyContextResult();
  }

  const fullFeature = getFullFeatureById(featureId);

  if (fullFeature === null) {
    if (input.feature_id === undefined) {
      return createEmptyContextResult();
    }

    throw new Error(`Feature not found: ${featureId}`);
  }

  const feature = validateFeature({
    id: fullFeature.id,
    title: fullFeature.title,
    scope: fullFeature.scope,
    out_of_scope: fullFeature.out_of_scope,
    status: fullFeature.status,
    priority: fullFeature.priority,
    depends_on: fullFeature.depends_on,
  });
  const functionUnits = buildFunctionUnits(fullFeature.function_units);
  const issues = listIssues({
    feature_id: feature.id,
  });
  const planCycleRows = getPlanCycleRows(feature.id);
  const buildCycleRows = getBuildCycleRows(feature.id);
  const planCycles = planCycleRows.map((row) => mapPlanCycleRow(row));
  const buildCycles = buildCycleRows.map((row) => mapBuildCycleRow(row));
  const buildCycleIds = buildCycles.map((buildCycle) => buildCycle.id);
  const sessionLogMap = buildSessionLogMap(getSessionLogRows(buildCycleIds));
  const checkpointMap = buildCheckpointMap(getCheckpointRows(buildCycleIds));
  const planIssueMap = buildIssueMapByParent(issues, ISSUE_PARENT_TYPES.PLAN);
  const buildIssueMap = buildIssueMapByParent(issues, ISSUE_PARENT_TYPES.BUILD);
  const contextPlanCycles = planCycles.map((planCycle) => {
    const cycleIssues = planIssueMap.get(planCycle.id);

    return {
      ...planCycle,
      issues: cycleIssues === undefined ? [] : cycleIssues,
    };
  });
  const contextBuildCycles = buildCycles.map((buildCycle) => {
    const cycleIssues = buildIssueMap.get(buildCycle.id);
    const sessionLogs = sessionLogMap.get(buildCycle.id);
    const checkpoints = checkpointMap.get(buildCycle.id);

    return {
      ...buildCycle,
      issues: cycleIssues === undefined ? [] : cycleIssues,
      session_logs: sessionLogs === undefined ? [] : sessionLogs,
      checkpoints: checkpoints === undefined ? [] : checkpoints,
    };
  });
  const workLocks = getWorkLockRows(feature.id).map((row) => mapWorkLockRow(row));
  const statusAuditHistory = buildStatusAuditHistory(
    feature.id,
    functionUnits,
    planCycles,
    buildCycles,
  );

  return {
    feature,
    function_units: functionUnits,
    plan_cycles: contextPlanCycles,
    build_cycles: contextBuildCycles,
    issues,
    work_locks: workLocks,
    status_audit_history: statusAuditHistory,
  };
}
