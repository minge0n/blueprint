import { getDb } from '../index.js';
import { logStatusChange } from './status-audit-log.js';
import {
  STATUS_AUDIT_LOG_ENTITY_TYPES,
} from '../../entities/status-audit-log.js';
import type { AcceptanceCriteria } from '../../entities/acceptance-criteria.js';
import {
  ACCEPTANCE_CRITERIA_SEVERITIES,
  ACCEPTANCE_CRITERIA_STATUSES,
  ACCEPTANCE_CRITERIA_TYPES,
  type AcceptanceCriteriaSeverity,
  type AcceptanceCriteriaStatus,
  type AcceptanceCriteriaType,
} from '../../entities/types.js';

export interface AddAcceptanceCriteriaInput {
  readonly fu_id: string;
  readonly description: string;
  readonly type: AcceptanceCriteriaType;
  readonly severity: AcceptanceCriteriaSeverity;
}

export interface UpdateAcceptanceCriteriaInput {
  readonly ac_id: string;
  readonly status: AcceptanceCriteriaStatus;
  readonly verified_in?: string;
  readonly evidence?: string;
}

interface AcceptanceCriteriaIdRow {
  readonly id: string;
}

interface AcceptanceCriteriaRow {
  readonly id: string;
  readonly fu_id: string;
  readonly description: string;
  readonly type: AcceptanceCriteriaType;
  readonly severity: AcceptanceCriteriaSeverity;
  readonly status: AcceptanceCriteriaStatus;
  readonly verified_in: string | null;
  readonly evidence: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return true;
}

function isAcceptanceCriteriaIdRow(value: unknown): value is AcceptanceCriteriaIdRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string') {
    return false;
  }

  return true;
}

function isAcceptanceCriteriaType(value: string): value is AcceptanceCriteriaType {
  switch (value) {
    case ACCEPTANCE_CRITERIA_TYPES.FUNCTIONAL:
    case ACCEPTANCE_CRITERIA_TYPES.PERFORMANCE:
    case ACCEPTANCE_CRITERIA_TYPES.SECURITY:
    case ACCEPTANCE_CRITERIA_TYPES.EDGE_CASE:
      return true;
    default:
      return false;
  }
}

function isAcceptanceCriteriaSeverity(value: string): value is AcceptanceCriteriaSeverity {
  switch (value) {
    case ACCEPTANCE_CRITERIA_SEVERITIES.MUST:
    case ACCEPTANCE_CRITERIA_SEVERITIES.SHOULD:
    case ACCEPTANCE_CRITERIA_SEVERITIES.NICE_TO_HAVE:
      return true;
    default:
      return false;
  }
}

function isAcceptanceCriteriaStatus(value: string): value is AcceptanceCriteriaStatus {
  switch (value) {
    case ACCEPTANCE_CRITERIA_STATUSES.NOT_TESTED:
    case ACCEPTANCE_CRITERIA_STATUSES.PASSED:
    case ACCEPTANCE_CRITERIA_STATUSES.FAILED:
    case ACCEPTANCE_CRITERIA_STATUSES.BLOCKED:
      return true;
    default:
      return false;
  }
}

function isAcceptanceCriteriaRow(value: unknown): value is AcceptanceCriteriaRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string') {
    return false;
  }

  if (typeof value.fu_id !== 'string') {
    return false;
  }

  if (typeof value.description !== 'string') {
    return false;
  }

  if (typeof value.type !== 'string' || !isAcceptanceCriteriaType(value.type)) {
    return false;
  }

  if (typeof value.severity !== 'string' || !isAcceptanceCriteriaSeverity(value.severity)) {
    return false;
  }

  if (typeof value.status !== 'string' || !isAcceptanceCriteriaStatus(value.status)) {
    return false;
  }

  if (value.verified_in !== null && typeof value.verified_in !== 'string') {
    return false;
  }

  if (value.evidence !== null && typeof value.evidence !== 'string') {
    return false;
  }

  return true;
}

function mapAcceptanceCriteriaRow(row: AcceptanceCriteriaRow): AcceptanceCriteria {
  return {
    id: row.id,
    fu_id: row.fu_id,
    description: row.description,
    type: row.type,
    severity: row.severity,
    status: row.status,
    verified_in: row.verified_in,
    evidence: row.evidence,
  };
}

function getCounterFromId(id: string): number {
  const parts = id.split('_');

  if (parts.length < 2) {
    return 0;
  }

  if (parts[0] !== 'ac') {
    return 0;
  }

  const parsedCounter = Number(parts[1]);

  if (!Number.isInteger(parsedCounter) || parsedCounter < 1) {
    return 0;
  }

  return parsedCounter;
}

