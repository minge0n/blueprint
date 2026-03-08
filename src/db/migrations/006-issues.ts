import type { Migration, SqliteDatabase } from './types.js';

function createIssuesTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      parent_type TEXT NOT NULL CHECK (parent_type IN ('plan', 'build')),
      parent_id TEXT NOT NULL,
      fu_id TEXT NOT NULL,
      ac_id TEXT,
      related_fu_id TEXT,
      category TEXT NOT NULL CHECK (
        category IN (
          'missing_case',
          'wrong_assumption',
          'scope_creep',
          'ambiguity',
          'dependency_gap',
          'security_gap',
          'performance_gap',
          'implementation',
          'integration_conflict',
          'race_condition',
          'interface_mismatch'
        )
      ),
      severity TEXT NOT NULL CHECK (severity IN ('critical', 'major', 'minor', 'nitpick')),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      suggested_fix TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'wont_fix')),
      resolved_in TEXT,
      resolution_note TEXT,
      FOREIGN KEY (fu_id) REFERENCES function_units(id) ON DELETE CASCADE,
      FOREIGN KEY (ac_id) REFERENCES acceptance_criteria(id) ON DELETE CASCADE,
      FOREIGN KEY (related_fu_id) REFERENCES function_units(id) ON DELETE SET NULL
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_issues_parent
    ON issues (parent_type, parent_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_issues_fu_status_severity
    ON issues (fu_id, status, severity)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_issues_category
    ON issues (category)
  `);
}

function runIssuesMigration(db: SqliteDatabase): void {
  createIssuesTable(db);
}

export const issuesMigration: Migration = {
  id: '006-issues',
  up(db: SqliteDatabase): void {
    runIssuesMigration(db);
  },
};

export default issuesMigration;
