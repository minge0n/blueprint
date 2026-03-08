import type { Migration, SqliteDatabase } from './types.js';

function createWorkLocksTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS work_locks (
      id TEXT PRIMARY KEY,
      fu_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      released_at TEXT,
      release_reason TEXT,
      ttl_seconds INTEGER NOT NULL DEFAULT 300 CHECK (ttl_seconds > 0),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'expired')),
      FOREIGN KEY (fu_id) REFERENCES function_units(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_work_locks_active_fu_id_unique
    ON work_locks (fu_id)
    WHERE status = 'active'
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_work_locks_active_heartbeat
    ON work_locks (status, heartbeat_at)
  `);
}

function runWorkLocksMigration(db: SqliteDatabase): void {
  createWorkLocksTable(db);
}

export const workLocksMigration: Migration = {
  id: '003-work-locks',
  up(db: SqliteDatabase): void {
    runWorkLocksMigration(db);
  },
};

export default workLocksMigration;
