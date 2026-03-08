import type { Migration, SqliteDatabase } from './types.js';

function createFeaturesTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS features (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      scope TEXT NOT NULL,
      out_of_scope TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'plan_review', 'building', 'build_review', 'done')),
      priority TEXT NOT NULL DEFAULT 'p1' CHECK (priority IN ('p0', 'p1', 'p2'))
    )
  `);
}

function createFeatureDependenciesTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS feature_dependencies (
      feature_id TEXT NOT NULL,
      depends_on TEXT NOT NULL,
      PRIMARY KEY (feature_id, depends_on),
      FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE,
      FOREIGN KEY (depends_on) REFERENCES features(id) ON DELETE RESTRICT,
      CHECK (feature_id <> depends_on)
    )
  `);
}

function createFunctionUnitsTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS function_units (
      id TEXT PRIMARY KEY,
      feature_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'passed', 'failed')),
      assigned_agent TEXT,
      test_evidence TEXT,
      failure_reason TEXT,
      FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE
    )
  `);
}

function createAcceptanceCriteriaTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS acceptance_criteria (
      id TEXT PRIMARY KEY,
      fu_id TEXT NOT NULL,
      description TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('functional', 'performance', 'security', 'edge_case')),
      severity TEXT NOT NULL CHECK (severity IN ('must', 'should', 'nice_to_have')),
      status TEXT NOT NULL DEFAULT 'not_tested' CHECK (status IN ('not_tested', 'passed', 'failed', 'blocked')),
      verified_in TEXT,
      evidence TEXT,
      FOREIGN KEY (fu_id) REFERENCES function_units(id) ON DELETE CASCADE
    )
  `);
}

function runCoreEntitiesMigration(db: SqliteDatabase): void {
  createFeaturesTable(db);
  createFeatureDependenciesTable(db);
  createFunctionUnitsTable(db);
  createAcceptanceCriteriaTable(db);
}

export const coreEntitiesMigration: Migration = {
  id: '001-core-entities',
  up(db: SqliteDatabase): void {
    runCoreEntitiesMigration(db);
  },
};

export default coreEntitiesMigration;
