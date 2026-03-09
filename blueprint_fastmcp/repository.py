from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from .audit import get_status_history, log_status_change
from .constants import (
    ACCEPTANCE_CRITERIA_SEVERITIES,
    ACCEPTANCE_CRITERIA_STATUSES,
    ACCEPTANCE_CRITERIA_TYPES,
    BUILD_CYCLE_STATUSES,
    FEATURE_PRIORITIES,
    FEATURE_STATUSES,
    FUNCTION_UNIT_DEPENDENCY_TYPES,
    FUNCTION_UNIT_STATUSES,
    ISSUE_CATEGORIES,
    ISSUE_PARENT_TYPES,
    ISSUE_SEVERITIES,
    ISSUE_STATUSES,
    PLAN_CYCLE_STATUSES,
    SESSION_LOG_END_REASONS,
    WORK_LOCK_STATUSES,
)
from .db import get_blueprint_directory, get_db, utc_now_iso
from .gates import evaluate_build_approval_gate, evaluate_plan_approval_gate
from .lifecycle import transition_feature_status_from_event
from .models import (
    AcceptanceCriteriaRecord,
    BuildCycleRecord,
    CheckpointRecord,
    FeatureRecord,
    FullFeatureRecord,
    FunctionUnitDependencyRecord,
    FunctionUnitRecord,
    IssueRecord,
    PlanCycleRecord,
    SessionLogRecord,
)


def _slugify_title(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", title.strip().lower())
    slug = slug.strip("_")

    return slug or "feature"


def _parse_prefixed_counter(value: str, prefix: str) -> int:
    parts = value.split("_")

    if len(parts) < 2 or parts[0] != prefix:
        return 0

    try:
        parsed = int(parts[1])
    except ValueError:
        return 0

    if parsed < 1:
        return 0

    return parsed


def _next_counter(table_name: str, prefix: str) -> int:
    connection = get_db()
    rows = connection.execute(f"SELECT id FROM {table_name} ORDER BY id ASC").fetchall()
    current_max = 0

    for row in rows:
        row_id = str(row["id"])
        current_max = max(current_max, _parse_prefixed_counter(row_id, prefix))

    return current_max + 1


def _require_in_set(value: str, allowed_values: set[str], name: str) -> str:
    if value not in allowed_values:
        raise ValueError(f"Invalid {name}: {value}")

    return value


def _validate_feature_priority(priority: str) -> str:
    return _require_in_set(priority, FEATURE_PRIORITIES, "feature priority")


def _validate_feature_status(status: str) -> str:
    return _require_in_set(status, FEATURE_STATUSES, "feature status")


def _validate_fu_status(status: str) -> str:
    return _require_in_set(status, FUNCTION_UNIT_STATUSES, "function unit status")


def _validate_ac_type(ac_type: str) -> str:
    return _require_in_set(
        ac_type, ACCEPTANCE_CRITERIA_TYPES, "acceptance criteria type"
    )


def _validate_ac_severity(severity: str) -> str:
    return _require_in_set(
        severity, ACCEPTANCE_CRITERIA_SEVERITIES, "acceptance criteria severity"
    )


def _validate_ac_status(status: str) -> str:
    return _require_in_set(
        status, ACCEPTANCE_CRITERIA_STATUSES, "acceptance criteria status"
    )


def _validate_plan_cycle_status(status: str) -> str:
    return _require_in_set(status, PLAN_CYCLE_STATUSES, "plan cycle status")


def _validate_build_cycle_status(status: str) -> str:
    return _require_in_set(status, BUILD_CYCLE_STATUSES, "build cycle status")


def _validate_issue_parent_type(parent_type: str) -> str:
    return _require_in_set(parent_type, ISSUE_PARENT_TYPES, "issue parent type")


def _validate_issue_category(category: str) -> str:
    return _require_in_set(category, ISSUE_CATEGORIES, "issue category")


def _validate_issue_severity(severity: str) -> str:
    return _require_in_set(severity, ISSUE_SEVERITIES, "issue severity")


def _validate_issue_status(status: str) -> str:
    return _require_in_set(status, ISSUE_STATUSES, "issue status")


def _normalize_depends_on(depends_on: list[str] | None) -> list[str]:
    if depends_on is None:
        return []

    normalized: list[str] = []
    seen: set[str] = set()

    for item in depends_on:
        trimmed = item.strip()

        if trimmed == "" or trimmed in seen:
            continue

        seen.add(trimmed)
        normalized.append(trimmed)

    return normalized


def _feature_dependency_map(feature_ids: list[str]) -> dict[str, list[str]]:
    dependency_map = {feature_id: [] for feature_id in feature_ids}

    if not feature_ids:
        return dependency_map

    placeholders = ", ".join("?" for _ in feature_ids)
    connection = get_db()
    rows = connection.execute(
        f"""
        SELECT feature_id, depends_on
        FROM feature_dependencies
        WHERE feature_id IN ({placeholders})
        ORDER BY feature_id ASC, depends_on ASC
        """,
        tuple(feature_ids),
    ).fetchall()

    for row in rows:
        dependency_map[str(row["feature_id"])].append(str(row["depends_on"]))

    return dependency_map


def _fu_dependency_map(
    function_unit_ids: list[str],
) -> dict[str, list[FunctionUnitDependencyRecord]]:
    dependency_map = {function_unit_id: [] for function_unit_id in function_unit_ids}

    if not function_unit_ids:
        return dependency_map

    placeholders = ", ".join("?" for _ in function_unit_ids)
    connection = get_db()
    rows = connection.execute(
        f"""
        SELECT fu_id, depends_on_fu_id, type
        FROM fu_dependencies
        WHERE fu_id IN ({placeholders})
        ORDER BY fu_id ASC, depends_on_fu_id ASC
        """,
        tuple(function_unit_ids),
    ).fetchall()

    for row in rows:
        dependency_map[str(row["fu_id"])].append(
            FunctionUnitDependencyRecord(
                fu_id=str(row["depends_on_fu_id"]),
                type=str(row["type"]),
            )
        )

    return dependency_map


def _map_feature_row(row: dict[str, object], depends_on: list[str]) -> FeatureRecord:
    return FeatureRecord(
        id=str(row["id"]),
        title=str(row["title"]),
        scope=str(row["scope"]),
        out_of_scope=str(row["out_of_scope"]),
        status=str(row["status"]),
        priority=str(row["priority"]),
        depends_on=depends_on,
    )


def _map_ac_row(row: dict[str, object]) -> AcceptanceCriteriaRecord:
    return AcceptanceCriteriaRecord(
        id=str(row["id"]),
        fu_id=str(row["fu_id"]),
        description=str(row["description"]),
        type=str(row["type"]),
        severity=str(row["severity"]),
        status=str(row["status"]),
        verified_in=None if row["verified_in"] is None else str(row["verified_in"]),
        evidence=None if row["evidence"] is None else str(row["evidence"]),
    )


def _map_fu_row(
    row: dict[str, object],
    acceptance_criteria: list[AcceptanceCriteriaRecord],
    depends_on: list[FunctionUnitDependencyRecord],
) -> FunctionUnitRecord:
    return FunctionUnitRecord(
        id=str(row["id"]),
        feature_id=str(row["feature_id"]),
        title=str(row["title"]),
        description=str(row["description"]),
        acceptance_criteria=acceptance_criteria,
        depends_on=depends_on,
        status=str(row["status"]),
        assigned_agent=None
        if row["assigned_agent"] is None
        else str(row["assigned_agent"]),
        test_evidence=None
        if row["test_evidence"] is None
        else str(row["test_evidence"]),
        failure_reason=None
        if row["failure_reason"] is None
        else str(row["failure_reason"]),
    )


def _map_issue_row(row: dict[str, object]) -> IssueRecord:
    return IssueRecord(
        id=str(row["id"]),
        parent_type=str(row["parent_type"]),
        parent_id=str(row["parent_id"]),
        fu_id=str(row["fu_id"]),
        ac_id=None if row["ac_id"] is None else str(row["ac_id"]),
        related_fu_id=None
        if row["related_fu_id"] is None
        else str(row["related_fu_id"]),
        category=str(row["category"]),
        severity=str(row["severity"]),
        title=str(row["title"]),
        description=str(row["description"]),
        suggested_fix=None
        if row["suggested_fix"] is None
        else str(row["suggested_fix"]),
        status=str(row["status"]),
        resolved_in=None if row["resolved_in"] is None else str(row["resolved_in"]),
        resolution_note=None
        if row["resolution_note"] is None
        else str(row["resolution_note"]),
    )


def _get_feature_row(feature_id: str) -> dict[str, object] | None:
    connection = get_db()

    return connection.execute(
        "SELECT id, title, scope, out_of_scope, status, priority FROM features WHERE id = ?",
        (feature_id,),
    ).fetchone()


def _get_function_unit_row(function_unit_id: str) -> dict[str, object] | None:
    connection = get_db()

    return connection.execute(
        """
        SELECT id, feature_id, title, description, status, assigned_agent, test_evidence, failure_reason
        FROM function_units
        WHERE id = ?
        """,
        (function_unit_id,),
    ).fetchone()


def _get_acceptance_criteria_row(ac_id: str) -> dict[str, object] | None:
    connection = get_db()

    return connection.execute(
        """
        SELECT id, fu_id, description, type, severity, status, verified_in, evidence
        FROM acceptance_criteria
        WHERE id = ?
        """,
        (ac_id,),
    ).fetchone()


def _get_issue_row(issue_id: str) -> dict[str, object] | None:
    connection = get_db()

    return connection.execute(
        """
        SELECT id, parent_type, parent_id, fu_id, ac_id, related_fu_id, category, severity, title,
               description, suggested_fix, status, resolved_in, resolution_note
        FROM issues
        WHERE id = ?
        """,
        (issue_id,),
    ).fetchone()


def _get_plan_cycle_row(plan_cycle_id: str) -> dict[str, object] | None:
    connection = get_db()

    return connection.execute(
        "SELECT id, feature_id, iteration, plan_snapshot, status FROM plan_cycles WHERE id = ?",
        (plan_cycle_id,),
    ).fetchone()


def _get_build_cycle_row(build_cycle_id: str) -> dict[str, object] | None:
    connection = get_db()

    return connection.execute(
        "SELECT id, feature_id, iteration, agent_id, status FROM build_cycles WHERE id = ?",
        (build_cycle_id,),
    ).fetchone()


def _serialize_completed_fus(completed_fus: list[str]) -> str:
    return json.dumps(completed_fus)


def _deserialize_completed_fus(value: str) -> list[str]:
    parsed_value = json.loads(value)

    if not isinstance(parsed_value, list):
        raise ValueError("Invalid checkpoint completed_fus payload")

    completed_fus: list[str] = []

    for item in parsed_value:
        if not isinstance(item, str):
            raise ValueError("Invalid checkpoint completed_fus item")

        completed_fus.append(item)

    return completed_fus


def _parse_plan_snapshot(value: str) -> dict[str, object]:
    snapshot = json.loads(value)

    if not isinstance(snapshot, dict):
        raise ValueError("Invalid plan snapshot")

    return snapshot


def _next_iteration(table_name: str, feature_id: str) -> int:
    connection = get_db()
    row = connection.execute(
        f"SELECT MAX(iteration) AS max_iteration FROM {table_name} WHERE feature_id = ?",
        (feature_id,),
    ).fetchone()

    if row is None or row["max_iteration"] is None:
        return 1

    return int(row["max_iteration"]) + 1


def _object_to_int(value: object, field_name: str) -> int:
    if isinstance(value, int):
        return value

    raise ValueError(f"Expected integer for {field_name}")


def _get_feature_dependency_rows(feature_id: str) -> list[str]:
    dependency_map = _feature_dependency_map([feature_id])

    return dependency_map[feature_id]


def create_feature(
    *,
    title: str,
    scope: str,
    out_of_scope: str,
    priority: str,
    depends_on: list[str] | None = None,
) -> FeatureRecord:
    normalized_depends_on = _normalize_depends_on(depends_on)
    validated_priority = _validate_feature_priority(priority)
    connection = get_db()

    for dependency_id in normalized_depends_on:
        if _get_feature_row(dependency_id) is None:
            raise ValueError(f"Unknown feature dependency: {dependency_id}")

    feature_id = (
        f"feature_{_next_counter('features', 'feature')}_{_slugify_title(title)}"
    )

    with connection:
        connection.execute(
            """
            INSERT INTO features (id, title, scope, out_of_scope, status, priority)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (feature_id, title, scope, out_of_scope, "draft", validated_priority),
        )

        for dependency_id in normalized_depends_on:
            connection.execute(
                "INSERT INTO feature_dependencies (feature_id, depends_on) VALUES (?, ?)",
                (feature_id, dependency_id),
            )

    log_status_change(
        entity_type="feature",
        entity_id=feature_id,
        old_status=None,
        new_status="draft",
    )

    feature = get_feature(feature_id)

    if feature is None:
        raise RuntimeError(f"Created feature could not be loaded: {feature_id}")

    return feature


def list_features(status: str | None = None) -> list[FeatureRecord]:
    connection = get_db()

    if status is None:
        rows = connection.execute(
            "SELECT id, title, scope, out_of_scope, status, priority FROM features ORDER BY id ASC"
        ).fetchall()
    else:
        rows = connection.execute(
            "SELECT id, title, scope, out_of_scope, status, priority FROM features WHERE status = ? ORDER BY id ASC",
            (_validate_feature_status(status),),
        ).fetchall()

    feature_ids = [str(row["id"]) for row in rows]
    dependency_map = _feature_dependency_map(feature_ids)

    return [_map_feature_row(row, dependency_map[str(row["id"])]) for row in rows]


def get_feature(feature_id: str) -> FeatureRecord | None:
    row = _get_feature_row(feature_id)

    if row is None:
        return None

    return _map_feature_row(row, _get_feature_dependency_rows(feature_id))


def get_full_feature(feature_id: str) -> FullFeatureRecord | None:
    feature = get_feature(feature_id)

    if feature is None:
        return None

    connection = get_db()
    fu_rows = connection.execute(
        """
        SELECT id, feature_id, title, description, status, assigned_agent, test_evidence, failure_reason
        FROM function_units
        WHERE feature_id = ?
        ORDER BY id ASC
        """,
        (feature_id,),
    ).fetchall()
    fu_ids = [str(row["id"]) for row in fu_rows]
    ac_map: dict[str, list[AcceptanceCriteriaRecord]] = defaultdict(list)
    dependency_map = _fu_dependency_map(fu_ids)

    if fu_ids:
        placeholders = ", ".join("?" for _ in fu_ids)
        ac_rows = connection.execute(
            f"""
            SELECT id, fu_id, description, type, severity, status, verified_in, evidence
            FROM acceptance_criteria
            WHERE fu_id IN ({placeholders})
            ORDER BY id ASC
            """,
            tuple(fu_ids),
        ).fetchall()

        for row in ac_rows:
            mapped = _map_ac_row(row)
            ac_map[mapped["fu_id"]].append(mapped)

    function_units = [
        _map_fu_row(row, ac_map[str(row["id"])], dependency_map[str(row["id"])])
        for row in fu_rows
    ]

    return FullFeatureRecord(**feature, function_units=function_units)


def add_function_unit(
    *, feature_id: str, title: str, description: str
) -> FunctionUnitRecord:
    if get_feature(feature_id) is None:
        raise ValueError(f"Feature not found: {feature_id}")

    function_unit_id = (
        f"fu_{_next_counter('function_units', 'fu')}_{_slugify_title(title)}"
    )
    connection = get_db()

    with connection:
        connection.execute(
            """
            INSERT INTO function_units (id, feature_id, title, description, status)
            VALUES (?, ?, ?, ?, ?)
            """,
            (function_unit_id, feature_id, title, description, "pending"),
        )

    log_status_change(
        entity_type="function_unit",
        entity_id=function_unit_id,
        old_status=None,
        new_status="pending",
    )

    return FunctionUnitRecord(
        id=function_unit_id,
        feature_id=feature_id,
        title=title,
        description=description,
        acceptance_criteria=[],
        depends_on=[],
        status="pending",
        assigned_agent=None,
        test_evidence=None,
        failure_reason=None,
    )


def add_acceptance_criteria(
    *,
    fu_id: str,
    description: str,
    ac_type: str,
    severity: str,
) -> AcceptanceCriteriaRecord:
    validated_type = _validate_ac_type(ac_type)
    validated_severity = _validate_ac_severity(severity)

    if _get_function_unit_row(fu_id) is None:
        raise ValueError(f"Function unit not found: {fu_id}")

    ac_id = f"ac_{_next_counter('acceptance_criteria', 'ac')}"
    connection = get_db()

    with connection:
        connection.execute(
            """
            INSERT INTO acceptance_criteria (id, fu_id, description, type, severity, status, verified_in, evidence)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ac_id,
                fu_id,
                description,
                validated_type,
                validated_severity,
                "not_tested",
                None,
                None,
            ),
        )

    log_status_change(
        entity_type="acceptance_criteria",
        entity_id=ac_id,
        old_status=None,
        new_status="not_tested",
    )

    return _map_ac_row(_get_acceptance_criteria_row(ac_id) or {})


