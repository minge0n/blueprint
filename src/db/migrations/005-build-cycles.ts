import type { Migration, SqliteDatabase } from './types.js';

function createBuildCyclesTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS build_cycles (
      id TEXT PRIMARY KEY,
      feature_id TEXT NOT NULL,
      iteration INTEGER NOT NULL CHECK (iteration > 0),
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'building' CHECK (
        status IN ('building', 'reviewing', 'approved', 'rejected')
      ),
      FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE,
      UNIQUE (feature_id, iteration)
    )
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_build_cycles_active_feature_unique
    ON build_cycles (feature_id)
    WHERE status IN ('building', 'reviewing')
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_build_cycles_feature_iteration
    ON build_cycles (feature_id, iteration DESC)
  `);
}

function createSessionLogsTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_logs (
      id TEXT PRIMARY KEY,
      build_cycle_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      end_reason TEXT CHECK (end_reason IN ('compact', 'done', 'error') OR end_reason IS NULL),
      FOREIGN KEY (build_cycle_id) REFERENCES build_cycles(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_session_logs_open_per_agent_cycle_unique
    ON session_logs (build_cycle_id, agent_id)
    WHERE ended_at IS NULL
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_session_logs_session_id_unique
    ON session_logs (session_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_session_logs_build_cycle_started_at
    ON session_logs (build_cycle_id, started_at DESC)
  `);
}

function createCheckpointsTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS checkpoints (
      id TEXT PRIMARY KEY,
      build_cycle_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      completed_fus TEXT NOT NULL,
      next_fu TEXT,
      notes TEXT,
      FOREIGN KEY (build_cycle_id) REFERENCES build_cycles(id) ON DELETE CASCADE,
      UNIQUE (build_cycle_id, agent_id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_checkpoints_build_cycle_agent
    ON checkpoints (build_cycle_id, agent_id)
  `);
}

function runBuildCyclesMigration(db: SqliteDatabase): void {
  createBuildCyclesTable(db);
  createSessionLogsTable(db);
  createCheckpointsTable(db);
}

export const buildCyclesMigration: Migration = {
  id: '005-build-cycles',
  up(db: SqliteDatabase): void {
    runBuildCyclesMigration(db);
  },
};

export default buildCyclesMigration;
