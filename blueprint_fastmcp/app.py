from __future__ import annotations

import os

from fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from .db import get_db
from .repository import (
    add_issue,
    add_acceptance_criteria,
    add_dependency,
    add_function_unit,
    add_merge_point,
    approve_build,
    approve_plan,
    check_merge_ready,
    checkpoint,
    complete_fu,
    create_feature,
    export_markdown,
    get_available_work,
    get_context,
    get_full_feature,
    get_history,
    get_parallel_status,
    heartbeat,
    list_features,
    list_issues,
    reject_build,
    reject_plan,
    release_lock,
    resume,
    resolve_issue,
    run_coordinator,
    fail_fu,
    start_build,
    start_plan_review,
    submit_build_for_review,
    update_acceptance_criteria,
)


def create_app() -> FastMCP:
    mcp = FastMCP("Blueprint")

    @mcp.custom_route("/health", methods=["GET"], include_in_schema=False)
    async def health_check(_request: Request) -> Response:
        get_db()

        return JSONResponse({"status": "ok"})

    @mcp.tool(name="blueprint_create_feature")
    def blueprint_create_feature(
        title: str,
        scope: str,
        out_of_scope: str,
        priority: str,
        depends_on: list[str] | None = None,
    ) -> dict[str, object]:
        return dict(
            create_feature(
                title=title,
                scope=scope,
                out_of_scope=out_of_scope,
                priority=priority,
                depends_on=depends_on,
            )
        )

    @mcp.tool(name="blueprint_list_features")
    def blueprint_list_features(status: str | None = None) -> list[dict[str, object]]:
        return [dict(feature) for feature in list_features(status=status)]

    @mcp.tool(name="blueprint_get_feature")
    def blueprint_get_feature(feature_id: str) -> dict[str, object]:
        feature = get_full_feature(feature_id)

        if feature is None:
            raise ValueError(f"Feature not found: {feature_id}")

        return dict(feature)

    @mcp.tool(name="blueprint_add_function_unit")
    def blueprint_add_function_unit(
        feature_id: str,
        title: str,
        description: str,
    ) -> dict[str, object]:
        return dict(
            add_function_unit(
                feature_id=feature_id,
                title=title,
                description=description,
            )
        )

    @mcp.tool(name="blueprint_add_dependency")
    def blueprint_add_dependency(
        fu_id: str,
        depends_on_fu_id: str,
        dependency_type: str,
    ) -> dict[str, object]:
        return dict(
            add_dependency(
                fu_id=fu_id,
                depends_on_fu_id=depends_on_fu_id,
                dependency_type=dependency_type,
            )
        )

    @mcp.tool(name="blueprint_add_ac")
    def blueprint_add_ac(
        fu_id: str,
        description: str,
        type: str,
        severity: str,
    ) -> dict[str, object]:
        return dict(
            add_acceptance_criteria(
                fu_id=fu_id,
                description=description,
                ac_type=type,
                severity=severity,
            )
        )

    @mcp.tool(name="blueprint_update_ac")
    def blueprint_update_ac(
        ac_id: str,
        status: str,
        verified_in: str | None = None,
        evidence: str | None = None,
    ) -> dict[str, object]:
        return dict(
            update_acceptance_criteria(
                ac_id=ac_id,
                status=status,
                verified_in=verified_in,
                evidence=evidence,
            )
        )

    @mcp.tool(name="blueprint_start_plan_review")
    def blueprint_start_plan_review(feature_id: str) -> dict[str, object]:
        return dict(start_plan_review(feature_id=feature_id))

    @mcp.tool(name="blueprint_start_build")
    def blueprint_start_build(feature_id: str, agent_id: str) -> dict[str, object]:
        return start_build(feature_id=feature_id, agent_id=agent_id)

    @mcp.tool(name="blueprint_submit_for_review")
    def blueprint_submit_for_review(build_cycle_id: str) -> dict[str, object]:
        return submit_build_for_review(build_cycle_id=build_cycle_id)

    @mcp.tool(name="blueprint_add_issue")
    def blueprint_add_issue(
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
    ) -> dict[str, object]:
        return dict(
            add_issue(
                parent_type=parent_type,
                parent_id=parent_id,
                fu_id=fu_id,
                category=category,
                title=title,
                description=description,
                severity=severity,
                ac_id=ac_id,
                related_fu_id=related_fu_id,
                suggested_fix=suggested_fix,
            )
        )

    @mcp.tool(name="blueprint_list_issues")
    def blueprint_list_issues(
        feature_id: str | None = None,
        status: str | None = None,
        severity: str | None = None,
        category: str | list[str] | None = None,
    ) -> list[dict[str, object]]:
        return [
            dict(issue)
            for issue in list_issues(
                feature_id=feature_id,
                status=status,
                severity=severity,
                category=category,
            )
        ]

    @mcp.tool(name="blueprint_resolve_issue")
    def blueprint_resolve_issue(
        issue_id: str,
        status: str,
        resolved_in: str,
        resolution_note: str | None = None,
    ) -> dict[str, object]:
        return dict(
            resolve_issue(
                issue_id=issue_id,
                status=status,
                resolved_in=resolved_in,
                resolution_note=resolution_note,
            )
        )

    @mcp.tool(name="blueprint_approve_plan")
    def blueprint_approve_plan(plan_cycle_id: str) -> dict[str, object]:
        return approve_plan(plan_cycle_id=plan_cycle_id)

    @mcp.tool(name="blueprint_reject_plan")
    def blueprint_reject_plan(plan_cycle_id: str) -> dict[str, object]:
        return reject_plan(plan_cycle_id=plan_cycle_id)

    @mcp.tool(name="blueprint_approve_build")
    def blueprint_approve_build(build_cycle_id: str) -> dict[str, object]:
        return approve_build(build_cycle_id=build_cycle_id)

    @mcp.tool(name="blueprint_reject_build")
    def blueprint_reject_build(build_cycle_id: str) -> dict[str, object]:
        return reject_build(build_cycle_id=build_cycle_id)

    @mcp.tool(name="blueprint_add_merge_point")
    def blueprint_add_merge_point(
        feature_id: str,
        trigger_fus: list[str],
        merged_fu: str,
    ) -> dict[str, object]:
        return add_merge_point(
            feature_id=feature_id,
            trigger_fus=trigger_fus,
            merged_fu=merged_fu,
        )

    @mcp.tool(name="blueprint_check_merge_ready")
    def blueprint_check_merge_ready(merge_point_id: str) -> dict[str, object]:
        return check_merge_ready(merge_point_id=merge_point_id)

    @mcp.tool(name="blueprint_checkpoint")
    def blueprint_checkpoint(
        build_cycle_id: str,
        agent_id: str,
        completed_fu: str | None = None,
        next_fu: str | None = None,
        notes: str | None = None,
    ) -> dict[str, object]:
        return dict(
            checkpoint(
                build_cycle_id=build_cycle_id,
                agent_id=agent_id,
                completed_fu=completed_fu,
                next_fu=next_fu,
                notes=notes,
            )
        )

    @mcp.tool(name="blueprint_complete_fu")
    def blueprint_complete_fu(
        build_cycle_id: str,
        fu_id: str,
        agent_id: str,
        evidence: str,
    ) -> dict[str, object]:
        return dict(
            complete_fu(
                build_cycle_id=build_cycle_id,
                fu_id=fu_id,
                agent_id=agent_id,
                evidence=evidence,
            )
        )

    @mcp.tool(name="blueprint_fail_fu")
    def blueprint_fail_fu(fu_id: str, reason: str) -> dict[str, object]:
        return dict(fail_fu(fu_id=fu_id, reason=reason))

    @mcp.tool(name="blueprint_heartbeat")
    def blueprint_heartbeat(lock_id: str, agent_id: str) -> dict[str, object]:
        return heartbeat(lock_id=lock_id, agent_id=agent_id)

    @mcp.tool(name="blueprint_release_lock")
    def blueprint_release_lock(
        lock_id: str, agent_id: str, reason: str | None = None
    ) -> dict[str, object]:
        return release_lock(lock_id=lock_id, agent_id=agent_id, reason=reason)

    @mcp.tool(name="blueprint_get_available_work")
    def blueprint_get_available_work(agent_id: str) -> dict[str, object] | None:
        return get_available_work(agent_id=agent_id)

    @mcp.tool(name="blueprint_get_parallel_status")
    def blueprint_get_parallel_status(feature_id: str) -> dict[str, object]:
        return get_parallel_status(feature_id=feature_id)

    @mcp.tool(name="blueprint_resume")
    def blueprint_resume(agent_id: str | None = None) -> dict[str, object]:
        return resume(agent_id=agent_id)

    @mcp.tool(name="blueprint_get_context")
    def blueprint_get_context(feature_id: str | None = None) -> dict[str, object]:
        return get_context(feature_id=feature_id)

    @mcp.tool(name="blueprint_export")
    def blueprint_export(feature_id: str) -> str:
        result = export_markdown(feature_id=feature_id)

        return str(result["markdown"])

    @mcp.tool(name="blueprint_get_history")
    def blueprint_get_history(feature_id: str) -> dict[str, object]:
        return get_history(feature_id=feature_id)

    @mcp.tool(name="blueprint_run_coordinator")
    def blueprint_run_coordinator(
        coordinator_agent_id: str,
        worker_agent_ids: list[str],
        max_iterations: int = 20,
    ) -> dict[str, object]:
        return run_coordinator(
            coordinator_agent_id=coordinator_agent_id,
            worker_agent_ids=worker_agent_ids,
            max_iterations=max_iterations,
        )

    return mcp


def run_server() -> None:
    host = os.environ.get("BLUEPRINT_HOST", "127.0.0.1")
    port = int(os.environ.get("BLUEPRINT_PORT", "8000"))
    path = os.environ.get("BLUEPRINT_MCP_PATH", "/mcp")
    app = create_app()
    get_db()
    app.run(transport="streamable-http", host=host, port=port, path=path)