def update_acceptance_criteria(
    *,
    ac_id: str,
    status: str,
    verified_in: str | None = None,
    evidence: str | None = None,
) -> AcceptanceCriteriaRecord:
    validated_status = _validate_ac_status(status)
    row = _get_acceptance_criteria_row(ac_id)

    if row is None:
        raise ValueError(f"Acceptance criteria not found: {ac_id}")

    next_verified_in = verified_in if verified_in is not None else row["verified_in"]
    next_evidence = evidence if evidence is not None else row["evidence"]
    connection = get_db()

    with connection:
        connection.execute(
            """
            UPDATE acceptance_criteria
            SET status = ?, verified_in = ?, evidence = ?
            WHERE id = ?
            """,
            (validated_status, next_verified_in, next_evidence, ac_id),
        )

    log_status_change(
        entity_type="acceptance_criteria",
        entity_id=ac_id,
        old_status=str(row["status"]),
        new_status=validated_status,
        context=None if next_verified_in is None else str(next_verified_in),
    )

    updated_row = _get_acceptance_criteria_row(ac_id)

    if updated_row is None:
        raise RuntimeError(f"Updated acceptance criteria could not be loaded: {ac_id}")

    return _map_ac_row(updated_row)


def start_plan_review(*, feature_id: str) -> PlanCycleRecord:
    feature = get_full_feature(feature_id)

    if feature is None:
        raise ValueError(f"Feature not found: {feature_id}")

    if feature["status"] not in {"draft", "plan_review"}:
        raise ValueError(
            f"Feature must be in draft or plan_review. Current: {feature['status']}"
        )

    connection = get_db()
    active_cycle = connection.execute(
        "SELECT id FROM plan_cycles WHERE feature_id = ? AND status IN ('drafting', 'reviewing')",
        (feature_id,),
    ).fetchone()

    if active_cycle is not None:
        raise ValueError(f"Feature already has an active plan cycle: {feature_id}")

    iteration = _next_iteration("plan_cycles", feature_id)
    plan_cycle_id = f"plan_cycle_{feature_id}_{iteration}"
    snapshot = {
        "captured_at": utc_now_iso(),
        "feature": dict(feature),
        "function_units": feature["function_units"],
    }
    connection = get_db()

    with connection:
        connection.execute(
            "INSERT INTO plan_cycles (id, feature_id, iteration, plan_snapshot, status) VALUES (?, ?, ?, ?, ?)",
            (plan_cycle_id, feature_id, iteration, json.dumps(snapshot), "drafting"),
        )

        log_status_change(
            entity_type="plan_cycle",
            entity_id=plan_cycle_id,
            old_status=None,
            new_status="drafting",
            context="blueprint_start_plan_review",
        )

        connection.execute(
            "UPDATE plan_cycles SET status = ? WHERE id = ?",
            ("reviewing", plan_cycle_id),
        )

        log_status_change(
            entity_type="plan_cycle",
            entity_id=plan_cycle_id,
            old_status="drafting",
            new_status="reviewing",
            context="blueprint_start_plan_review",
        )

        if feature["status"] == "draft":
            next_status = transition_feature_status_from_event(
                feature["status"], "plan_review_started"
            )
            connection.execute(
                "UPDATE features SET status = ? WHERE id = ?",
                (next_status, feature_id),
            )
            log_status_change(
                entity_type="feature",
                entity_id=feature_id,
                old_status="draft",
                new_status=next_status,
                context="blueprint_start_plan_review",
            )

    return get_plan_cycle(plan_cycle_id)


def get_plan_cycle(plan_cycle_id: str) -> PlanCycleRecord:
    row = _get_plan_cycle_row(plan_cycle_id)

    if row is None:
        raise ValueError(f"Plan cycle not found: {plan_cycle_id}")

    return PlanCycleRecord(
        id=str(row["id"]),
        feature_id=str(row["feature_id"]),
        iteration=_object_to_int(row["iteration"], "iteration"),
        plan_snapshot=_parse_plan_snapshot(str(row["plan_snapshot"])),
        status=str(row["status"]),
    )


