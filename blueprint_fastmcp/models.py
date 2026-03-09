from __future__ import annotations

from typing import TypedDict


class AcceptanceCriteriaRecord(TypedDict):
    id: str
    fu_id: str
    description: str
    type: str
    severity: str
    status: str
    verified_in: str | None
    evidence: str | None


class FunctionUnitDependencyRecord(TypedDict):
    fu_id: str
    type: str


class FunctionUnitRecord(TypedDict):
    id: str
    feature_id: str
    title: str
    description: str
    acceptance_criteria: list[AcceptanceCriteriaRecord]
    depends_on: list[FunctionUnitDependencyRecord]
    status: str
    assigned_agent: str | None
    test_evidence: str | None
    failure_reason: str | None


class FeatureRecord(TypedDict):
    id: str
    title: str
    scope: str
    out_of_scope: str
    status: str
    priority: str
    depends_on: list[str]


class FullFeatureRecord(FeatureRecord):
    function_units: list[FunctionUnitRecord]


class StatusAuditLogRecord(TypedDict):
    id: int
    entity_type: str
    entity_id: str
    old_status: str | None
    new_status: str
    changed_at: str
    changed_by: str | None
    context: str | None


class PlanCycleRecord(TypedDict):
    id: str
    feature_id: str
    iteration: int
    plan_snapshot: dict[str, object]
    status: str


class BuildCycleRecord(TypedDict):
    id: str
    feature_id: str
    iteration: int
    agent_id: str
    status: str


class SessionLogRecord(TypedDict):
    id: str
    build_cycle_id: str
    agent_id: str
    session_id: str
    started_at: str
    ended_at: str | None
    end_reason: str | None


class CheckpointRecord(TypedDict):
    id: str
    build_cycle_id: str
    agent_id: str
    completed_fus: list[str]
    next_fu: str | None
    notes: str | None


class IssueRecord(TypedDict):
    id: str
    parent_type: str
    parent_id: str
    fu_id: str
    ac_id: str | None
    related_fu_id: str | None
    category: str
    severity: str
    title: str
    description: str
    suggested_fix: str | None
    status: str
    resolved_in: str | None
    resolution_note: str | None


class WorkLockRecord(TypedDict):
    id: str
    fu_id: str
    agent_id: str
    acquired_at: str
    heartbeat_at: str
    released_at: str | None
    release_reason: str | None
    ttl_seconds: int
    status: str


class MergePointRecord(TypedDict):
    id: str
    feature_id: str
    trigger_fus: list[str]
    merged_fu: str
    status: str
