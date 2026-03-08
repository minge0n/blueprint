import { getDb } from '../index.js';
import { validateIntegrationIssueRequirements } from './issue-integration.js';
import type {
  Issue,
  IssueCategory,
  IssueParentType,
  IssueSeverity,
  IssueStatus,
} from '../../entities/issue.js';
import {
  ISSUE_CATEGORIES,
  ISSUE_PARENT_TYPES,
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
} from '../../entities/issue.js';

export interface AddIssueInput {
  readonly parent_type: IssueParentType;
  readonly parent_id: string;
  readonly fu_id: string;
  readonly ac_id?: string;
  readonly related_fu_id?: string;
  readonly category: IssueCategory;
  readonly severity?: IssueSeverity;
  readonly title: string;
  readonly description: string;
  readonly suggested_fix?: string;
}

export interface ResolveIssueInput {
  readonly issue_id: string;
  readonly status: IssueStatus;
  readonly resolved_in: string;
  readonly resolution_note?: string;
}

export interface ListIssuesInput {
  readonly feature_id?: string;
  readonly status?: IssueStatus;
  readonly severity?: IssueSeverity;
  readonly category?: IssueCategory | Array<IssueCategory>;
}

interface IssueIdRow {
  readonly id: string;
}

interface IssueRow {
  readonly id: string;
  readonly parent_type: string;
  readonly parent_id: string;
  readonly fu_id: string;
  readonly ac_id: string | null;
  readonly related_fu_id: string | null;
  readonly category: string;
  readonly severity: string;
  readonly title: string;
  readonly description: string;
  readonly suggested_fix: string | null;
  readonly status: string;
  readonly resolved_in: string | null;
  readonly resolution_note: string | null;
}

interface FunctionUnitRow {
  readonly id: string;
  readonly feature_id: string;
}

interface AcceptanceCriteriaLinkRow {
  readonly id: string;
  readonly fu_id: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return true;
}

function isIssueParentType(value: string): value is IssueParentType {
  switch (value) {
    case ISSUE_PARENT_TYPES.PLAN:
    case ISSUE_PARENT_TYPES.BUILD:
      return true;
    default:
      return false;
  }
}

function isIssueCategory(value: string): value is IssueCategory {
  switch (value) {
    case ISSUE_CATEGORIES.MISSING_CASE:
    case ISSUE_CATEGORIES.WRONG_ASSUMPTION:
    case ISSUE_CATEGORIES.SCOPE_CREEP:
    case ISSUE_CATEGORIES.AMBIGUITY:
    case ISSUE_CATEGORIES.DEPENDENCY_GAP:
    case ISSUE_CATEGORIES.SECURITY_GAP:
    case ISSUE_CATEGORIES.PERFORMANCE_GAP:
    case ISSUE_CATEGORIES.IMPLEMENTATION:
    case ISSUE_CATEGORIES.INTEGRATION_CONFLICT:
    case ISSUE_CATEGORIES.RACE_CONDITION:
    case ISSUE_CATEGORIES.INTERFACE_MISMATCH:
      return true;
    default:
      return false;
  }
}

function isIssueSeverity(value: string): value is IssueSeverity {
  switch (value) {
    case ISSUE_SEVERITIES.CRITICAL:
    case ISSUE_SEVERITIES.MAJOR:
    case ISSUE_SEVERITIES.MINOR:
    case ISSUE_SEVERITIES.NITPICK:
      return true;
    default:
      return false;
  }
}

function isIssueStatus(value: string): value is IssueStatus {
  switch (value) {
    case ISSUE_STATUSES.OPEN:
    case ISSUE_STATUSES.IN_PROGRESS:
    case ISSUE_STATUSES.RESOLVED:
    case ISSUE_STATUSES.WONT_FIX:
      return true;
    default:
      return false;
  }
}

function isIssueIdRow(value: unknown): value is IssueIdRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string') {
    return false;
  }

  return true;
}