def start_build(*, feature_id: str, agent_id: str) -> dict[str, object]:
    feature = get_feature(feature_id)

    if feature is None:
        raise ValueError(f"Feature not found: {feature_id}")

    if feature["status"] != "building":
        raise ValueError(
            f"Feature must be in building status. Current: {feature['status']}"
        )

    connection = get_db()
    active_build = connection.execute(
        "SELECT id FROM build_cycles WHERE feature_id = ? AND status IN ('building', 'reviewing')",
        (feature_id,),
    ).fetchone()

    if active_build is not None:
        raise ValueError(f"Feature already has an active build cycle: {feature_id}")

    iteration = _next_iteration("build_cycles", feature_id)
    build_cycle_id = f"build_cycle_{feature_id}_{iteration}"
    session_log_id = f"session_log_{uuid4()}"
    session_id = f"session_{uuid4()}"
    started_at = utc_now_iso()

    with connection:
        connection.execute(
            "INSERT INTO build_cycles (id, feature_id, iteration, agent_id, status) VALUES (?, ?, ?, ?, ?)",
            (build_cycle_id, feature_id, iteration, agent_id, "building"),
        )
        log_status_change(
            entity_type="build_cycle",
            entity_id=build_cycle_id,
            old_status=None,
            new_status="building",
            changed_by=agent_id,
            context=json.dumps(
                {
                    "feature_id": feature_id,
                    "iteration": iteration,
                    "event": "blueprint_start_build",
                }
            ),
        )
        connection.execute(
            "INSERT INTO session_logs (id, build_cycle_id, agent_id, session_id, started_at, ended_at, end_reason) VALUES (?, ?, ?, ?, ?, NULL, NULL)",
            (session_log_id, build_cycle_id, agent_id, session_id, started_at),
        )

    return {
        "build_cycle": get_build_cycle(build_cycle_id),
        "session_log": get_open_session_log(build_cycle_id, agent_id),
    }


def get_build_cycle(build_cycle_id: str) -> BuildCycleRecord:
    row = _get_build_cycle_row(build_cycle_id)

    if row is None:
        raise ValueError(f"Build cycle not found: {build_cycle_id}")

    return BuildCycleRecord(
        id=str(row["id"]),
        feature_id=str(row["feature_id"]),
        iteration=_object_to_int(row["iteration"], "iteration"),
        agent_id=str(row["agent_id"]),
        status=str(row["status"]),
    )


def get_open_session_log(build_cycle_id: str, agent_id: str) -> SessionLogRecord | None:
    connection = get_db()
    row = connection.execute(
        """
        SELECT id, build_cycle_id, agent_id, session_id, started_at, ended_at, end_reason
        FROM session_logs
        WHERE build_cycle_id = ? AND agent_id = ? AND ended_at IS NULL
        ORDER BY started_at DESC, id DESC
        LIMIT 1
        """,
        (build_cycle_id, agent_id),
    ).fetchone()

    if row is None:
        return None

    return SessionLogRecord(
        id=str(row["id"]),
        build_cycle_id=str(row["build_cycle_id"]),
        agent_id=str(row["agent_id"]),
        session_id=str(row["session_id"]),
        started_at=str(row["started_at"]),
        ended_at=None if row["ended_at"] is None else str(row["ended_at"]),
        end_reason=None if row["end_reason"] is None else str(row["end_reason"]),
    )


def submit_build_for_review(*, build_cycle_id: str) -> dict[str, object]:
    build_cycle = get_build_cycle(build_cycle_id)

    if build_cycle["status"] != "building":
        raise ValueError(
            f"Build cycle must be in building status. Current: {build_cycle['status']}"
        )

    feature = get_feature(build_cycle["feature_id"])

    if feature is None:
        raise ValueError(f"Feature not found: {build_cycle['feature_id']}")

    if feature["status"] != "building":
        raise ValueError(
            f"Feature must be in building status. Current: {feature['status']}"
        )

    full_feature = get_full_feature(feature["id"])

    if full_feature is None:
        raise ValueError(f"Feature not found: {feature['id']}")

    incomplete_fus = [
        fu["id"] for fu in full_feature["function_units"] if fu["status"] != "passed"
    ]
    if incomplete_fus:
        raise ValueError(
            f"Cannot submit build cycle for review until all function units are passed. Incomplete: {', '.join(incomplete_fus)}"
        )

    connection = get_db()
    active_work_lock_count = connection.execute(
        """
        SELECT COUNT(*) AS count
        FROM work_locks
        INNER JOIN function_units ON function_units.id = work_locks.fu_id
        WHERE function_units.feature_id = ? AND work_locks.status = ?
        """,
        (feature["id"], "active"),
    ).fetchone()
    if (
        active_work_lock_count is not None
        and _object_to_int(active_work_lock_count["count"], "count") > 0
    ):
        raise ValueError(
            "Cannot submit build cycle for review while active work locks remain on the feature."
        )

    audit_context = json.dumps(
        {
            "event": "blueprint_submit_for_review",
            "build_cycle_id": build_cycle_id,
            "feature_id": feature["id"],
        }
    )

    with connection:
        connection.execute(
            "UPDATE build_cycles SET status = ? WHERE id = ?",
            ("reviewing", build_cycle_id),
        )
        log_status_change(
            entity_type="build_cycle",
            entity_id=build_cycle_id,
            old_status="building",
            new_status="reviewing",
            context=audit_context,
        )
        connection.execute(
            "UPDATE session_logs SET ended_at = ?, end_reason = ? WHERE build_cycle_id = ? AND ended_at IS NULL",
            (utc_now_iso(), "done", build_cycle_id),
        )
        next_status = transition_feature_status_from_event(
            feature["status"], "build_review_started"
        )
        connection.execute(
            "UPDATE features SET status = ? WHERE id = ?",
            (next_status, feature["id"]),
        )
        log_status_change(
            entity_type="feature",
            entity_id=feature["id"],
            old_status=feature["status"],
            new_status=next_status,
            context=audit_context,
        )

    return {
        "build_cycle": get_build_cycle(build_cycle_id),
        "feature": get_feature(feature["id"]),
    }


