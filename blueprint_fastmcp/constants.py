BLUEPRINT_HOME_DIR = ".blueprint"
BLUEPRINT_HOME_ENV_KEY = "BLUEPRINT_HOME"
DB_FILENAME = "db.sqlite"

FEATURE_STATUSES = {"draft", "plan_review", "building", "build_review", "done"}
FEATURE_PRIORITIES = {"p0", "p1", "p2"}

FUNCTION_UNIT_STATUSES = {"pending", "in_progress", "passed", "failed"}
FUNCTION_UNIT_DEPENDENCY_TYPES = {"hard", "soft"}

ACCEPTANCE_CRITERIA_TYPES = {"functional", "performance", "security", "edge_case"}
ACCEPTANCE_CRITERIA_SEVERITIES = {"must", "should", "nice_to_have"}
ACCEPTANCE_CRITERIA_STATUSES = {"not_tested", "passed", "failed", "blocked"}

STATUS_AUDIT_LOG_ENTITY_TYPES = {
    "feature",
    "function_unit",
    "acceptance_criteria",
    "plan_cycle",
    "build_cycle",
}

PLAN_CYCLE_STATUSES = {"drafting", "reviewing", "approved", "rejected"}
BUILD_CYCLE_STATUSES = {"building", "reviewing", "approved", "rejected"}
SESSION_LOG_END_REASONS = {"compact", "done", "error"}

ISSUE_PARENT_TYPES = {"plan", "build"}
ISSUE_CATEGORIES = {
    "missing_case",
    "wrong_assumption",
    "scope_creep",
    "ambiguity",
    "dependency_gap",
    "security_gap",
    "performance_gap",
    "implementation",
    "integration_conflict",
    "race_condition",
    "interface_mismatch",
}
ISSUE_SEVERITIES = {"critical", "major", "minor", "nitpick"}
ISSUE_STATUSES = {"open", "in_progress", "resolved", "wont_fix"}

WORK_LOCK_STATUSES = {"active", "released", "expired"}
MERGE_POINT_STATUSES = {"waiting", "ready", "passed", "failed"}