function getNextAcceptanceCriteriaCounter(): number {
  const db = getDb();
  const rows = db.prepare('SELECT id FROM acceptance_criteria ORDER BY id ASC').all();
  let currentMaxCounter = 0;

  for (const row of rows) {
    if (!isAcceptanceCriteriaIdRow(row)) {
      throw new TypeError('Invalid acceptance criteria id row returned from database.');
    }

    const counter = getCounterFromId(row.id);

    if (counter > currentMaxCounter) {
      currentMaxCounter = counter;
    }
  }

  return currentMaxCounter + 1;
}

function createAcceptanceCriteriaId(): string {
  const counter = getNextAcceptanceCriteriaCounter();

  return `ac_${counter}`;
}

function getAcceptanceCriteriaRowById(acId: string): AcceptanceCriteriaRow {
  const db = getDb();
  const row = db.prepare(
    `
      SELECT
        id,
        fu_id,
        description,
        type,
        severity,
        status,
        verified_in,
        evidence
      FROM acceptance_criteria
      WHERE id = ?
    `
  ).get(acId);

  if (!isAcceptanceCriteriaRow(row)) {
    throw new Error(`Acceptance criteria not found: ${acId}`);
  }

  return row;
}

export function addAcceptanceCriteria(input: AddAcceptanceCriteriaInput): AcceptanceCriteria {
  if (!isAcceptanceCriteriaType(input.type)) {
    throw new Error(`Invalid acceptance criteria type: ${input.type}`);
  }

  if (!isAcceptanceCriteriaSeverity(input.severity)) {
    throw new Error(`Invalid acceptance criteria severity: ${input.severity}`);
  }

  const db = getDb();
  const acceptanceCriteriaId = createAcceptanceCriteriaId();
  const initialStatus = ACCEPTANCE_CRITERIA_STATUSES.NOT_TESTED;
  const insertAcceptanceCriteria = db.transaction(
    (currentInput: AddAcceptanceCriteriaInput): AcceptanceCriteria => {
      db.prepare(
        `
          INSERT INTO acceptance_criteria (
            id,
            fu_id,
            description,
            type,
            severity,
            status,
            verified_in,
            evidence
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        acceptanceCriteriaId,
        currentInput.fu_id,
        currentInput.description,
        currentInput.type,
        currentInput.severity,
        initialStatus,
        null,
        null
      );

      logStatusChange({
        entity_type: STATUS_AUDIT_LOG_ENTITY_TYPES.ACCEPTANCE_CRITERIA,
        entity_id: acceptanceCriteriaId,
        old_status: null,
        new_status: initialStatus,
      });

      return {
        id: acceptanceCriteriaId,
        fu_id: currentInput.fu_id,
        description: currentInput.description,
        type: currentInput.type,
        severity: currentInput.severity,
        status: initialStatus,
        verified_in: null,
        evidence: null,
      };
    }
  );

  return insertAcceptanceCriteria(input);
}

export function updateAcceptanceCriteria(
  input: UpdateAcceptanceCriteriaInput
): AcceptanceCriteria {
  if (!isAcceptanceCriteriaStatus(input.status)) {
    throw new Error(`Invalid acceptance criteria status: ${input.status}`);
  }

  const db = getDb();
  const updateRow = db.transaction(
    (currentInput: UpdateAcceptanceCriteriaInput): AcceptanceCriteria => {
      const existingRow = getAcceptanceCriteriaRowById(currentInput.ac_id);
      const nextVerifiedIn =
        currentInput.verified_in === undefined
          ? existingRow.verified_in
          : currentInput.verified_in;
      const nextEvidence =
        currentInput.evidence === undefined
          ? existingRow.evidence
          : currentInput.evidence;

      db.prepare(
        `
          UPDATE acceptance_criteria
          SET status = ?,
              verified_in = ?,
              evidence = ?
          WHERE id = ?
        `
      ).run(currentInput.status, nextVerifiedIn, nextEvidence, currentInput.ac_id);

      logStatusChange({
        entity_type: STATUS_AUDIT_LOG_ENTITY_TYPES.ACCEPTANCE_CRITERIA,
        entity_id: currentInput.ac_id,
        old_status: existingRow.status,
        new_status: currentInput.status,
        context: nextVerifiedIn === null ? undefined : nextVerifiedIn,
      });

      return mapAcceptanceCriteriaRow({
        ...existingRow,
        status: currentInput.status,
        verified_in: nextVerifiedIn,
        evidence: nextEvidence,
      });
    }
  );

  return updateRow(input);
}
