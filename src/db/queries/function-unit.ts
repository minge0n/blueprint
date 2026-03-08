import { getDb } from '../index.js';
import { logStatusChange } from './status-audit-log.js';
import {
  STATUS_AUDIT_LOG_ENTITY_TYPES,
} from '../../entities/status-audit-log.js';
import type { FunctionUnit } from '../../entities/function-unit.js';
import {
  FUNCTION_UNIT_STATUSES,
  type FunctionUnitStatus,
} from '../../entities/types.js';

export interface AddFunctionUnitInput {
  readonly feature_id: string;
  readonly title: string;
  readonly description: string;
}

interface FunctionUnitIdRow {
  readonly id: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return true;
}

function isFunctionUnitIdRow(value: unknown): value is FunctionUnitIdRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string') {
    return false;
  }

  return true;
}

function isFunctionUnitStatus(value: string): value is FunctionUnitStatus {
  switch (value) {
    case FUNCTION_UNIT_STATUSES.PENDING:
    case FUNCTION_UNIT_STATUSES.IN_PROGRESS:
    case FUNCTION_UNIT_STATUSES.PASSED:
    case FUNCTION_UNIT_STATUSES.FAILED:
      return true;
    default:
      return false;
  }
}

function slugifyTitle(title: string): string {
  const normalizedTitle = title.trim().toLowerCase();
  const slug = normalizedTitle
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '');

  if (slug.length === 0) {
    return 'function_unit';
  }

  return slug;
}

function getCounterFromId(id: string): number {
  const parts = id.split('_');

  if (parts.length < 3) {
    return 0;
  }

  if (parts[0] !== 'fu') {
    return 0;
  }

  const parsedCounter = Number(parts[1]);

  if (!Number.isInteger(parsedCounter) || parsedCounter < 1) {
    return 0;
  }

  return parsedCounter;
}

function getNextFunctionUnitCounter(): number {
  const db = getDb();
  const rows = db.prepare('SELECT id FROM function_units ORDER BY id ASC').all();
  let currentMaxCounter = 0;

  for (const row of rows) {
    if (!isFunctionUnitIdRow(row)) {
      throw new TypeError('Invalid function unit id row returned from database.');
    }

    const counter = getCounterFromId(row.id);

    if (counter > currentMaxCounter) {
      currentMaxCounter = counter;
    }
  }

  return currentMaxCounter + 1;
}

function createFunctionUnitId(title: string): string {
  const counter = getNextFunctionUnitCounter();
  const slug = slugifyTitle(title);

  return `fu_${counter}_${slug}`;
}

function buildFunctionUnit(
  input: AddFunctionUnitInput,
  id: string,
  status: FunctionUnitStatus
): FunctionUnit {
  return {
    id,
    feature_id: input.feature_id,
    title: input.title,
    description: input.description,
    acceptance_criteria: [],
    depends_on: [],
    status,
    assigned_agent: null,
    test_evidence: null,
    failure_reason: null,
  };
}

export function addFunctionUnit(input: AddFunctionUnitInput): FunctionUnit {
  const db = getDb();
  const functionUnitId = createFunctionUnitId(input.title);
  const initialStatus = FUNCTION_UNIT_STATUSES.PENDING;
  const insertFunctionUnit = db.transaction((currentInput: AddFunctionUnitInput): FunctionUnit => {
    db.prepare(
      `
        INSERT INTO function_units (
          id,
          feature_id,
          title,
          description,
          status
        )
        VALUES (?, ?, ?, ?, ?)
      `
    ).run(
      functionUnitId,
      currentInput.feature_id,
      currentInput.title,
      currentInput.description,
      initialStatus
    );

    logStatusChange({
      entity_type: STATUS_AUDIT_LOG_ENTITY_TYPES.FUNCTION_UNIT,
      entity_id: functionUnitId,
      old_status: null,
      new_status: initialStatus,
    });

    return buildFunctionUnit(currentInput, functionUnitId, initialStatus);
  });

  if (!isFunctionUnitStatus(initialStatus)) {
    throw new TypeError('Invalid function unit status configured for creation.');
  }

  return insertFunctionUnit(input);
}