def add_issue(
    *,
    parent_type: str,
    parent_id: str,
    fu_id: str,
    category: str,
    title: str,
    description: str,
    severity: str | None = None,
    ac_id: str | None = None,
    related_fu_id: str | None = None,
    suggested_fix: str | None = None,
) -> IssueRecord:
    validated_parent_type = _validate_issue_parent_type(parent_type)
    validated_category = _validate_issue_category(category)

    if severity is None:
        if validated_category in {
            "integration_conflict",
            "race_condition",
            "interface_mismatch",
        }:
            validated_severity = "critical"
        else:
            raise ValueError(f"severity is required for category {validated_category}")
    else:
        validated_severity = _validate_issue_severity(severity)

    function_unit = _get_function_unit_row(fu_id)
    if function_unit is None:
        raise ValueError(f"Function unit not found: {fu_id}")

    if ac_id is not None:
        acceptance_criteria = _get_acceptance_criteria_row(ac_id)
        if acceptance_criteria is None:
            raise ValueError(f"Acceptance criteria not found: {ac_id}")
        if str(acceptance_criteria["fu_id"]) != fu_id:
            raise ValueError(
                f"Acceptance criteria {ac_id} does not belong to function unit {fu_id}"
            )

    if related_fu_id is not None and _get_function_unit_row(related_fu_id) is None:
        raise ValueError(f"Function unit not found: {related_fu_id}")

    if validated_category == "integration_conflict" and related_fu_id is None:
        raise ValueError("related_fu_id is required for integration_conflict issues")

    issue_id = f"issue_{_next_counter('issues', 'issue')}"
    connection = get_db()

    with connection:
        connection.execute(
            """
            INSERT INTO issues (id, parent_type, parent_id, fu_id, ac_id, related_fu_id, category, severity, title,
                                description, suggested_fix, status, resolved_in, resolution_note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                issue_id,
                validated_parent_type,
                parent_id,
                fu_id,
                ac_id,
                related_fu_id,
                validated_category,
                validated_severity,
                title,
                description,
                suggested_fix,
                "open",
                None,
                None,
            ),
        )

    issue = _get_issue_row(issue_id)
    if issue is None:
        raise RuntimeError(f"Created issue could not be loaded: {issue_id}")

    return _map_issue_row(issue)


def resolve_issue(
    *,
    issue_id: str,
    status: str,
    resolved_in: str,
    resolution_note: str | None = None,
) -> IssueRecord:
    validated_status = _validate_issue_status(status)
    if validated_status not in {"resolved", "wont_fix"}:
        raise ValueError(
            f"Issue status must be resolved or wont_fix. Received: {status}"
        )

    issue = _get_issue_row(issue_id)
    if issue is None:
        raise ValueError(f"Issue not found: {issue_id}")

    connection = get_db()
    with connection:
        connection.execute(
            "UPDATE issues SET status = ?, resolved_in = ?, resolution_note = ? WHERE id = ?",
            (validated_status, resolved_in, resolution_note, issue_id),
        )

    updated_issue = _get_issue_row(issue_id)
    if updated_issue is None:
        raise RuntimeError(f"Updated issue could not be loaded: {issue_id}")

    return _map_issue_row(updated_issue)


def list_issues(
    *,
    feature_id: str | None = None,
    status: str | None = None,
    severity: str | None = None,
    category: str | list[str] | None = None,
) -> list[IssueRecord]:
    where_clauses: list[str] = []
    parameters: list[str] = []

    if feature_id is not None:
        where_clauses.append("function_units.feature_id = ?")
        parameters.append(feature_id)

    if status is not None:
        where_clauses.append("issues.status = ?")
        parameters.append(_validate_issue_status(status))

    if severity is not None:
        where_clauses.append("issues.severity = ?")
        parameters.append(_validate_issue_severity(severity))

    categories: list[str] = []
    if isinstance(category, str):
        categories = [_validate_issue_category(category)]
    elif category is not None:
        categories = [_validate_issue_category(item) for item in category]

    if categories:
        placeholders = ", ".join("?" for _ in categories)
        where_clauses.append(f"issues.category IN ({placeholders})")
        parameters.extend(categories)

    where_sql = ""
    if where_clauses:
        where_sql = f"WHERE {' AND '.join(where_clauses)}"

    connection = get_db()
    rows = connection.execute(
        f"""
        SELECT issues.id, issues.parent_type, issues.parent_id, issues.fu_id, issues.ac_id, issues.related_fu_id,
               issues.category, issues.severity, issues.title, issues.description, issues.suggested_fix,
               issues.status, issues.resolved_in, issues.resolution_note
        FROM issues
        INNER JOIN function_units ON function_units.id = issues.fu_id
        {where_sql}
        ORDER BY issues.id ASC
        """,
        tuple(parameters),
    ).fetchall()

    return [_map_issue_row(row) for row in rows]


def approve_plan(*, plan_cycle_id: str) -> dict[str, object]:
    plan_cycle = get_plan_cycle(plan_cycle_id)
    if plan_cycle["status"] != "reviewing":
        raise ValueError(
            f"Plan cycle must be in reviewing status. Current: {plan_cycle['status']}"
        )

    feature = get_full_feature(plan_cycle["feature_id"])
    if feature is None:
        raise ValueError(f"Feature not found: {plan_cycle['feature_id']}")
    if feature["status"] != "plan_review":
        raise ValueError(
            f"Feature must be in plan_review status. Current: {feature['status']}"
        )

    plan_issues = [
        {
            "id": issue["id"],
            "title": issue["title"],
            "severity": issue["severity"],
            "status": issue["status"],
        }
        for issue in list_issues()
        if issue["parent_type"] == "plan" and issue["parent_id"] == plan_cycle_id
    ]
    gate = evaluate_plan_approval_gate(
        {
            "id": feature["id"],
            "out_of_scope": feature["out_of_scope"],
            "function_units": [
                {
                    "id": fu["id"],
                    "title": fu["title"],
                    "acceptance_criteria": [
                        {"id": ac["id"], "severity": ac["severity"]}
                        for ac in fu["acceptance_criteria"]
                    ],
                }
                for fu in feature["function_units"]
            ],
        },
        plan_issues,
    )
    if not gate["passed"]:
        raise ValueError(
            json.dumps(
                {
                    "message": "Plan approval gate failed.",
                    "plan_cycle_id": plan_cycle_id,
                    "feature_id": feature["id"],
                    "failures": gate["failures"],
                },
                indent=2,
            )
        )

    connection = get_db()
    with connection:
        connection.execute(
            "UPDATE plan_cycles SET status = ? WHERE id = ?",
            ("approved", plan_cycle_id),
        )
        log_status_change(
            entity_type="plan_cycle",
            entity_id=plan_cycle_id,
            old_status="reviewing",
            new_status="approved",
            context="blueprint_approve_plan",
        )
        next_status = transition_feature_status_from_event(
            feature["status"], "plan_approved"
        )
        connection.execute(
            "UPDATE features SET status = ? WHERE id = ?", (next_status, feature["id"])
        )
        log_status_change(
            entity_type="feature",
            entity_id=feature["id"],
            old_status=feature["status"],
            new_status=next_status,
            context="blueprint_approve_plan",
        )

    return {
        "plan_cycle_id": plan_cycle_id,
        "plan_cycle_status": "approved",
        "feature_id": feature["id"],
        "feature_status": next_status,
        "gate": gate,
    }


def reject_plan(*, plan_cycle_id: str) -> dict[str, object]:
    plan_cycle = get_plan_cycle(plan_cycle_id)
    if plan_cycle["status"] != "reviewing":
        raise ValueError(
            f"Plan cycle must be in reviewing status. Current: {plan_cycle['status']}"
        )

    feature = get_full_feature(plan_cycle["feature_id"])
    if feature is None:
        raise ValueError(f"Feature not found: {plan_cycle['feature_id']}")

    plan_issues = [
        {
            "id": issue["id"],
            "title": issue["title"],
            "severity": issue["severity"],
            "status": issue["status"],
        }
        for issue in list_issues()
        if issue["parent_type"] == "plan" and issue["parent_id"] == plan_cycle_id
    ]
    gate = evaluate_plan_approval_gate(
        {
            "id": feature["id"],
            "out_of_scope": feature["out_of_scope"],
            "function_units": [
                {
                    "id": fu["id"],
                    "title": fu["title"],
                    "acceptance_criteria": [
                        {"id": ac["id"], "severity": ac["severity"]}
                        for ac in fu["acceptance_criteria"]
                    ],
                }
                for fu in feature["function_units"]
            ],
        },
        plan_issues,
    )

    connection = get_db()
    with connection:
        connection.execute(
            "UPDATE plan_cycles SET status = ? WHERE id = ?",
            ("rejected", plan_cycle_id),
        )
        log_status_change(
            entity_type="plan_cycle",
            entity_id=plan_cycle_id,
            old_status="reviewing",
            new_status="rejected",
            context="blueprint_reject_plan",
        )

    return {
        "plan_cycle_id": plan_cycle_id,
        "plan_cycle_status": "rejected",
        "feature_id": feature["id"],
        "feature_status": feature["status"],
        "gate": gate,
    }


def approve_build(*, build_cycle_id: str) -> dict[str, object]:
    build_cycle = get_build_cycle(build_cycle_id)
    if build_cycle["status"] != "reviewing":
        raise ValueError(
            f"Build cycle must be in reviewing status. Current: {build_cycle['status']}"
        )

    feature = get_full_feature(build_cycle["feature_id"])
    if feature is None:
        raise ValueError(f"Feature not found: {build_cycle['feature_id']}")
    if feature["status"] != "build_review":
        raise ValueError(
            f"Feature must be in build_review status. Current: {feature['status']}"
        )

    build_issues = [
        {
            "id": issue["id"],
            "fu_id": issue["fu_id"],
            "title": issue["title"],
            "severity": issue["severity"],
            "status": issue["status"],
        }
        for issue in list_issues()
        if issue["parent_type"] == "build" and issue["parent_id"] == build_cycle_id
    ]
    connection = get_db()
    work_lock_rows = connection.execute(
        """
        SELECT work_locks.id, work_locks.fu_id, work_locks.agent_id
        FROM work_locks
        INNER JOIN function_units ON function_units.id = work_locks.fu_id
        WHERE function_units.feature_id = ? AND work_locks.status = ?
        ORDER BY work_locks.id ASC
        """,
        (feature["id"], "active"),
    ).fetchall()
    active_work_locks = [
        {
            "id": str(row["id"]),
            "fu_id": str(row["fu_id"]),
            "agent_id": str(row["agent_id"]),
        }
        for row in work_lock_rows
    ]
    gate = evaluate_build_approval_gate(
        {
            "id": feature["id"],
            "function_units": [
                {
                    "id": fu["id"],
                    "title": fu["title"],
                    "status": fu["status"],
                    "acceptance_criteria": [
                        {
                            "id": ac["id"],
                            "description": ac["description"],
                            "severity": ac["severity"],
                            "status": ac["status"],
                        }
                        for ac in fu["acceptance_criteria"]
                    ],
                }
                for fu in feature["function_units"]
            ],
        },
        build_issues,
        active_work_locks,
    )
    if not gate["passed"]:
        raise ValueError(
            json.dumps(
                {
                    "message": "Build approval gate failed.",
                    "build_cycle_id": build_cycle_id,
                    "feature_id": feature["id"],
                    "failures": gate["failures"],
                },
                indent=2,
            )
        )

    with connection:
        connection.execute(
            "UPDATE build_cycles SET status = ? WHERE id = ?",
            ("approved", build_cycle_id),
        )
        log_status_change(
            entity_type="build_cycle",
            entity_id=build_cycle_id,
            old_status="reviewing",
            new_status="approved",
            context="blueprint_approve_build",
        )
        next_status = transition_feature_status_from_event(
            feature["status"],
            "build_approved",
            has_approved_build_cycle=True,
            has_blocking_open_issues=False,
        )
        connection.execute(
            "UPDATE features SET status = ? WHERE id = ?", (next_status, feature["id"])
        )
        log_status_change(
            entity_type="feature",
            entity_id=feature["id"],
            old_status=feature["status"],
            new_status=next_status,
            context="blueprint_approve_build",
        )

    return {
        "build_cycle_id": build_cycle_id,
        "build_cycle_status": "approved",
        "feature_id": feature["id"],
        "feature_status": next_status,
        "gate": gate,
    }


def reject_build(*, build_cycle_id: str) -> dict[str, object]:
    build_cycle = get_build_cycle(build_cycle_id)
    if build_cycle["status"] != "reviewing":
        raise ValueError(
            f"Build cycle must be in reviewing status. Current: {build_cycle['status']}"
        )

    feature = get_full_feature(build_cycle["feature_id"])
    if feature is None:
        raise ValueError(f"Feature not found: {build_cycle['feature_id']}")

    build_issues = [
        {
            "id": issue["id"],
            "fu_id": issue["fu_id"],
            "title": issue["title"],
            "severity": issue["severity"],
            "status": issue["status"],
        }
        for issue in list_issues()
        if issue["parent_type"] == "build" and issue["parent_id"] == build_cycle_id
    ]
    connection = get_db()
    work_lock_rows = connection.execute(
        """
        SELECT work_locks.id, work_locks.fu_id, work_locks.agent_id
        FROM work_locks
        INNER JOIN function_units ON function_units.id = work_locks.fu_id
        WHERE function_units.feature_id = ? AND work_locks.status = ?
        ORDER BY work_locks.id ASC
        """,
        (feature["id"], "active"),
    ).fetchall()
    active_work_locks = [
        {
            "id": str(row["id"]),
            "fu_id": str(row["fu_id"]),
            "agent_id": str(row["agent_id"]),
        }
        for row in work_lock_rows
    ]
    gate = evaluate_build_approval_gate(
        {
            "id": feature["id"],
            "function_units": [
                {
                    "id": fu["id"],
                    "title": fu["title"],
                    "status": fu["status"],
                    "acceptance_criteria": [
                        {
                            "id": ac["id"],
                            "description": ac["description"],
                            "severity": ac["severity"],
                            "status": ac["status"],
                        }
                        for ac in fu["acceptance_criteria"]
                    ],
                }
                for fu in feature["function_units"]
            ],
        },
        build_issues,
        active_work_locks,
    )

    reset_function_units: list[dict[str, object]] = []
    blocking_fu_ids: set[str] = set()
    for issue in build_issues:
        if issue["severity"] in {"critical", "major"} and issue["status"] != "resolved":
            blocking_fu_ids.add(str(issue["fu_id"]))
    for fu in feature["function_units"]:
        if fu["status"] == "failed":
            blocking_fu_ids.add(fu["id"])

    with connection:
        for fu in feature["function_units"]:
            if fu["id"] not in blocking_fu_ids:
                continue
            old_status = fu["status"]
            connection.execute(
                "UPDATE function_units SET status = ? WHERE id = ?",
                ("pending", fu["id"]),
            )
            log_status_change(
                entity_type="function_unit",
                entity_id=fu["id"],
                old_status=old_status,
                new_status="pending",
                context=json.dumps(
                    {
                        "event": "blueprint_reject_build",
                        "build_cycle_id": build_cycle_id,
                    }
                ),
            )
            reset_function_units.append(
                {
                    "fu_id": fu["id"],
                    "title": fu["title"],
                    "old_status": old_status,
                    "new_status": "pending",
                }
            )

        connection.execute(
            "UPDATE build_cycles SET status = ? WHERE id = ?",
            ("rejected", build_cycle_id),
        )
        log_status_change(
            entity_type="build_cycle",
            entity_id=build_cycle_id,
            old_status="reviewing",
            new_status="rejected",
            context="blueprint_reject_build",
        )
        next_status = transition_feature_status_from_event(
            feature["status"], "build_rejected"
        )
        connection.execute(
            "UPDATE features SET status = ? WHERE id = ?", (next_status, feature["id"])
        )
        log_status_change(
            entity_type="feature",
            entity_id=feature["id"],
            old_status=feature["status"],
            new_status=next_status,
            context="blueprint_reject_build",
        )

    return {
        "build_cycle_id": build_cycle_id,
        "build_cycle_status": "rejected",
        "feature_id": feature["id"],
        "feature_status": "building",
        "gate": gate,
        "reset_function_units": reset_function_units,
    }


def add_dependency(
    *, fu_id: str, depends_on_fu_id: str, dependency_type: str
) -> dict[str, str]:
    validated_dependency_type = _require_in_set(
        dependency_type, FUNCTION_UNIT_DEPENDENCY_TYPES, "dependency type"
    )
    function_unit = _get_function_unit_row(fu_id)
    prerequisite = _get_function_unit_row(depends_on_fu_id)

    if function_unit is None:
        raise ValueError(f"Function unit not found: {fu_id}")

    if prerequisite is None:
        raise ValueError(f"Function unit not found: {depends_on_fu_id}")

    if str(function_unit["feature_id"]) != str(prerequisite["feature_id"]):
        raise ValueError("Cannot add dependency across features")

    if fu_id == depends_on_fu_id:
        raise ValueError("Function unit cannot depend on itself")

    connection = get_db()
    existing = connection.execute(
        "SELECT fu_id FROM fu_dependencies WHERE fu_id = ? AND depends_on_fu_id = ?",
        (fu_id, depends_on_fu_id),
    ).fetchone()
    if existing is not None:
        raise ValueError(
            f"Dependency already exists: {fu_id} depends on {depends_on_fu_id}"
        )

    with connection:
        connection.execute(
            "INSERT INTO fu_dependencies (fu_id, depends_on_fu_id, type) VALUES (?, ?, ?)",
            (fu_id, depends_on_fu_id, validated_dependency_type),
        )

    return {
        "fu_id": fu_id,
        "depends_on_fu_id": depends_on_fu_id,
        "type": validated_dependency_type,
    }


def add_merge_point(
    *, feature_id: str, trigger_fus: list[str], merged_fu: str
) -> dict[str, object]:
    normalized_trigger_fus = _normalize_depends_on(trigger_fus)
    if not normalized_trigger_fus:
        raise ValueError("trigger_fus must contain at least one function unit")

    merged_function_unit = _get_function_unit_row(merged_fu)
    if merged_function_unit is None:
        raise ValueError(f"Function unit not found: {merged_fu}")
    if str(merged_function_unit["feature_id"]) != feature_id:
        raise ValueError(
            f"Merged function unit {merged_fu} does not belong to feature {feature_id}"
        )

    for trigger_fu in normalized_trigger_fus:
        trigger_function_unit = _get_function_unit_row(trigger_fu)
        if trigger_function_unit is None:
            raise ValueError(f"Function unit not found: {trigger_fu}")
        if str(trigger_function_unit["feature_id"]) != feature_id:
            raise ValueError(
                f"Trigger function unit {trigger_fu} does not belong to feature {feature_id}"
            )

    merge_point_id = (
        f"merge_point_{feature_id}_{len(list_merge_points(feature_id)) + 1}"
    )
    connection = get_db()
    with connection:
        connection.execute(
            "INSERT INTO merge_points (id, feature_id, trigger_fus, merged_fu, status) VALUES (?, ?, ?, ?, ?)",
            (
                merge_point_id,
                feature_id,
                json.dumps(normalized_trigger_fus),
                merged_fu,
                "waiting",
            ),
        )

    return get_merge_point(merge_point_id)


def get_merge_point(merge_point_id: str) -> dict[str, object]:
    connection = get_db()
    row = connection.execute(
        "SELECT id, feature_id, trigger_fus, merged_fu, status FROM merge_points WHERE id = ?",
        (merge_point_id,),
    ).fetchone()
    if row is None:
        raise ValueError(f"Merge point not found: {merge_point_id}")

    trigger_fus_value = json.loads(str(row["trigger_fus"]))
    if not isinstance(trigger_fus_value, list):
        raise ValueError("Invalid merge point trigger_fus")

    return {
        "id": str(row["id"]),
        "feature_id": str(row["feature_id"]),
        "trigger_fus": [str(item) for item in trigger_fus_value],
        "merged_fu": str(row["merged_fu"]),
        "status": str(row["status"]),
    }


def list_merge_points(feature_id: str) -> list[dict[str, object]]:
    connection = get_db()
    rows = connection.execute(
        "SELECT id FROM merge_points WHERE feature_id = ? ORDER BY id ASC",
        (feature_id,),
    ).fetchall()

    return [get_merge_point(str(row["id"])) for row in rows]


def check_merge_ready(*, merge_point_id: str) -> dict[str, object]:
    merge_point = get_merge_point(merge_point_id)
    pending_trigger_fus: list[str] = []
    trigger_fus_value = merge_point["trigger_fus"]

    if not isinstance(trigger_fus_value, list):
        raise ValueError("Invalid merge point trigger_fus")

    for trigger_fu in trigger_fus_value:
        function_unit = _get_function_unit_row(str(trigger_fu))
        if function_unit is None or str(function_unit["status"]) != "passed":
            pending_trigger_fus.append(str(trigger_fu))

    ready = len(pending_trigger_fus) == 0
    if ready and str(merge_point["status"]) == "waiting":
        connection = get_db()
        with connection:
            connection.execute(
                "UPDATE merge_points SET status = ? WHERE id = ?",
                ("ready", merge_point_id),
            )
        merge_point = get_merge_point(merge_point_id)

    return {
        "merge_point": merge_point,
        "ready": ready,
        "pending_trigger_fus": pending_trigger_fus,
    }


def _parse_iso_timestamp(value: str) -> float:
    return datetime.fromisoformat(value).timestamp()


def expire_stale_work_locks() -> int:
    connection = get_db()
    rows = connection.execute(
        "SELECT id, heartbeat_at, ttl_seconds, status FROM work_locks WHERE status = ? ORDER BY heartbeat_at ASC, id ASC",
        ("active",),
    ).fetchall()
    now = utc_now_iso()
    now_ts = _parse_iso_timestamp(now)
    expired_count = 0

    for row in rows:
        heartbeat_at = str(row["heartbeat_at"])
        ttl_seconds = _object_to_int(row["ttl_seconds"], "ttl_seconds")
        if now_ts - _parse_iso_timestamp(heartbeat_at) <= ttl_seconds:
            continue

        with connection:
            connection.execute(
                "UPDATE work_locks SET status = ?, released_at = ?, release_reason = ? WHERE id = ? AND status = ?",
                ("expired", now, "watchdog_timeout", str(row["id"]), "active"),
            )
        expired_count += 1

    return expired_count


def get_work_lock(lock_id: str) -> dict[str, object] | None:
    connection = get_db()
    row = connection.execute(
        "SELECT id, fu_id, agent_id, acquired_at, heartbeat_at, released_at, release_reason, ttl_seconds, status FROM work_locks WHERE id = ?",
        (lock_id,),
    ).fetchone()
    if row is None:
        return None

    return {
        "id": str(row["id"]),
        "fu_id": str(row["fu_id"]),
        "agent_id": str(row["agent_id"]),
        "acquired_at": str(row["acquired_at"]),
        "heartbeat_at": str(row["heartbeat_at"]),
        "released_at": None if row["released_at"] is None else str(row["released_at"]),
        "release_reason": None
        if row["release_reason"] is None
        else str(row["release_reason"]),
        "ttl_seconds": _object_to_int(row["ttl_seconds"], "ttl_seconds"),
        "status": str(row["status"]),
    }


def heartbeat(*, lock_id: str, agent_id: str) -> dict[str, object]:
    expire_stale_work_locks()
    work_lock = get_work_lock(lock_id)
    if work_lock is None or str(work_lock["status"]) != "active":
        raise ValueError(f"Lock {lock_id} is no longer active")
    if str(work_lock["agent_id"]) != agent_id:
        raise ValueError(
            f"Lock {lock_id} is owned by {work_lock['agent_id']}, not {agent_id}"
        )

    connection = get_db()
    with connection:
        connection.execute(
            "UPDATE work_locks SET heartbeat_at = ? WHERE id = ? AND status = ?",
            (utc_now_iso(), lock_id, "active"),
        )

    updated_work_lock = get_work_lock(lock_id)
    if updated_work_lock is None:
        raise RuntimeError(f"Lock {lock_id} could not be loaded after heartbeat")

    return updated_work_lock


def release_lock(
    *, lock_id: str, agent_id: str, reason: str | None = None
) -> dict[str, object]:
    expire_stale_work_locks()
    work_lock = get_work_lock(lock_id)
    if work_lock is None or str(work_lock["status"]) != "active":
        raise ValueError(f"Lock {lock_id} is no longer active")
    if str(work_lock["agent_id"]) != agent_id:
        raise ValueError(
            f"Lock {lock_id} is owned by {work_lock['agent_id']}, not {agent_id}"
        )

    connection = get_db()
    with connection:
        connection.execute(
            "UPDATE work_locks SET status = ?, released_at = ?, release_reason = ? WHERE id = ? AND status = ?",
            ("released", utc_now_iso(), reason, lock_id, "active"),
        )

    updated_work_lock = get_work_lock(lock_id)
    if updated_work_lock is None:
        raise RuntimeError(f"Lock {lock_id} could not be loaded after release")

    return updated_work_lock


def get_checkpoint(build_cycle_id: str, agent_id: str) -> CheckpointRecord | None:
    connection = get_db()
    row = connection.execute(
        "SELECT id, build_cycle_id, agent_id, completed_fus, next_fu, notes FROM checkpoints WHERE build_cycle_id = ? AND agent_id = ?",
        (build_cycle_id, agent_id),
    ).fetchone()
    if row is None:
        return None

    return CheckpointRecord(
        id=str(row["id"]),
        build_cycle_id=str(row["build_cycle_id"]),
        agent_id=str(row["agent_id"]),
        completed_fus=_deserialize_completed_fus(str(row["completed_fus"])),
        next_fu=None if row["next_fu"] is None else str(row["next_fu"]),
        notes=None if row["notes"] is None else str(row["notes"]),
    )


def checkpoint(
    *,
    build_cycle_id: str,
    agent_id: str,
    completed_fu: str | None = None,
    next_fu: str | None = None,
    notes: str | None = None,
) -> CheckpointRecord:
    existing_checkpoint = get_checkpoint(build_cycle_id, agent_id)
    completed_fus = (
        []
        if existing_checkpoint is None
        else list(existing_checkpoint["completed_fus"])
    )
    if completed_fu is not None and completed_fu not in completed_fus:
        completed_fus.append(completed_fu)

    checkpoint_id = (
        existing_checkpoint["id"]
        if existing_checkpoint is not None
        else f"checkpoint_{uuid4()}"
    )
    connection = get_db()
    with connection:
        connection.execute(
            "INSERT OR REPLACE INTO checkpoints (id, build_cycle_id, agent_id, completed_fus, next_fu, notes) VALUES (?, ?, ?, ?, ?, ?)",
            (
                checkpoint_id,
                build_cycle_id,
                agent_id,
                _serialize_completed_fus(completed_fus),
                next_fu,
                notes,
            ),
        )

    checkpoint_row = get_checkpoint(build_cycle_id, agent_id)
    if checkpoint_row is None:
        raise RuntimeError("Checkpoint could not be loaded after write")

    return checkpoint_row


def complete_fu(
    *, build_cycle_id: str, fu_id: str, agent_id: str, evidence: str
) -> FunctionUnitRecord:
    function_unit = _get_function_unit_row(fu_id)
    if function_unit is None:
        raise ValueError(f"Function unit not found: {fu_id}")

    connection = get_db()
    with connection:
        connection.execute(
            "UPDATE function_units SET status = ?, assigned_agent = ?, test_evidence = ?, failure_reason = NULL WHERE id = ?",
            ("passed", agent_id, evidence, fu_id),
        )
        log_status_change(
            entity_type="function_unit",
            entity_id=fu_id,
            old_status=str(function_unit["status"]),
            new_status="passed",
            changed_by=agent_id,
            context=json.dumps(
                {"event": "blueprint_complete_fu", "build_cycle_id": build_cycle_id}
            ),
        )
        for merge_point in list_merge_points(str(function_unit["feature_id"])):
            if str(merge_point["merged_fu"]) == fu_id:
                connection.execute(
                    "UPDATE merge_points SET status = ? WHERE id = ?",
                    ("passed", str(merge_point["id"])),
                )

    updated_function_unit = _get_function_unit_row(fu_id)
    if updated_function_unit is None:
        raise RuntimeError(
            f"Function unit could not be loaded after completion: {fu_id}"
        )

    return _map_fu_row(updated_function_unit, [], _fu_dependency_map([fu_id])[fu_id])


def fail_fu(*, fu_id: str, reason: str) -> FunctionUnitRecord:
    function_unit = _get_function_unit_row(fu_id)
    if function_unit is None:
        raise ValueError(f"Function unit not found: {fu_id}")

    connection = get_db()
    with connection:
        connection.execute(
            "UPDATE function_units SET status = ?, failure_reason = ? WHERE id = ?",
            ("failed", reason, fu_id),
        )
        log_status_change(
            entity_type="function_unit",
            entity_id=fu_id,
            old_status=str(function_unit["status"]),
            new_status="failed",
            context=json.dumps({"event": "blueprint_fail_fu", "reason": reason}),
        )
        for merge_point in list_merge_points(str(function_unit["feature_id"])):
            if str(merge_point["merged_fu"]) == fu_id:
                connection.execute(
                    "UPDATE merge_points SET status = ? WHERE id = ?",
                    ("failed", str(merge_point["id"])),
                )

    updated_function_unit = _get_function_unit_row(fu_id)
    if updated_function_unit is None:
        raise RuntimeError(f"Function unit could not be loaded after failure: {fu_id}")

    return _map_fu_row(updated_function_unit, [], _fu_dependency_map([fu_id])[fu_id])


def get_available_work(*, agent_id: str) -> dict[str, object] | None:
    expire_stale_work_locks()
    connection = get_db()
    existing_lock = connection.execute(
        "SELECT id, fu_id FROM work_locks WHERE agent_id = ? AND status = ? ORDER BY acquired_at DESC, id DESC LIMIT 1",
        (agent_id, "active"),
    ).fetchone()
    if existing_lock is not None:
        function_unit = _get_function_unit_row(str(existing_lock["fu_id"]))
        if function_unit is not None:
            active_build = connection.execute(
                "SELECT id FROM build_cycles WHERE feature_id = ? AND status = ? ORDER BY iteration DESC LIMIT 1",
                (str(function_unit["feature_id"]), "building"),
            ).fetchone()
            if active_build is not None:
                return {
                    "build_cycle_id": str(active_build["id"]),
                    "lock_id": str(existing_lock["id"]),
                    "fu": _map_fu_row(
                        function_unit,
                        [],
                        _fu_dependency_map([str(function_unit["id"])])[
                            str(function_unit["id"])
                        ],
                    ),
                    "work_lock": get_work_lock(str(existing_lock["id"])),
                }

    candidate_rows = connection.execute(
        """
        SELECT DISTINCT features.id AS feature_id
        FROM features
        INNER JOIN build_cycles ON build_cycles.feature_id = features.id
        WHERE build_cycles.status = 'building'
        ORDER BY CASE features.priority WHEN 'p0' THEN 0 WHEN 'p1' THEN 1 WHEN 'p2' THEN 2 ELSE 3 END ASC,
                 build_cycles.iteration ASC,
                 features.id ASC
        """
    ).fetchall()

    for candidate_row in candidate_rows:
        feature_id = str(candidate_row["feature_id"])
        full_feature = get_full_feature(feature_id)
        if full_feature is None:
            continue
        blocked_merged_fus = {
            str(item["merged_fu"])
            for item in list_merge_points(feature_id)
            if str(item["status"]) in {"waiting", "failed"}
        }
        locked_rows = connection.execute(
            """
            SELECT work_locks.fu_id
            FROM work_locks
            INNER JOIN function_units ON function_units.id = work_locks.fu_id
            WHERE function_units.feature_id = ? AND work_locks.status = ?
            """,
            (feature_id, "active"),
        ).fetchall()
        locked_fus = {str(row["fu_id"]) for row in locked_rows}

        for function_unit in full_feature["function_units"]:
            if (
                function_unit["id"] in blocked_merged_fus
                or function_unit["id"] in locked_fus
            ):
                continue
            if function_unit["status"] in {"passed", "failed"}:
                continue
            dependencies_satisfied = True
            for dependency in function_unit["depends_on"]:
                dependency_fu = _get_function_unit_row(dependency["fu_id"])
                if dependency_fu is None:
                    dependencies_satisfied = False
                    break
                if (
                    dependency["type"] == "hard"
                    and str(dependency_fu["status"]) != "passed"
                ):
                    dependencies_satisfied = False
                    break
            if not dependencies_satisfied:
                continue

            active_build = connection.execute(
                "SELECT id FROM build_cycles WHERE feature_id = ? AND status = ? ORDER BY iteration DESC LIMIT 1",
                (feature_id, "building"),
            ).fetchone()
            if active_build is None:
                continue

            lock_id = f"work_lock_{uuid4()}"
            now = utc_now_iso()
            with connection:
                connection.execute(
                    "INSERT INTO work_locks (id, fu_id, agent_id, acquired_at, heartbeat_at, released_at, release_reason, ttl_seconds, status) VALUES (?, ?, ?, ?, ?, NULL, NULL, 300, ?)",
                    (lock_id, function_unit["id"], agent_id, now, now, "active"),
                )
                connection.execute(
                    "UPDATE function_units SET status = ?, assigned_agent = ? WHERE id = ?",
                    ("in_progress", agent_id, function_unit["id"]),
                )
                if function_unit["status"] != "in_progress":
                    log_status_change(
                        entity_type="function_unit",
                        entity_id=function_unit["id"],
                        old_status=function_unit["status"],
                        new_status="in_progress",
                        changed_by=agent_id,
                        context=json.dumps(
                            {
                                "event": "blueprint_get_available_work",
                                "build_cycle_id": str(active_build["id"]),
                            }
                        ),
                    )

            refreshed_function_unit = _get_function_unit_row(function_unit["id"])
            if refreshed_function_unit is None:
                raise RuntimeError(
                    f"Assigned function unit could not be loaded: {function_unit['id']}"
                )

            return {
                "build_cycle_id": str(active_build["id"]),
                "lock_id": lock_id,
                "fu": _map_fu_row(
                    refreshed_function_unit,
                    function_unit["acceptance_criteria"],
                    function_unit["depends_on"],
                ),
                "work_lock": get_work_lock(lock_id),
            }

    return None


def get_parallel_status(*, feature_id: str) -> dict[str, object]:
    expire_stale_work_locks()
    full_feature = get_full_feature(feature_id)
    if full_feature is None:
        raise ValueError(f"Feature not found: {feature_id}")

    connection = get_db()
    lock_rows = connection.execute(
        """
        SELECT work_locks.id, work_locks.fu_id, work_locks.agent_id, work_locks.acquired_at, work_locks.heartbeat_at
        FROM work_locks
        INNER JOIN function_units ON function_units.id = work_locks.fu_id
        WHERE function_units.feature_id = ? AND work_locks.status = ?
        ORDER BY work_locks.acquired_at ASC, work_locks.id ASC
        """,
        (feature_id, "active"),
    ).fetchall()
    agents = [
        {
            "agent_id": str(row["agent_id"]),
            "fu_id": str(row["fu_id"]),
            "lock_id": str(row["id"]),
            "lock_acquired_at": str(row["acquired_at"]),
            "last_heartbeat": str(row["heartbeat_at"]),
        }
        for row in lock_rows
    ]
    merge_points: list[dict[str, object]] = []
    for item in list_merge_points(feature_id):
        readiness = check_merge_ready(merge_point_id=str(item["id"]))
        merge_point_value = readiness.get("merge_point")
        if not isinstance(merge_point_value, dict):
            raise ValueError("Expected merge point payload")
        pending_trigger_fus_value = readiness.get("pending_trigger_fus", [])
        if not isinstance(pending_trigger_fus_value, list):
            raise ValueError("Expected pending_trigger_fus list")
        merge_points.append(
            {
                **merge_point_value,
                "ready": bool(readiness.get("ready", False)),
                "pending_trigger_fus": [
                    str(item) for item in pending_trigger_fus_value
                ],
            }
        )
    locked_fus = {str(item["fu_id"]) for item in agents}
    available_fus: list[dict[str, str]] = []
    blocked_fus: list[dict[str, str]] = []
    blocked_merged_fus = {
        str(item["merged_fu"])
        for item in merge_points
        if str(item["status"]) in {"waiting", "failed"}
    }

    for function_unit in full_feature["function_units"]:
        if function_unit["status"] in {"passed", "failed"}:
            continue
        if function_unit["id"] in blocked_merged_fus:
            blocked_fus.append(
                {
                    "fu_id": function_unit["id"],
                    "title": function_unit["title"],
                    "reason": "merge point waiting",
                }
            )
            continue
        blocked_reason = None
        for dependency in function_unit["depends_on"]:
            dependency_fu = _get_function_unit_row(dependency["fu_id"])
            if dependency["type"] == "hard" and (
                dependency_fu is None or str(dependency_fu["status"]) != "passed"
            ):
                blocked_reason = f"dependency {dependency['fu_id']} is not passed"
                break
        if blocked_reason is not None:
            blocked_fus.append(
                {
                    "fu_id": function_unit["id"],
                    "title": function_unit["title"],
                    "reason": blocked_reason,
                }
            )
            continue
        if function_unit["id"] in locked_fus:
            continue
        available_fus.append(
            {"fu_id": function_unit["id"], "title": function_unit["title"]}
        )

    return {
        "agents": agents,
        "merge_points": merge_points,
        "blocked_fus": blocked_fus,
        "available_fus": available_fus,
    }


def resume(*, agent_id: str | None = None) -> dict[str, object]:
    expire_stale_work_locks()
    connection = get_db()
    active_feature_row = connection.execute(
        "SELECT id FROM features WHERE status IN ('draft', 'plan_review', 'building', 'build_review') ORDER BY CASE status WHEN 'build_review' THEN 0 WHEN 'building' THEN 1 WHEN 'plan_review' THEN 2 ELSE 3 END ASC, id ASC LIMIT 1"
    ).fetchone()
    if active_feature_row is None:
        return {"active_feature": None}

    feature_id = str(active_feature_row["id"])
    active_feature = get_feature(feature_id)
    if active_feature is None:
        return {"active_feature": None}

    active_plan_row = connection.execute(
        "SELECT id FROM plan_cycles WHERE feature_id = ? AND status IN ('drafting', 'reviewing') ORDER BY iteration DESC LIMIT 1",
        (feature_id,),
    ).fetchone()
    active_build_row = connection.execute(
        "SELECT id FROM build_cycles WHERE feature_id = ? AND status IN ('building', 'reviewing') ORDER BY iteration DESC LIMIT 1",
        (feature_id,),
    ).fetchone()
    current_cycle: dict[str, object] | None = None
    checkpoint_payload: dict[str, object] | None = None
    current_lock: dict[str, object] | None = None
    next_fu_payload: dict[str, object] | None = None
    parallel_agent_status: list[dict[str, object]] = []

    if active_build_row is not None:
        build_cycle_id = str(active_build_row["id"])
        build_cycle = get_build_cycle(build_cycle_id)
        current_cycle = {
            "cycle_type": "build",
            "cycle": build_cycle,
            "session_log": None,
        }
        if agent_id is not None:
            session_log = get_open_session_log(build_cycle_id, agent_id)
            checkpoint_row = get_checkpoint(build_cycle_id, agent_id)
            current_cycle["session_log"] = session_log
            checkpoint_payload = (
                None if checkpoint_row is None else dict(checkpoint_row)
            )
            if checkpoint_row is not None and checkpoint_row["next_fu"] is not None:
                next_function_unit = _get_function_unit_row(checkpoint_row["next_fu"])
                if next_function_unit is not None:
                    next_fu_payload = {
                        "id": str(next_function_unit["id"]),
                        "title": str(next_function_unit["title"]),
                        "status": str(next_function_unit["status"]),
                        "assigned_agent": None
                        if next_function_unit["assigned_agent"] is None
                        else str(next_function_unit["assigned_agent"]),
                    }

            lock_rows = connection.execute(
                """
                SELECT work_locks.id FROM work_locks
                INNER JOIN function_units ON function_units.id = work_locks.fu_id
                WHERE function_units.feature_id = ? AND work_locks.status = ?
                ORDER BY work_locks.acquired_at ASC, work_locks.id ASC
                """,
                (feature_id, "active"),
            ).fetchall()
            agent_to_locks: dict[str, list[dict[str, object]]] = defaultdict(list)
            for row in lock_rows:
                work_lock = get_work_lock(str(row["id"]))
                if work_lock is None:
                    continue
                function_unit = _get_function_unit_row(str(work_lock["fu_id"]))
                if function_unit is None:
                    continue
                lock_payload = {
                    **work_lock,
                    "function_unit": _map_fu_row(
                        function_unit,
                        [],
                        _fu_dependency_map([str(function_unit["id"])])[
                            str(function_unit["id"])
                        ],
                    ),
                }
                agent_to_locks[str(work_lock["agent_id"])].append(lock_payload)
                if str(work_lock["agent_id"]) == agent_id and current_lock is None:
                    current_lock = lock_payload

            agent_ids = sorted(agent_to_locks.keys())
            if agent_id is not None and agent_id not in agent_ids:
                agent_ids.append(agent_id)
            for current_agent_id in agent_ids:
                session_log = get_open_session_log(build_cycle_id, current_agent_id)
                checkpoint_row = get_checkpoint(build_cycle_id, current_agent_id)
                parallel_agent_status.append(
                    {
                        "agent_id": current_agent_id,
                        "session_log": session_log,
                        "checkpoint": checkpoint_row,
                        "active_locks": agent_to_locks.get(current_agent_id, []),
                        "next_fu": None
                        if checkpoint_row is None
                        else checkpoint_row["next_fu"],
                    }
                )
    elif active_plan_row is not None:
        current_cycle = {
            "cycle_type": "plan",
            "cycle": get_plan_cycle(str(active_plan_row["id"])),
        }

    open_issues = list_issues(feature_id=feature_id, status="open")
    return {
        "active_feature": active_feature,
        "current_cycle": current_cycle,
        "checkpoint": checkpoint_payload,
        "current_lock": current_lock,
        "open_issues": open_issues,
        "next_fu": next_fu_payload,
        "parallel_agent_status": parallel_agent_status,
        "session_warnings": [],
    }


def get_context(*, feature_id: str | None = None) -> dict[str, object]:
    resolved_feature_id = feature_id
    if resolved_feature_id is None:
        active_resume = resume()
        active_feature = active_resume.get("active_feature")
        if not isinstance(active_feature, dict):
            return {
                "feature": None,
                "function_units": [],
                "plan_cycles": [],
                "build_cycles": [],
                "issues": [],
                "work_locks": [],
                "status_audit_history": {
                    "feature": [],
                    "function_units": [],
                    "acceptance_criteria": [],
                    "plan_cycles": [],
                    "build_cycles": [],
                },
            }
        resolved_feature_id = str(active_feature["id"])

    feature = get_full_feature(resolved_feature_id)
    if feature is None:
        return {
            "feature": None,
            "function_units": [],
            "plan_cycles": [],
            "build_cycles": [],
            "issues": [],
            "work_locks": [],
            "status_audit_history": {
                "feature": [],
                "function_units": [],
                "acceptance_criteria": [],
                "plan_cycles": [],
                "build_cycles": [],
            },
        }

    connection = get_db()
    plan_cycle_rows = connection.execute(
        "SELECT id FROM plan_cycles WHERE feature_id = ? ORDER BY iteration ASC",
        (resolved_feature_id,),
    ).fetchall()
    build_cycle_rows = connection.execute(
        "SELECT id FROM build_cycles WHERE feature_id = ? ORDER BY iteration ASC",
        (resolved_feature_id,),
    ).fetchall()
    work_lock_rows = connection.execute(
        """
        SELECT work_locks.id
        FROM work_locks
        INNER JOIN function_units ON function_units.id = work_locks.fu_id
        WHERE function_units.feature_id = ?
        ORDER BY work_locks.acquired_at ASC, work_locks.id ASC
        """,
        (resolved_feature_id,),
    ).fetchall()

    plan_cycles = []
    for row in plan_cycle_rows:
        plan_cycle_id = str(row["id"])
        plan_cycles.append(
            {
                **get_plan_cycle(plan_cycle_id),
                "issues": [
                    issue
                    for issue in list_issues()
                    if issue["parent_type"] == "plan"
                    and issue["parent_id"] == plan_cycle_id
                ],
            }
        )

    build_cycles = []
    for row in build_cycle_rows:
        build_cycle_id = str(row["id"])
        session_rows = connection.execute(
            "SELECT id FROM session_logs WHERE build_cycle_id = ? ORDER BY started_at ASC, id ASC",
            (build_cycle_id,),
        ).fetchall()
        sessions = []
        for session_row in session_rows:
            session = connection.execute(
                "SELECT id, build_cycle_id, agent_id, session_id, started_at, ended_at, end_reason FROM session_logs WHERE id = ?",
                (str(session_row["id"]),),
            ).fetchone()
            if session is None:
                continue
            sessions.append(
                {
                    "id": str(session["id"]),
                    "build_cycle_id": str(session["build_cycle_id"]),
                    "agent_id": str(session["agent_id"]),
                    "session_id": str(session["session_id"]),
                    "started_at": str(session["started_at"]),
                    "ended_at": None
                    if session["ended_at"] is None
                    else str(session["ended_at"]),
                    "end_reason": None
                    if session["end_reason"] is None
                    else str(session["end_reason"]),
                }
            )
        checkpoint_rows = connection.execute(
            "SELECT agent_id FROM checkpoints WHERE build_cycle_id = ? ORDER BY agent_id ASC",
            (build_cycle_id,),
        ).fetchall()
        checkpoints = [
            checkpoint
            for checkpoint_row in checkpoint_rows
            if (
                checkpoint := get_checkpoint(
                    build_cycle_id, str(checkpoint_row["agent_id"])
                )
            )
            is not None
        ]
        build_cycles.append(
            {
                **get_build_cycle(build_cycle_id),
                "issues": [
                    issue
                    for issue in list_issues()
                    if issue["parent_type"] == "build"
                    and issue["parent_id"] == build_cycle_id
                ],
                "session_logs": sessions,
                "checkpoints": checkpoints,
            }
        )

    work_locks = [
        work_lock
        for row in work_lock_rows
        if (work_lock := get_work_lock(str(row["id"]))) is not None
    ]
    status_audit_history = {
        "feature": get_status_history("feature", resolved_feature_id),
        "function_units": [
            {
                "entity_id": fu["id"],
                "history": get_status_history("function_unit", fu["id"]),
            }
            for fu in feature["function_units"]
        ],
        "acceptance_criteria": [
            {
                "entity_id": ac["id"],
                "history": get_status_history("acceptance_criteria", ac["id"]),
            }
            for fu in feature["function_units"]
            for ac in fu["acceptance_criteria"]
        ],
        "plan_cycles": [
            {
                "entity_id": plan_cycle["id"],
                "history": get_status_history("plan_cycle", plan_cycle["id"]),
            }
            for plan_cycle in plan_cycles
        ],
        "build_cycles": [
            {
                "entity_id": build_cycle["id"],
                "history": get_status_history("build_cycle", build_cycle["id"]),
            }
            for build_cycle in build_cycles
        ],
    }

    return {
        "feature": feature,
        "function_units": feature["function_units"],
        "plan_cycles": plan_cycles,
        "build_cycles": build_cycles,
        "issues": list_issues(feature_id=resolved_feature_id),
        "work_locks": work_locks,
        "status_audit_history": status_audit_history,
    }


def export_markdown(*, feature_id: str) -> dict[str, object]:
    context = get_context(feature_id=feature_id)
    feature = context.get("feature")
    if not isinstance(feature, dict):
        raise ValueError("Cannot export lifecycle report without an active feature")

    lines = [
        f"# Blueprint Export - {feature['title']}",
        "",
        "## Feature Metadata",
        f"- Feature ID: {feature['id']}",
        f"- Scope: {feature['scope']}",
        f"- Out of scope: {feature['out_of_scope']}",
        f"- Priority: {feature['priority']}",
        f"- Status: {feature['status']}",
        "",
        "## Function Units",
    ]
    function_units = context.get("function_units")
    if isinstance(function_units, list):
        for function_unit in function_units:
            if not isinstance(function_unit, dict):
                continue
            lines.extend(
                [
                    f"### {function_unit['id']} - {function_unit['title']}",
                    f"- Status: {function_unit['status']}",
                    f"- Description: {function_unit['description']}",
                    f"- Assigned agent: {function_unit['assigned_agent']}",
                    f"- Test evidence: {function_unit['test_evidence']}",
                    f"- Failure reason: {function_unit['failure_reason']}",
                    "",
                ]
            )
    markdown = "\n".join(lines) + "\n"
    export_dir = get_blueprint_directory() / "exports"
    export_dir.mkdir(parents=True, exist_ok=True)
    output_path = export_dir / f"{feature['id']}.md"
    output_path.write_text(markdown, encoding="utf-8")

    return {
        "feature_id": str(feature["id"]),
        "output_path": str(output_path),
        "markdown": markdown,
    }


def get_history(*, feature_id: str) -> dict[str, object]:
    context = get_context(feature_id=feature_id)
    feature = context.get("feature")
    if not isinstance(feature, dict):
        raise ValueError("Cannot analyze history without an active feature")
    issues = context.get("issues")
    plan_cycles = context.get("plan_cycles")
    build_cycles = context.get("build_cycles")
    function_units = context.get("function_units")
    status_audit_history = context.get("status_audit_history")

    issue_category_distribution: dict[str, int] = {}
    issue_recurrence_map: dict[tuple[str, str], list[str]] = {}
    if isinstance(issues, list):
        for issue in issues:
            if not isinstance(issue, dict):
                continue
            category = str(issue["category"])
            issue_category_distribution[category] = (
                issue_category_distribution.get(category, 0) + 1
            )
            key = (str(issue["fu_id"]), category)
            issue_recurrence_map.setdefault(key, []).append(str(issue["parent_id"]))

    issue_recurrence = [
        {
            "fu_id": fu_id,
            "category": category,
            "occurrences": len(cycle_ids),
            "cycle_ids": cycle_ids,
        }
        for (fu_id, category), cycle_ids in issue_recurrence_map.items()
        if len(cycle_ids) > 1
    ]

    ac_failure_rates: list[dict[str, object]] = []
    acceptance_criteria_history = {}
    if isinstance(status_audit_history, dict):
        ac_entries = status_audit_history.get("acceptance_criteria")
        if isinstance(ac_entries, list):
            for entry in ac_entries:
                if isinstance(entry, dict):
                    acceptance_criteria_history[str(entry["entity_id"])] = entry.get(
                        "history", []
                    )
    ac_types = ["functional", "performance", "security", "edge_case"]
    for ac_type in ac_types:
        total = 0
        failed_before_passing = 0
        if isinstance(function_units, list):
            for function_unit in function_units:
                if not isinstance(function_unit, dict):
                    continue
                ac_list = function_unit.get("acceptance_criteria")
                if not isinstance(ac_list, list):
                    continue
                for ac in ac_list:
                    if not isinstance(ac, dict) or str(ac["type"]) != ac_type:
                        continue
                    total += 1
                    history = acceptance_criteria_history.get(str(ac["id"]), [])
                    saw_failed = False
                    for item in history:
                        if not isinstance(item, dict):
                            continue
                        if item.get("new_status") == "failed":
                            saw_failed = True
                        if saw_failed and item.get("new_status") == "passed":
                            failed_before_passing += 1
                            break
        percentage = (
            0 if total == 0 else round((failed_before_passing / total) * 100, 2)
        )
        ac_failure_rates.append(
            {
                "type": ac_type,
                "total": total,
                "failed_before_passing": failed_before_passing,
                "percentage": percentage,
            }
        )

    fu_rework = []
    if isinstance(status_audit_history, dict):
        fu_entries = status_audit_history.get("function_units")
        if isinstance(fu_entries, list):
            for entry in fu_entries:
                if not isinstance(entry, dict):
                    continue
                rework_count = 0
                history = entry.get("history")
                if isinstance(history, list):
                    for item in history:
                        if not isinstance(item, dict):
                            continue
                        if item.get("old_status") == "passed" and item.get(
                            "new_status"
                        ) in {"in_progress", "failed"}:
                            rework_count += 1
                fu_rework.append(
                    {"fu_id": str(entry["entity_id"]), "rework_count": rework_count}
                )

    def _approved_iteration(cycles: object) -> int | None:
        if not isinstance(cycles, list):
            return None
        for cycle in cycles:
            if isinstance(cycle, dict) and cycle.get("status") == "approved":
                return int(cycle["iteration"])
        return None

    return {
        "feature_id": str(feature["id"]),
        "plan_cycle_count": 0
        if not isinstance(plan_cycles, list)
        else len(plan_cycles),
        "build_cycle_count": 0
        if not isinstance(build_cycles, list)
        else len(build_cycles),
        "issue_recurrence": issue_recurrence,
        "ac_failure_rates": ac_failure_rates,
        "fu_rework": fu_rework,
        "issue_category_distribution": issue_category_distribution,
        "average_cycles_to_approval": {
            "plan": _approved_iteration(plan_cycles),
            "build": _approved_iteration(build_cycles),
        },
    }


def run_coordinator(
    *, coordinator_agent_id: str, worker_agent_ids: list[str], max_iterations: int = 20
) -> dict[str, object]:
    resumed = resume()
    active_feature = resumed.get("active_feature")
    if not isinstance(active_feature, dict):
        raise ValueError("Coordinator could not find an active feature to manage")
    feature_id = str(active_feature["id"])
    if str(active_feature["status"]) != "building":
        raise ValueError(
            f"Coordinator requires feature {feature_id} to be in building status"
        )

    connection = get_db()
    active_build = connection.execute(
        "SELECT id FROM build_cycles WHERE feature_id = ? AND status = ? ORDER BY iteration DESC LIMIT 1",
        (feature_id, "building"),
    ).fetchone()
    if active_build is not None:
        build_cycle_id = str(active_build["id"])
    else:
        start_build_result = start_build(
            feature_id=feature_id, agent_id=coordinator_agent_id
        )
        started_build_cycle = start_build_result.get("build_cycle")
        if not isinstance(started_build_cycle, dict):
            raise ValueError("Expected build cycle payload from start_build")
        build_cycle_id = str(started_build_cycle["id"])
    worker_results: list[dict[str, object]] = []
    stalled = False

    for _ in range(max_iterations):
        dispatched = 0
        for worker_agent_id in worker_agent_ids:
            assignment = get_available_work(agent_id=worker_agent_id)
            if assignment is None:
                continue
            assignment_fu = assignment.get("fu")
            if not isinstance(assignment_fu, dict):
                raise ValueError("Expected function unit payload in assignment")
            dispatched += 1
            worker_results.append(
                {
                    "agent_id": worker_agent_id,
                    "success": True,
                    "message": f"Assigned {assignment_fu['id']}",
                }
            )
        full_feature = get_full_feature(feature_id)
        if full_feature is None:
            raise ValueError(f"Feature not found: {feature_id}")
        for merge_point in list_merge_points(feature_id):
            if str(merge_point["status"]) == "waiting":
                check_merge_ready(merge_point_id=str(merge_point["id"]))
        if all(fu["status"] == "passed" for fu in full_feature["function_units"]):
            submit_build_for_review(build_cycle_id=build_cycle_id)
            return {
                "feature_id": feature_id,
                "final_build_cycle_id": build_cycle_id,
                "approved": False,
                "worker_results": worker_results,
                "skeptic_result": None,
                "stalled": False,
            }
        if dispatched == 0:
            stalled = True
            break

    return {
        "feature_id": feature_id,
        "final_build_cycle_id": build_cycle_id,
        "approved": False,
        "worker_results": worker_results,
        "skeptic_result": None,
        "stalled": stalled,
    }
