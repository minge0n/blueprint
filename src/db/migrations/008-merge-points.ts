import type { Migration, SqliteDatabase } from './types.js';

function createMergePointsTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS merge_points (
      id TEXT PRIMARY KEY,
      feature_id TEXT NOT NULL,
      trigger_fus TEXT NOT NULL,
      merged_fu TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'ready', 'passed', 'failed')),
      FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE,
      FOREIGN KEY (merged_fu) REFERENCES function_units(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_merge_points_feature_id
    ON merge_points (feature_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_merge_points_merged_fu
    ON merge_points (merged_fu)
  `);
}

const mergePointsMigration: Migration = {
  id: '008-merge-points',
  up(db: SqliteDatabase): void {
    createMergePointsTable(db);
  },
};

export default mergePointsMigration;