function isIssueRow(value: unknown): value is IssueRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string') {
    return false;
  }

  if (typeof value.parent_type !== 'string') {
    return false;
  }

  if (typeof value.parent_id !== 'string') {
    return false;
  }

  if (typeof value.fu_id !== 'string') {
    return false;
  }

  if (value.ac_id !== null && typeof value.ac_id !== 'string') {
    return false;
  }

  if (value.related_fu_id !== null && typeof value.related_fu_id !== 'string') {
    return false;
  }

  if (typeof value.category !== 'string') {
    return false;
  }

  if (typeof value.severity !== 'string') {
    return false;
  }

  if (typeof value.title !== 'string') {
    return false;
  }

  if (typeof value.description !== 'string') {
    return false;
  }

  if (value.suggested_fix !== null && typeof value.suggested_fix !== 'string') {
    return false;
  }

  if (typeof value.status !== 'string') {
    return false;
  }

  if (value.resolved_in !== null && typeof value.resolved_in !== 'string') {
    return false;
  }

  if (value.resolution_note !== null && typeof value.resolution_note !== 'string') {
    return false;
  }

  return true;
}

function isFunctionUnitRow(value: unknown): value is FunctionUnitRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string') {
    return false;
  }

  if (typeof value.feature_id !== 'string') {
    return false;
  }

  return true;
}

function isAcceptanceCriteriaLinkRow(value: unknown): value is AcceptanceCriteriaLinkRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string') {
    return false;
  }

  if (typeof value.fu_id !== 'string') {
    return false;
  }

  return true;
}

function mapIssueRow(row: IssueRow): Issue {
  if (!isIssueParentType(row.parent_type)) {
    throw new TypeError(`Invalid issue parent type returned from database: ${row.parent_type}`);
  }

  if (!isIssueCategory(row.category)) {
    throw new TypeError(`Invalid issue category returned from database: ${row.category}`);
  }

  if (!isIssueSeverity(row.severity)) {
    throw new TypeError(`Invalid issue severity returned from database: ${row.severity}`);
  }

  if (!isIssueStatus(row.status)) {
    throw new TypeError(`Invalid issue status returned from database: ${row.status}`);
  }

  return {
    id: row.id,
    parent_type: row.parent_type,
    parent_id: row.parent_id,
    fu_id: row.fu_id,
    ac_id: row.ac_id,
    related_fu_id: row.related_fu_id,
    category: row.category,
    severity: row.severity,
    title: row.title,
    description: row.description,
    suggested_fix: row.suggested_fix,
    status: row.status,
    resolved_in: row.resolved_in,
    resolution_note: row.resolution_note,
  };
}

function getCounterFromId(id: string): number {
  const parts = id.split('_');

  if (parts.length !== 2) {
    return 0;
  }

  if (parts[0] !== 'issue') {
    return 0;
  }

  const counterText = parts[1];

  if (counterText === undefined) {
    return 0;
  }

  const parsedCounter = Number.parseInt(counterText, 10);

  if (!Number.isInteger(parsedCounter) || parsedCounter < 1) {
    return 0;
  }

  return parsedCounter;
}

function getNextIssueCounter(): number {
  const db = getDb();
  const rows = db.prepare('SELECT id FROM issues ORDER BY id ASC').all();
  let currentMaxCounter = 0;

  for (const row of rows) {
    if (!isIssueIdRow(row)) {
      throw new TypeError('Invalid issue id row returned from database.');
    }

    const counter = getCounterFromId(row.id);

    if (counter > currentMaxCounter) {
      currentMaxCounter = counter;
    }
  }

  return currentMaxCounter + 1;
}

function createIssueId(): string {
  const counter = getNextIssueCounter();

  return `issue_${counter}`;
}

function validateIssueParentType(parentType: string): IssueParentType {
  if (!isIssueParentType(parentType)) {
    throw new Error(`Invalid issue parent type: ${parentType}`);
  }

  return parentType;
}

function validateIssueCategory(category: string): IssueCategory {
  if (!isIssueCategory(category)) {
    throw new Error(`Invalid issue category: ${category}`);
  }

  return category;
}

function validateIssueSeverity(severity: string): IssueSeverity {
  if (!isIssueSeverity(severity)) {
    throw new Error(`Invalid issue severity: ${severity}`);
  }

  return severity;
}

function validateIssueStatus(status: string): IssueStatus {
  if (!isIssueStatus(status)) {
    throw new Error(`Invalid issue status: ${status}`);
  }

  return status;
}

