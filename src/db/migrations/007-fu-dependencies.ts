import type { Migration, SqliteDatabase } from './types.js';

function createFunctionUnitDependenciesTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fu_dependencies (
      fu_id TEXT NOT NULL,
      depends_on_fu_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('hard', 'soft')),
      PRIMARY KEY (fu_id, depends_on_fu_id),
      FOREIGN KEY (fu_id) REFERENCES function_units(id) ON DELETE CASCADE,
      FOREIGN KEY (depends_on_fu_id) REFERENCES function_units(id) ON DELETE CASCADE,
      CHECK (fu_id <> depends_on_fu_id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_fu_dependencies_depends_on_fu_id
    ON fu_dependencies (depends_on_fu_id)
  `);
}

function runFunctionUnitDependenciesMigration(db: SqliteDatabase): void {
  createFunctionUnitDependenciesTable(db);
}

export const functionUnitDependenciesMigration: Migration = {
  id: '007-fu-dependencies',
  up(db: SqliteDatabase): void {
    runFunctionUnitDependenciesMigration(db);
  },
};

export default functionUnitDependenciesMigration;
