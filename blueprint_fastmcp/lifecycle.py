from __future__ import annotations


def transition_feature_status_from_event(
    current_status: str,
    event: str,
    *,
    has_approved_build_cycle: bool = False,
    has_blocking_open_issues: bool = False,
) -> str:
    if event == "plan_review_started":
        if current_status != "draft":
            raise ValueError(f"Cannot start plan review from {current_status}")

        return "plan_review"

    if event == "plan_approved":
        if current_status != "plan_review":
            raise ValueError(f"Cannot approve plan from {current_status}")

        return "building"

    if event == "plan_rejected":
        if current_status != "plan_review":
            raise ValueError(f"Cannot reject plan from {current_status}")

        return "plan_review"

    if event == "build_review_started":
        if current_status != "building":
            raise ValueError(f"Cannot start build review from {current_status}")

        return "build_review"

    if event == "build_rejected":
        if current_status != "build_review":
            raise ValueError(f"Cannot reject build from {current_status}")

        return "building"

    if event == "build_approved":
        if current_status != "build_review":
            raise ValueError(f"Cannot approve build from {current_status}")

        if not has_approved_build_cycle:
            raise ValueError("Cannot mark feature done without an approved build cycle")

        if has_blocking_open_issues:
            raise ValueError(
                "Cannot mark feature done with open critical or major issues"
            )

        return "done"

    raise ValueError(f"Unknown lifecycle event: {event}")
