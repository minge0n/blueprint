import { getDb } from '../index.js';
import {
  STATUS_AUDIT_LOG_ENTITY_TYPES,
  type LogStatusChangeInput,
  type StatusAuditLog,
  type StatusAuditLogEntityType,
} from '../../entities/status-audit-log.js';

interface StatusAuditLogRow {
  readonly id: number | bigint;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly old_status: string | null;
  readonly new_status: string;
  readonly changed_at: string;
  readonly changed_by: string | null;
  readonly context: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return true;
}

function isStatusAuditLogRow(value: unknown): value is StatusAuditLogRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'number' && typeof value.id !== 'bigint') {
    return false;
  }

  if (typeof value.entity_type !== 'string') {
    return false;
  }

  if (typeof value.entity_id !== 'string') {
    return false;
  }

  if (value.old_status !== null && typeof value.old_status !== 'string') {
    return false;
  }

  if (typeof value.new_status !== 'string') {
    return false;
  }

  if (typeof value.changed_at !== 'string') {
    return false;
  }

  if (value.changed_by !== null && typeof value.changed_by !== 'string') {
    return false;
  }

  if (value.context !== null && typeof value.context !== 'string') {
    return false;
  }

  return true;
}

function isStatusAuditLogEntityType(value: string): value is StatusAuditLogEntityType {
  switch (value) {
    case STATUS_AUDIT_LOG_ENTITY_TYPES.FEATURE:
    case STATUS_AUDIT_LOG_ENTITY_TYPES.FUNCTION_UNIT:
    case STATUS_AUDIT_LOG_ENTITY_TYPES.ACCEPTANCE_CRITERIA:
    case STATUS_AUDIT_LOG_ENTITY_TYPES.PLAN_CYCLE:
    case STATUS_AUDIT_LOG_ENTITY_TYPES.BUILD_CYCLE:
      return true;
    default:
      return false;
  }
}

function normalizeRowId(id: number | bigint): number {
  if (typeof id === 'bigint') {
    return Number(id);
  }

  return id;
}

function mapStatusAuditLogRow(row: StatusAuditLogRow): StatusAuditLog {
  if (!isStatusAuditLogEntityType(row.entity_type)) {
    throw new TypeError('Invalid status audit log entity type returned from database.');
  }

  return {
    id: normalizeRowId(row.id),
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    old_status: row.old_status,
    new_status: row.new_status,
    changed_at: row.changed_at,
    changed_by: row.changed_by,
    context: row.context,
  };
}

function mapStatusAuditLogRows(rows: Array<unknown>): Array<StatusAuditLog> {
  const auditLogRows: Array<StatusAuditLog> = [];

  for (const row of rows) {
    if (!isStatusAuditLogRow(row)) {
      throw new TypeError('Invalid status audit log row returned from database.');
    }

    auditLogRows.push(mapStatusAuditLogRow(row));
  }

  return auditLogRows;
}

export function logStatusChange(input: LogStatusChangeInput): void {
  const db = getDb();
  const changedAt = new Date().toISOString();
  const changedBy = input.changed_by === undefined ? null : input.changed_by;
  const context = input.context === undefined ? null : input.context;

  db.prepare(
    `
      INSERT INTO status_audit_log (
        entity_type,
        entity_id,
        old_status,
        new_status,
        changed_at,
        changed_by,
        context
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    input.entity_type,
    input.entity_id,
    input.old_status,
    input.new_status,
    changedAt,
    changedBy,
    context
  );
}

export function getStatusHistory(
  entityType: StatusAuditLogEntityType,
  entityId: string
): Array<StatusAuditLog> {
  const db = getDb();
  const rows = db.prepare(
    `
      SELECT
        id,
        entity_type,
        entity_id,
        old_status,
        new_status,
        changed_at,
        changed_by,
        context
      FROM status_audit_log
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY changed_at ASC, id ASC
    `
  ).all(entityType, entityId);

  return mapStatusAuditLogRows(rows);
}
