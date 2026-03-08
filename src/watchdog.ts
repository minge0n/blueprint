import { getDb } from './db/index.js';
import { logStatusChange } from './db/queries/status-audit-log.js';
import { STATUS_AUDIT_LOG_ENTITY_TYPES } from './entities/status-audit-log.js';
import {
  FUNCTION_UNIT_STATUSES,
  type FunctionUnitStatus,
} from './entities/types.js';
import { WORK_LOCK_STATUSES } from './entities/work-lock.js';

const WATCHDOG_INTERVAL_MS = 30_000;

interface ExpiredWorkLockRow {
  readonly lock_id: string;
  readonly fu_id: string;
  readonly feature_id: string;
  readonly agent_id: string;
  readonly fu_status: string;
}

export interface WorkLockWatchdogHandle {
  stop(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return true;
}

function isExpiredWorkLockRow(value: unknown): value is ExpiredWorkLockRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.lock_id !== 'string') {
    return false;
  }

  if (typeof value.fu_id !== 'string') {
    return false;
  }

  if (typeof value.feature_id !== 'string') {
    return false;
  }

  if (typeof value.agent_id !== 'string') {
    return false;
  }

  if (typeof value.fu_status !== 'string') {
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

function getExpiredWorkLockRows(): Array<ExpiredWorkLockRow> {
  const db = getDb();
  const rows = db.prepare(
    `
      SELECT
        work_locks.id AS lock_id,
        work_locks.fu_id AS fu_id,
        function_units.feature_id AS feature_id,
        work_locks.agent_id AS agent_id,
        function_units.status AS fu_status
      FROM work_locks
      INNER JOIN function_units ON function_units.id = work_locks.fu_id
      WHERE work_locks.status = ?
        AND unixepoch(work_locks.heartbeat_at) < unixepoch('now') - work_locks.ttl_seconds
    `
  ).all(WORK_LOCK_STATUSES.ACTIVE);
  const expiredLocks: Array<ExpiredWorkLockRow> = [];

  for (const row of rows) {
    if (!isExpiredWorkLockRow(row)) {
      throw new TypeError('Invalid expired work lock row returned from database.');
    }

    expiredLocks.push(row);
  }

  return expiredLocks;
}

function writeExpirationLog(lock: ExpiredWorkLockRow): void {
  process.stderr.write(
    `[watchdog] expired work lock lock_id=${lock.lock_id} fu_id=${lock.fu_id} agent_id=${lock.agent_id}\n`
  );
}

function expireWorkLock(lock: ExpiredWorkLockRow): void {
  if (!isFunctionUnitStatus(lock.fu_status)) {
    throw new TypeError('Invalid function unit status returned from database.');
  }

  const db = getDb();
  const releasedAt = new Date().toISOString();
  const runExpiration = db.transaction((expiredLock: ExpiredWorkLockRow) => {
    const workLockUpdateResult = db.prepare(
      `
        UPDATE work_locks
        SET
          status = ?,
          released_at = ?,
          release_reason = ?
        WHERE id = ? AND status = ?
      `
    ).run(
      WORK_LOCK_STATUSES.EXPIRED,
      releasedAt,
      'watchdog_timeout',
      expiredLock.lock_id,
      WORK_LOCK_STATUSES.ACTIVE
    );

    if (workLockUpdateResult.changes === 0) {
      return false;
    }

    db.prepare(
      `
        UPDATE session_logs
        SET ended_at = ?, end_reason = 'compact'
        WHERE build_cycle_id IN (
          SELECT id
          FROM build_cycles
          WHERE feature_id = ? AND status IN ('building', 'reviewing')
        )
          AND agent_id = ?
          AND ended_at IS NULL
      `
    ).run(releasedAt, expiredLock.feature_id, expiredLock.agent_id);

    db.prepare(
      `
        UPDATE function_units
        SET status = ?
        WHERE id = ?
      `
    ).run(FUNCTION_UNIT_STATUSES.PENDING, expiredLock.fu_id);

    if (expiredLock.fu_status !== FUNCTION_UNIT_STATUSES.PENDING) {
      logStatusChange({
        entity_type: STATUS_AUDIT_LOG_ENTITY_TYPES.FUNCTION_UNIT,
        entity_id: expiredLock.fu_id,
        old_status: expiredLock.fu_status,
        new_status: FUNCTION_UNIT_STATUSES.PENDING,
        changed_by: expiredLock.agent_id,
        context: expiredLock.lock_id,
      });
    }

    return true;
  });

  const didExpireLock = runExpiration(lock);

  if (!didExpireLock) {
    return;
  }

  writeExpirationLog(lock);
}

export function runWorkLockWatchdogCycle(): number {
  const expiredLocks = getExpiredWorkLockRows();

  for (const expiredLock of expiredLocks) {
    expireWorkLock(expiredLock);
  }

  return expiredLocks.length;
}

export function startWorkLockWatchdog(): WorkLockWatchdogHandle {
  runWorkLockWatchdogCycle();

  const interval = setInterval((): void => {
    try {
      runWorkLockWatchdogCycle();
    } catch (error: unknown) {
      process.stderr.write(`[watchdog] error while expiring work locks ${String(error)}\n`);
    }
  }, WATCHDOG_INTERVAL_MS);

  interval.unref();

  return {
    stop(): void {
      clearInterval(interval);
    },
  };
}