function getFunctionUnitRowById(fuId: string): FunctionUnitRow {
  const db = getDb();
  const row = db.prepare(
    `
      SELECT id, feature_id
      FROM function_units
      WHERE id = ?
    `
  ).get(fuId);

  if (!isFunctionUnitRow(row)) {
    throw new Error(`Function unit not found: ${fuId}`);
  }

  return row;
}

function getAcceptanceCriteriaLinkRowById(acId: string): AcceptanceCriteriaLinkRow {
  const db = getDb();
  const row = db.prepare(
    `
      SELECT id, fu_id
      FROM acceptance_criteria
      WHERE id = ?
    `
  ).get(acId);

  if (!isAcceptanceCriteriaLinkRow(row)) {
    throw new Error(`Acceptance criteria not found: ${acId}`);
  }

  return row;
}

function getIssueRowById(issueId: string): IssueRow {
  const db = getDb();
  const row = db.prepare(
    `
      SELECT
        id,
        parent_type,
        parent_id,
        fu_id,
        ac_id,
        related_fu_id,
        category,
        severity,
        title,
        description,
        suggested_fix,
        status,
        resolved_in,
        resolution_note
      FROM issues
      WHERE id = ?
    `
  ).get(issueId);

  if (!isIssueRow(row)) {
    throw new Error(`Issue not found: ${issueId}`);
  }

  return row;
}

function normalizeOptionalString(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  return value;
}

function normalizeCategories(
  category: IssueCategory | Array<IssueCategory> | undefined
): Array<IssueCategory> {
  if (category === undefined) {
    return [];
  }

  if (typeof category === 'string') {
    return [validateIssueCategory(category)];
  }

  const dedupedCategories = new Set<IssueCategory>();

  for (const currentCategory of category) {
    dedupedCategories.add(validateIssueCategory(currentCategory));
  }

  return Array.from(dedupedCategories);
}

function buildListIssuesQuery(input: ListIssuesInput): {
  readonly sql: string;
  readonly parameters: Array<string>;
} {
  const whereClauses: Array<string> = [];
  const parameters: Array<string> = [];
  const categories = normalizeCategories(input.category);

  if (input.feature_id !== undefined) {
    whereClauses.push('function_units.feature_id = ?');
    parameters.push(input.feature_id);
  }

  if (input.status !== undefined) {
    whereClauses.push('issues.status = ?');
    parameters.push(validateIssueStatus(input.status));
  }

  if (input.severity !== undefined) {
    whereClauses.push('issues.severity = ?');
    parameters.push(validateIssueSeverity(input.severity));
  }

  if (categories.length > 0) {
    const placeholders = Array.from({ length: categories.length }, () => '?').join(', ');

    whereClauses.push(`issues.category IN (${placeholders})`);
    parameters.push(...categories);
  }

  const whereSql =
    whereClauses.length === 0
      ? ''
      : `WHERE ${whereClauses.join(' AND ')}`;

  return {
    sql: `
      SELECT
        issues.id,
        issues.parent_type,
        issues.parent_id,
        issues.fu_id,
        issues.ac_id,
        issues.related_fu_id,
        issues.category,
        issues.severity,
        issues.title,
        issues.description,
        issues.suggested_fix,
        issues.status,
        issues.resolved_in,
        issues.resolution_note
      FROM issues
      INNER JOIN function_units
        ON function_units.id = issues.fu_id
      ${whereSql}
      ORDER BY
        CASE
          WHEN issues.status = 'open' AND issues.severity = 'critical' THEN 0
          ELSE 1
        END ASC,
        CASE issues.severity
          WHEN 'critical' THEN 0
          WHEN 'major' THEN 1
          WHEN 'minor' THEN 2
          WHEN 'nitpick' THEN 3
          ELSE 4
        END ASC,
        CASE issues.status
          WHEN 'open' THEN 0
          WHEN 'in_progress' THEN 1
          WHEN 'resolved' THEN 2
          WHEN 'wont_fix' THEN 3
          ELSE 4
        END ASC,
        issues.id ASC
    `,
    parameters,
  };
}

