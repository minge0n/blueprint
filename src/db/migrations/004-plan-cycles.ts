import type { Migration, SqliteDatabase } from './types.js';

function createPlanCyclesTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plan_cycles (
      id TEXT PRIMARY KEY,
      feature_id TEXT NOT NULL,
      iteration INTEGER NOT NULL CHECK (iteration > 0),
      plan_snapshot TEXT NOT NULL CHECK (length(plan_snapshot) > 0),
      status TEXT NOT NULL DEFAULT 'drafting' CHECK (status IN ('drafting', 'reviewing', 'approved', 'rejected')),
      FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_cycles_feature_iteration_unique
    ON plan_cycles (feature_id, iteration)
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_cycles_active_feature_unique
    ON plan_cycles (feature_id)
    WHERE status IN ('drafting', 'reviewing')
  `);
}

function runPlanCyclesMigration(db: SqliteDatabase): void {
  createPlanCyclesTable(db);
}

export const planCyclesMigration: Migration = {
  id: '004-plan-cycles',
  up(db: SqliteDatabase): void {
    runPlanCyclesMigration(db);
  },
};

export default planCyclesMigration;
