import type { Migration, SqliteDatabase } from './types.js';

function createStatusAuditLogTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS status_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK (
        entity_type IN (
          'feature',
          'function_unit',
          'acceptance_criteria',
          'plan_cycle',
          'build_cycle'
        )
      ),
      entity_id TEXT NOT NULL CHECK (length(entity_id) > 0),
      old_status TEXT,
      new_status TEXT NOT NULL CHECK (length(new_status) > 0),
      changed_at TEXT NOT NULL CHECK (length(changed_at) > 0),
      changed_by TEXT,
      context TEXT
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_status_audit_log_entity_changed_at
    ON status_audit_log (entity_type, entity_id, changed_at, id)
  `);
}

function runStatusAuditLogMigration(db: SqliteDatabase): void {
  createStatusAuditLogTable(db);
}

export const statusAuditLogMigration: Migration = {
  id: '002-status-audit-log',
  up(db: SqliteDatabase): void {
    runStatusAuditLogMigration(db);
  },
};

export default statusAuditLogMigration;