export function addIssue(input: AddIssueInput): Issue {
  const db = getDb();
  const parentType = validateIssueParentType(input.parent_type);
  const category = validateIssueCategory(input.category);
  const severity =
    input.severity === undefined
      ? category === ISSUE_CATEGORIES.INTEGRATION_CONFLICT ||
        category === ISSUE_CATEGORIES.RACE_CONDITION ||
        category === ISSUE_CATEGORIES.INTERFACE_MISMATCH
          ? ISSUE_SEVERITIES.CRITICAL
          : (() => {
              throw new Error(`severity is required for category ${category}`);
            })()
      : validateIssueSeverity(input.severity);
  const functionUnit = getFunctionUnitRowById(input.fu_id);
  const acId = normalizeOptionalString(input.ac_id);
  const relatedFuId = normalizeOptionalString(input.related_fu_id);
  const suggestedFix = normalizeOptionalString(input.suggested_fix);

  if (acId !== null) {
    const acceptanceCriteria = getAcceptanceCriteriaLinkRowById(acId);

    if (acceptanceCriteria.fu_id !== functionUnit.id) {
      throw new Error(`Acceptance criteria ${acId} does not belong to function unit ${input.fu_id}`);
    }
  }

  if (relatedFuId !== null) {
    getFunctionUnitRowById(relatedFuId);
  }

  validateIntegrationIssueRequirements({
    category,
    description: input.description,
    related_fu_id: relatedFuId === null ? undefined : relatedFuId,
  });

  if (category === ISSUE_CATEGORIES.INTEGRATION_CONFLICT && relatedFuId === null) {
    throw new Error('related_fu_id is required for integration_conflict issues');
  }

  const issueId = createIssueId();
  const initialStatus = ISSUE_STATUSES.OPEN;
  const insertIssue = db.transaction((currentInput: AddIssueInput): Issue => {
    db.prepare(
      `
        INSERT INTO issues (
          id,
          parent_type,
          parent_id,
          fu_id,
          ac_id,
          related_fu_id,
          category,
          severity,
          title,
          description,
          suggested_fix,
          status,
          resolved_in,
          resolution_note
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      issueId,
      parentType,
      currentInput.parent_id,
      functionUnit.id,
      acId,
      relatedFuId,
      category,
      severity,
      currentInput.title,
      currentInput.description,
      suggestedFix,
      initialStatus,
      null,
      null
    );

    return {
      id: issueId,
      parent_type: parentType,
      parent_id: currentInput.parent_id,
      fu_id: functionUnit.id,
      ac_id: acId,
      related_fu_id: relatedFuId,
      category,
      severity,
      title: currentInput.title,
      description: currentInput.description,
      suggested_fix: suggestedFix,
      status: initialStatus,
      resolved_in: null,
      resolution_note: null,
    };
  });

  return insertIssue(input);
}

export function resolveIssue(input: ResolveIssueInput): Issue {
  const status = validateIssueStatus(input.status);

  if (status !== ISSUE_STATUSES.RESOLVED && status !== ISSUE_STATUSES.WONT_FIX) {
    throw new Error(`Issue status must be resolved or wont_fix. Received: ${input.status}`);
  }

  const db = getDb();
  const updateIssue = db.transaction((currentInput: ResolveIssueInput): Issue => {
    const existingRow = getIssueRowById(currentInput.issue_id);
    const resolutionNote = normalizeOptionalString(currentInput.resolution_note);

    db.prepare(
      `
        UPDATE issues
        SET status = ?,
            resolved_in = ?,
            resolution_note = ?
        WHERE id = ?
      `
    ).run(status, currentInput.resolved_in, resolutionNote, currentInput.issue_id);

    return mapIssueRow({
      ...existingRow,
      status,
      resolved_in: currentInput.resolved_in,
      resolution_note: resolutionNote,
    });
  });

  return updateIssue(input);
}

export function listIssues(input: ListIssuesInput = {}): Array<Issue> {
  const db = getDb();
  const query = buildListIssuesQuery(input);
  const rows = db.prepare(query.sql).all(...query.parameters);
  const issues: Array<Issue> = [];

  for (const row of rows) {
    if (!isIssueRow(row)) {
      throw new TypeError('Invalid issue row returned from database.');
    }

    issues.push(mapIssueRow(row));
  }

  return issues;
}
