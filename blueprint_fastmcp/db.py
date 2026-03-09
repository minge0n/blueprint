from __future__ import annotations

import os
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from threading import RLock

from .constants import BLUEPRINT_HOME_DIR, BLUEPRINT_HOME_ENV_KEY, DB_FILENAME

_DB_INSTANCE: sqlite3.Connection | None = None
_DB_LOCK = RLock()


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def get_blueprint_directory() -> Path:
    configured_directory = os.environ.get(BLUEPRINT_HOME_ENV_KEY)

    if configured_directory is None or configured_directory == "":
        directory = Path.home() / BLUEPRINT_HOME_DIR
    else:
        directory = Path(configured_directory)

    directory.mkdir(parents=True, exist_ok=True)

    return directory


def get_database_path() -> Path:
    return get_blueprint_directory() / DB_FILENAME


def _core_entities_sql() -> str:
    return """
    CREATE TABLE IF NOT EXISTS features (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      scope TEXT NOT NULL,
      out_of_scope TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'plan_review', 'building', 'build_review', 'done')),
      priority TEXT NOT NULL DEFAULT 'p1' CHECK (priority IN ('p0', 'p1', 'p2'))
    );

    CREATE TABLE IF NOT EXISTS feature_dependencies (
      feature_id TEXT NOT NULL,
      depends_on TEXT NOT NULL,
      PRIMARY KEY (feature_id, depends_on),
      FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE,
      FOREIGN KEY (depends_on) REFERENCES features(id) ON DELETE RESTRICT,
      CHECK (feature_id <> depends_on)
    );

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
    );

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
    );
    """


def _status_audit_log_sql() -> str:
    return """
    CREATE TABLE IF NOT EXISTS status_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK (
        entity_type IN ('feature', 'function_unit', 'acceptance_criteria', 'plan_cycle', 'build_cycle')
      ),
      entity_id TEXT NOT NULL CHECK (length(entity_id) > 0),
      old_status TEXT,
      new_status TEXT NOT NULL CHECK (length(new_status) > 0),
      changed_at TEXT NOT NULL CHECK (length(changed_at) > 0),
      changed_by TEXT,
      context TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_status_audit_log_entity_changed_at
    ON status_audit_log (entity_type, entity_id, changed_at, id);
    """


def _work_locks_sql() -> str:
    return """
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
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_work_locks_active_fu_id_unique
    ON work_locks (fu_id)
    WHERE status = 'active';

    CREATE INDEX IF NOT EXISTS idx_work_locks_active_heartbeat
    ON work_locks (status, heartbeat_at);
    """


def _plan_cycles_sql() -> str:
    return """
    CREATE TABLE IF NOT EXISTS plan_cycles (
      id TEXT PRIMARY KEY,
      feature_id TEXT NOT NULL,
      iteration INTEGER NOT NULL CHECK (iteration > 0),
      plan_snapshot TEXT NOT NULL CHECK (length(plan_snapshot) > 0),
      status TEXT NOT NULL DEFAULT 'drafting' CHECK (status IN ('drafting', 'reviewing', 'approved', 'rejected')),
      FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_cycles_feature_iteration_unique
    ON plan_cycles (feature_id, iteration);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_cycles_active_feature_unique
    ON plan_cycles (feature_id)
    WHERE status IN ('drafting', 'reviewing');
    """


def _build_cycles_sql() -> str:
    return """
    CREATE TABLE IF NOT EXISTS build_cycles (
      id TEXT PRIMARY KEY,
      feature_id TEXT NOT NULL,
      iteration INTEGER NOT NULL CHECK (iteration > 0),
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'building' CHECK (status IN ('building', 'reviewing', 'approved', 'rejected')),
      FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE,
      UNIQUE (feature_id, iteration)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_build_cycles_active_feature_unique
    ON build_cycles (feature_id)
    WHERE status IN ('building', 'reviewing');

    CREATE INDEX IF NOT EXISTS idx_build_cycles_feature_iteration
    ON build_cycles (feature_id, iteration DESC);

    CREATE TABLE IF NOT EXISTS session_logs (
      id TEXT PRIMARY KEY,
      build_cycle_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      end_reason TEXT CHECK (end_reason IN ('compact', 'done', 'error') OR end_reason IS NULL),
      FOREIGN KEY (build_cycle_id) REFERENCES build_cycles(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_session_logs_open_per_agent_cycle_unique
    ON session_logs (build_cycle_id, agent_id)
    WHERE ended_at IS NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_session_logs_session_id_unique
    ON session_logs (session_id);

    CREATE INDEX IF NOT EXISTS idx_session_logs_build_cycle_started_at
    ON session_logs (build_cycle_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS checkpoints (
      id TEXT PRIMARY KEY,
      build_cycle_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      completed_fus TEXT NOT NULL,
      next_fu TEXT,
      notes TEXT,
      FOREIGN KEY (build_cycle_id) REFERENCES build_cycles(id) ON DELETE CASCADE,
      UNIQUE (build_cycle_id, agent_id)
    );

    CREATE INDEX IF NOT EXISTS idx_checkpoints_build_cycle_agent
    ON checkpoints (build_cycle_id, agent_id);
    """


