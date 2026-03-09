from __future__ import annotations

from .constants import STATUS_AUDIT_LOG_ENTITY_TYPES
from .db import get_db, utc_now_iso
from .models import StatusAuditLogRecord


def log_status_change(
    *,
    entity_type: str,
    entity_id: str,
    old_status: str | None,
    new_status: str,
    changed_by: str | None = None,
    context: str | None = None,
) -> None:
    if entity_type not in STATUS_AUDIT_LOG_ENTITY_TYPES:
        raise ValueError(f"Invalid status audit log entity type: {entity_type}")

    connection = get_db()

    with connection:
        connection.execute(
            """
            INSERT INTO status_audit_log (
              entity_type,
              entity_id,
              old_status,
              new_status,
              changed_at,
              changed_by,
              context
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                entity_type,
                entity_id,
                old_status,
                new_status,
                utc_now_iso(),
                changed_by,
                context,
            ),
        )


def get_status_history(entity_type: str, entity_id: str) -> list[StatusAuditLogRecord]:
    if entity_type not in STATUS_AUDIT_LOG_ENTITY_TYPES:
        raise ValueError(f"Invalid status audit log entity type: {entity_type}")

    connection = get_db()
    rows = connection.execute(
        """
        SELECT id, entity_type, entity_id, old_status, new_status, changed_at, changed_by, context
        FROM status_audit_log
        WHERE entity_type = ? AND entity_id = ?
        ORDER BY changed_at ASC, id ASC
        """,
        (entity_type, entity_id),
    ).fetchall()

    return [StatusAuditLogRecord(**row) for row in rows]
