from __future__ import annotations

from collections.abc import Mapping, Sequence


def evaluate_plan_approval_gate(
    feature: Mapping[str, object], issues: Sequence[Mapping[str, object]]
) -> dict[str, object]:
    failures: list[dict[str, object]] = []
    out_of_scope = str(feature["out_of_scope"])
    function_units_value = feature["function_units"]

    if not isinstance(function_units_value, list):
        raise ValueError("feature.function_units must be a list")

    function_units = function_units_value

    if out_of_scope.strip() == "":
        failures.append(
            {
                "code": "empty_out_of_scope",
                "message": "Feature out_of_scope must not be empty.",
                "feature_id": feature["id"],
            }
        )

    open_critical_issues = [
        issue
        for issue in issues
        if issue["severity"] == "critical" and issue["status"] == "open"
    ]
    if open_critical_issues:
        failures.append(
            {
                "code": "open_critical_issues",
                "message": "Plan approval requires all critical issues to be closed.",
                "feature_id": feature["id"],
                "issue_count": len(open_critical_issues),
                "issues": open_critical_issues,
            }
        )

    unresolved_major_issues = [
        issue
        for issue in issues
        if issue["severity"] == "major"
        and issue["status"] not in {"resolved", "wont_fix"}
    ]
    if unresolved_major_issues:
        failures.append(
            {
                "code": "unresolved_major_issues",
                "message": "Plan approval requires all major issues to be resolved or marked wont_fix.",
                "feature_id": feature["id"],
                "issue_count": len(unresolved_major_issues),
                "issues": unresolved_major_issues,
            }
        )

    for function_unit in function_units:
        acceptance_criteria_value = function_unit["acceptance_criteria"]

        if not isinstance(acceptance_criteria_value, list):
            raise ValueError("function_unit.acceptance_criteria must be a list")

        acceptance_criteria = acceptance_criteria_value
        has_must = any(item["severity"] == "must" for item in acceptance_criteria)

        if not has_must:
            failures.append(
                {
                    "code": "function_unit_missing_must_ac",
                    "message": "Each function unit must include at least one must acceptance criterion.",
                    "feature_id": feature["id"],
                    "function_unit": {
                        "id": function_unit["id"],
                        "title": function_unit["title"],
                    },
                }
            )

    return {"passed": len(failures) == 0, "failures": failures}


def evaluate_build_approval_gate(
    feature: Mapping[str, object],
    issues: Sequence[Mapping[str, object]],
    active_work_locks: Sequence[Mapping[str, object]],
) -> dict[str, object]:
    failures: list[dict[str, object]] = []

    unresolved_critical_issues = [
        issue
        for issue in issues
        if issue["severity"] == "critical" and issue["status"] != "resolved"
    ]
    if unresolved_critical_issues:
        failures.append(
            {
                "code": "unresolved_critical_issues",
                "message": "Build approval requires all critical issues to be resolved.",
                "feature_id": feature["id"],
                "issue_count": len(unresolved_critical_issues),
                "issues": unresolved_critical_issues,
            }
        )

    unresolved_major_issues = [
        issue
        for issue in issues
        if issue["severity"] == "major" and issue["status"] != "resolved"
    ]
    if unresolved_major_issues:
        failures.append(
            {
                "code": "unresolved_major_issues",
                "message": "Build approval requires all major issues to be resolved.",
                "feature_id": feature["id"],
                "issue_count": len(unresolved_major_issues),
                "issues": unresolved_major_issues,
            }
        )

    function_units_value = feature["function_units"]

    if not isinstance(function_units_value, list):
        raise ValueError("feature.function_units must be a list")

    for function_unit in function_units_value:
        if function_unit["status"] != "passed":
            failures.append(
                {
                    "code": "function_unit_not_passed",
                    "message": "Build approval requires every function unit to be passed.",
                    "feature_id": feature["id"],
                    "function_unit": {
                        "id": function_unit["id"],
                        "title": function_unit["title"],
                        "status": function_unit["status"],
                    },
                }
            )

        failing_must = [
            {
                "id": item["id"],
                "fu_id": function_unit["id"],
                "description": item["description"],
                "severity": item["severity"],
                "status": item["status"],
            }
            for item in function_unit["acceptance_criteria"]
            if item["severity"] == "must" and item["status"] != "passed"
        ]
        if failing_must:
            failures.append(
                {
                    "code": "must_acceptance_criteria_not_passed",
                    "message": "Build approval requires every must acceptance criterion to be passed.",
                    "feature_id": feature["id"],
                    "acceptance_criteria": failing_must,
                }
            )

    if active_work_locks:
        failures.append(
            {
                "code": "active_work_locks_present",
                "message": "Build approval requires all active work locks to be released.",
                "feature_id": feature["id"],
                "work_lock_count": len(active_work_locks),
                "work_locks": active_work_locks,
            }
        )

    return {"passed": len(failures) == 0, "failures": failures}
