import { getDb } from '../index.js';
import {
  WORK_LOCK_STATUSES,
  type WorkLock,
  type WorkLockStatus,
} from '../../entities/work-lock.js';

export interface BlueprintHeartbeatInput {
  readonly lock_id: string;
  readonly agent_id: string;
}

export interface BlueprintReleaseLockInput {
  readonly lock_id: string;
  readonly agent_id: string;
  readonly reason?: string;
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

function normalizeInteger(value: number | bigint): number {
  if (typeof value === 'bigint') {
    return Number(value);
  }

  return value;
}

function normalizeReleaseReason(reason: string | undefined): string | null {
  if (reason === undefined) {
    return null;
  }

  if (reason.trim().length === 0) {
    throw new Error('reason is required when provided');
  }

  return reason;
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

function isWorkLockExpired(row: WorkLockRow, now: Date): boolean {
  const heartbeatTimestamp = Date.parse(row.heartbeat_at);

  if (Number.isNaN(heartbeatTimestamp)) {
    throw new TypeError(`Invalid work lock heartbeat timestamp: ${row.heartbeat_at}`);
  }

  const ttlMilliseconds = normalizeInteger(row.ttl_seconds) * 1000;

  return now.getTime() - heartbeatTimestamp > ttlMilliseconds;
}

function expireWorkLockIfNeeded(lockId: string, now: Date): void {
  const workLock = getWorkLockRowById(lockId);

  if (workLock === null || workLock.status !== WORK_LOCK_STATUSES.ACTIVE) {
    return;
  }

  if (!isWorkLockExpired(workLock, now)) {
    return;
  }

  const db = getDb();
  db.prepare(
    `
      UPDATE work_locks
      SET status = ?,
          released_at = ?,
          release_reason = ?
      WHERE id = ? AND status = ?
    `
  ).run(
    WORK_LOCK_STATUSES.EXPIRED,
    now.toISOString(),
    'watchdog_timeout',
    lockId,
    WORK_LOCK_STATUSES.ACTIVE
  );
}

export function expireStaleWorkLocks(now: Date = new Date()): number {
  const db = getDb();
  const rows = db.prepare(
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
      WHERE status = ?
      ORDER BY heartbeat_at ASC, id ASC
    `
  ).all(WORK_LOCK_STATUSES.ACTIVE);
  let expiredCount = 0;

  for (const row of rows) {
    if (!isWorkLockRow(row)) {
      throw new TypeError('Invalid work lock row returned from database.');
    }

    if (!isWorkLockExpired(row, now)) {
      continue;
    }

    expireWorkLockIfNeeded(row.id, now);
    expiredCount += 1;
  }

  return expiredCount;
}

function getWorkLockRowById(lockId: string): WorkLockRow | null {
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
      WHERE id = ?
    `
  ).get(lockId);

  if (row === undefined) {
    return null;
  }

  if (!isWorkLockRow(row)) {
    throw new TypeError('Invalid work lock row returned from database.');
  }

  return row;
}

function requireActiveOwnedWorkLock(lockId: string, agentId: string): WorkLockRow {
  expireWorkLockIfNeeded(lockId, new Date());

  const workLock = getWorkLockRowById(lockId);

  if (workLock === null || workLock.status !== WORK_LOCK_STATUSES.ACTIVE) {
    throw new Error(`Lock ${lockId} is no longer active`);
  }

  if (workLock.agent_id !== agentId) {
    throw new Error(`Lock ${lockId} is owned by ${workLock.agent_id}, not ${agentId}`);
  }

  return workLock;
}

export function getWorkLockById(lockId: string): WorkLock | null {
  const workLockRow = getWorkLockRowById(lockId);

  if (workLockRow === null) {
    return null;
  }

  return mapWorkLockRow(workLockRow);
}

export function blueprintHeartbeat(input: BlueprintHeartbeatInput): WorkLock {
  const db = getDb();
  const runHeartbeat = db.transaction((currentInput: BlueprintHeartbeatInput): WorkLock => {
    expireStaleWorkLocks();
    requireActiveOwnedWorkLock(currentInput.lock_id, currentInput.agent_id);

    db.prepare(
      `
        UPDATE work_locks
        SET heartbeat_at = ?
        WHERE id = ? AND status = ?
      `
    ).run(new Date().toISOString(), currentInput.lock_id, WORK_LOCK_STATUSES.ACTIVE);

    const updatedWorkLock = getWorkLockById(currentInput.lock_id);

    if (updatedWorkLock === null) {
      throw new Error(`Lock ${currentInput.lock_id} could not be loaded after heartbeat.`);
    }

    return updatedWorkLock;
  });

  return runHeartbeat(input);
}

export function blueprintReleaseLock(input: BlueprintReleaseLockInput): WorkLock {
  const releaseReason = normalizeReleaseReason(input.reason);
  const db = getDb();
  const runReleaseLock = db.transaction((currentInput: BlueprintReleaseLockInput): WorkLock => {
    expireStaleWorkLocks();
    requireActiveOwnedWorkLock(currentInput.lock_id, currentInput.agent_id);

    db.prepare(
      `
        UPDATE work_locks
        SET
          status = ?,
          released_at = ?,
          release_reason = ?
        WHERE id = ? AND status = ?
      `
    ).run(
      WORK_LOCK_STATUSES.RELEASED,
      new Date().toISOString(),
      releaseReason,
      currentInput.lock_id,
      WORK_LOCK_STATUSES.ACTIVE
    );

    const updatedWorkLock = getWorkLockById(currentInput.lock_id);

    if (updatedWorkLock === null) {
      throw new Error(`Lock ${currentInput.lock_id} could not be loaded after release.`);
    }

    return updatedWorkLock;
  });

  return runReleaseLock(input);
}