def _issues_sql() -> str:
    return """
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      parent_type TEXT NOT NULL CHECK (parent_type IN ('plan', 'build')),
      parent_id TEXT NOT NULL,
      fu_id TEXT NOT NULL,
      ac_id TEXT,
      related_fu_id TEXT,
      category TEXT NOT NULL CHECK (
        category IN (
          'missing_case', 'wrong_assumption', 'scope_creep', 'ambiguity', 'dependency_gap',
          'security_gap', 'performance_gap', 'implementation', 'integration_conflict',
          'race_condition', 'interface_mismatch'
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
    );

    CREATE INDEX IF NOT EXISTS idx_issues_parent
    ON issues (parent_type, parent_id);

    CREATE INDEX IF NOT EXISTS idx_issues_fu_status_severity
    ON issues (fu_id, status, severity);

    CREATE INDEX IF NOT EXISTS idx_issues_category
    ON issues (category);
    """


def _fu_dependencies_sql() -> str:
    return """
    CREATE TABLE IF NOT EXISTS fu_dependencies (
      fu_id TEXT NOT NULL,
      depends_on_fu_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('hard', 'soft')),
      PRIMARY KEY (fu_id, depends_on_fu_id),
      FOREIGN KEY (fu_id) REFERENCES function_units(id) ON DELETE CASCADE,
      FOREIGN KEY (depends_on_fu_id) REFERENCES function_units(id) ON DELETE CASCADE,
      CHECK (fu_id <> depends_on_fu_id)
    );

    CREATE INDEX IF NOT EXISTS idx_fu_dependencies_depends_on_fu_id
    ON fu_dependencies (depends_on_fu_id);
    """


def _merge_points_sql() -> str:
    return """
    CREATE TABLE IF NOT EXISTS merge_points (
      id TEXT PRIMARY KEY,
      feature_id TEXT NOT NULL,
      trigger_fus TEXT NOT NULL,
      merged_fu TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'ready', 'passed', 'failed')),
      FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE,
      FOREIGN KEY (merged_fu) REFERENCES function_units(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_merge_points_feature_id
    ON merge_points (feature_id);

    CREATE INDEX IF NOT EXISTS idx_merge_points_merged_fu
    ON merge_points (merged_fu);
    """


MIGRATIONS: list[tuple[str, str]] = [
    ("001-core-entities", _core_entities_sql()),
    ("002-status-audit-log", _status_audit_log_sql()),
    ("003-work-locks", _work_locks_sql()),
    ("004-plan-cycles", _plan_cycles_sql()),
    ("005-build-cycles", _build_cycles_sql()),
    ("006-issues", _issues_sql()),
    ("007-fu-dependencies", _fu_dependencies_sql()),
    ("008-merge-points", _merge_points_sql()),
]


def _row_factory(
    cursor: sqlite3.Cursor,
    row: tuple[object, ...],
) -> dict[str, object]:
    columns = [column[0] for column in cursor.description]

    return dict(zip(columns, row, strict=False))


def _ensure_migration_table(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        )
        """
    )
    connection.commit()


def _get_applied_migration_ids(connection: sqlite3.Connection) -> set[str]:
    rows = connection.execute(
        "SELECT id FROM schema_migrations ORDER BY id ASC"
    ).fetchall()

    return {str(row["id"]) for row in rows}


def _run_migrations(connection: sqlite3.Connection) -> None:
    applied_ids = _get_applied_migration_ids(connection)

    for migration_id, migration_sql in MIGRATIONS:
        if migration_id in applied_ids:
            continue

        with connection:
            connection.executescript(migration_sql)
            connection.execute(
                "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
                (migration_id, utc_now_iso()),
            )


def _create_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(get_database_path(), check_same_thread=False)
    connection.row_factory = _row_factory
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA foreign_keys = ON")
    _ensure_migration_table(connection)
    _run_migrations(connection)

    return connection


def get_db() -> sqlite3.Connection:
    global _DB_INSTANCE

    with _DB_LOCK:
        if _DB_INSTANCE is None:
            _DB_INSTANCE = _create_connection()

        return _DB_INSTANCE


def close_db() -> None:
    global _DB_INSTANCE

    with _DB_LOCK:
        if _DB_INSTANCE is not None:
            _DB_INSTANCE.close()
            _DB_INSTANCE = None


def reset_db_for_tests() -> None:
    close_db()
