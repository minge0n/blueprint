import { getDb } from '../index.js';
import type { AcceptanceCriteria } from '../../entities/acceptance-criteria.js';
import type { Feature } from '../../entities/feature.js';
import type { FunctionUnit } from '../../entities/function-unit.js';
import {
  ACCEPTANCE_CRITERIA_SEVERITIES,
  ACCEPTANCE_CRITERIA_STATUSES,
  ACCEPTANCE_CRITERIA_TYPES,
  FEATURE_PRIORITIES,
  FEATURE_STATUSES,
  FUNCTION_UNIT_STATUSES,
  type AcceptanceCriteriaSeverity,
  type AcceptanceCriteriaStatus,
  type AcceptanceCriteriaType,
  type FeaturePriority,
  type FeatureStatus,
  type FunctionUnitStatus,
} from '../../entities/types.js';
import { logStatusChange } from './status-audit-log.js';
import { STATUS_AUDIT_LOG_ENTITY_TYPES } from '../../entities/status-audit-log.js';

export interface CreateFeatureInput {
  readonly title: string;
  readonly scope: string;
  readonly out_of_scope: string;
  readonly priority: FeaturePriority;
  readonly depends_on?: Array<string>;
}

export interface ListFeaturesInput {
  readonly status?: FeatureStatus;
}

export interface FullFeature extends Feature {
  readonly function_units: Array<FunctionUnit>;
}

interface FeatureRow {
  readonly id: string;
  readonly title: string;
  readonly scope: string;
  readonly out_of_scope: string;
  readonly status: string;
  readonly priority: string;
}

interface FeatureDependencyRow {
  readonly feature_id: string;
  readonly depends_on: string;
}

interface FunctionUnitRow {
  readonly id: string;
  readonly feature_id: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly assigned_agent: string | null;
  readonly test_evidence: string | null;
  readonly failure_reason: string | null;
}

interface AcceptanceCriteriaRow {
  readonly id: string;
  readonly fu_id: string;
  readonly description: string;
  readonly type: string;
  readonly severity: string;
  readonly status: string;
  readonly verified_in: string | null;
  readonly evidence: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return true;
}

function isFeaturePriority(value: string): value is FeaturePriority {
  switch (value) {
    case FEATURE_PRIORITIES.P0:
    case FEATURE_PRIORITIES.P1:
    case FEATURE_PRIORITIES.P2:
      return true;
    default:
      return false;
  }
}

function isFeatureStatus(value: string): value is FeatureStatus {
  switch (value) {
    case FEATURE_STATUSES.DRAFT:
    case FEATURE_STATUSES.PLAN_REVIEW:
    case FEATURE_STATUSES.BUILDING:
    case FEATURE_STATUSES.BUILD_REVIEW:
    case FEATURE_STATUSES.DONE:
      return true;
    default:
      return false;
  }
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

function isFeatureRow(value: unknown): value is FeatureRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.id !== 'string') {
    return false;
  }

  if (typeof value.title !== 'string') {
    return false;
  }

  if (typeof value.scope !== 'string') {
    return false;
  }

  if (typeof value.out_of_scope !== 'string') {
    return false;
  }

  if (typeof value.status !== 'string') {
    return false;
  }

  if (typeof value.priority !== 'string') {
    return false;
  }

  return true;
}

function isFeatureDependencyRow(value: unknown): value is FeatureDependencyRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.feature_id !== 'string') {
    return false;
  }

  if (typeof value.depends_on !== 'string') {
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

  if (typeof value.title !== 'string') {
    return false;
  }

  if (typeof value.description !== 'string') {
    return false;
  }

  if (typeof value.status !== 'string') {
    return false;
  }

  if (value.assigned_agent !== null && typeof value.assigned_agent !== 'string') {
    return false;
  }

  if (value.test_evidence !== null && typeof value.test_evidence !== 'string') {
    return false;
  }

  if (value.failure_reason !== null && typeof value.failure_reason !== 'string') {
    return false;
  }

  return true;
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

  if (typeof value.type !== 'string') {
    return false;
  }

  if (typeof value.severity !== 'string') {
    return false;
  }

  if (typeof value.status !== 'string') {
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

function mapFeatureRow(row: FeatureRow, dependsOn: Array<string>): Feature {
  if (!isFeatureStatus(row.status)) {
    throw new TypeError(`Invalid feature status returned from database: ${row.status}`);
  }

  if (!isFeaturePriority(row.priority)) {
    throw new TypeError(`Invalid feature priority returned from database: ${row.priority}`);
  }

  return {
    id: row.id,
    title: row.title,
    scope: row.scope,
    out_of_scope: row.out_of_scope,
    status: row.status,
    priority: row.priority,
    depends_on: dependsOn,
  };
}

function mapFunctionUnitRow(
  row: FunctionUnitRow,
  acceptanceCriteria: Array<AcceptanceCriteria>
): FunctionUnit {
  if (!isFunctionUnitStatus(row.status)) {
    throw new TypeError(`Invalid function unit status returned from database: ${row.status}`);
  }

  return {
    id: row.id,
    feature_id: row.feature_id,
    title: row.title,
    description: row.description,
    acceptance_criteria: acceptanceCriteria,
    depends_on: [],
    status: row.status,
    assigned_agent: row.assigned_agent,
    test_evidence: row.test_evidence,
    failure_reason: row.failure_reason,
  };
}

function mapAcceptanceCriteriaRow(row: AcceptanceCriteriaRow): AcceptanceCriteria {
  if (!isAcceptanceCriteriaType(row.type)) {
    throw new TypeError(`Invalid acceptance criteria type returned from database: ${row.type}`);
  }

  if (!isAcceptanceCriteriaSeverity(row.severity)) {
    throw new TypeError(
      `Invalid acceptance criteria severity returned from database: ${row.severity}`
    );
  }

  if (!isAcceptanceCriteriaStatus(row.status)) {
    throw new TypeError(`Invalid acceptance criteria status returned from database: ${row.status}`);
  }

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

function slugifyFeatureTitle(title: string): string {
  const normalizedTitle = title.trim().toLowerCase();
  const segments = normalizedTitle.match(/[a-z0-9]+/g);

  if (segments === null || segments.length === 0) {
    return 'feature';
  }

  return segments.join('_');
}

function formatFeatureCounter(counter: number): string {
  return counter.toString().padStart(3, '0');
}

function normalizeDependsOn(dependsOn: Array<string> | undefined): Array<string> {
  if (dependsOn === undefined) {
    return [];
  }

  const dedupedDependsOn = new Set<string>();

  for (const featureId of dependsOn) {
    const normalizedFeatureId = featureId.trim();

    if (normalizedFeatureId.length > 0) {
      dedupedDependsOn.add(normalizedFeatureId);
    }
  }

  return Array.from(dedupedDependsOn);
}

function createPlaceholderList(size: number): string {
  return Array.from({ length: size }, () => '?').join(', ');
}

function getFeatureDependencyMap(featureIds: Array<string>): Map<string, Array<string>> {
  const dependencyMap = new Map<string, Array<string>>();

  for (const featureId of featureIds) {
    dependencyMap.set(featureId, []);
  }

  if (featureIds.length === 0) {
    return dependencyMap;
  }

  const db = getDb();
  const placeholders = createPlaceholderList(featureIds.length);
  const rows = db
    .prepare(
      `
        SELECT feature_id, depends_on
        FROM feature_dependencies
        WHERE feature_id IN (${placeholders})
        ORDER BY depends_on ASC
      `
    )
    .all(...featureIds);

  for (const row of rows) {
    if (!isFeatureDependencyRow(row)) {
      throw new TypeError('Invalid feature dependency row returned from database.');
    }

    const dependencies = dependencyMap.get(row.feature_id);

    if (dependencies !== undefined) {
      dependencies.push(row.depends_on);
    }
  }

  return dependencyMap;
}

function getNextFeatureId(title: string): string {
  const db = getDb();
  const slug = slugifyFeatureTitle(title);
  const rows = db
    .prepare(
      `
        SELECT id
        FROM features
        WHERE id GLOB ?
        ORDER BY id ASC
      `
    )
    .all(`feat_${slug}_[0-9][0-9][0-9]`);
  let highestCounter = 0;

  for (const row of rows) {
    if (!isRecord(row) || typeof row.id !== 'string') {
      throw new TypeError('Invalid feature id row returned from database.');
    }

    const match = row.id.match(/_(\d{3})$/);

    if (match === null) {
      continue;
    }

    const counterText = match[1];

    if (counterText === undefined) {
      continue;
    }

    const parsedCounter = Number.parseInt(counterText, 10);

    if (parsedCounter > highestCounter) {
      highestCounter = parsedCounter;
    }
  }

  return `feat_${slug}_${formatFeatureCounter(highestCounter + 1)}`;
}

function validateFeaturePriority(priority: string): FeaturePriority {
  if (!isFeaturePriority(priority)) {
    throw new Error(`Invalid feature priority: ${priority}`);
  }

  return priority;
}

function validateFeatureStatus(status: string): FeatureStatus {
  if (!isFeatureStatus(status)) {
    throw new Error(`Invalid feature status: ${status}`);
  }

  return status;
}

function getMissingFeatureDependencies(dependsOn: Array<string>): Array<string> {
  if (dependsOn.length === 0) {
    return [];
  }

  const db = getDb();
  const placeholders = createPlaceholderList(dependsOn.length);
  const rows = db
    .prepare(
      `
        SELECT id
        FROM features
        WHERE id IN (${placeholders})
      `
    )
    .all(...dependsOn);
  const existingFeatureIds = new Set<string>();

  for (const row of rows) {
    if (!isRecord(row) || typeof row.id !== 'string') {
      throw new TypeError('Invalid feature dependency validation row returned from database.');
    }

    existingFeatureIds.add(row.id);
  }

  const missingFeatureIds: Array<string> = [];

  for (const featureId of dependsOn) {
    if (!existingFeatureIds.has(featureId)) {
      missingFeatureIds.push(featureId);
    }
  }

  return missingFeatureIds;
}

function getFeatureRowById(featureId: string): FeatureRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT
          id,
          title,
          scope,
          out_of_scope,
          status,
          priority
        FROM features
        WHERE id = ?
      `
    )
    .get(featureId);

  if (row === undefined) {
    return null;
  }

  if (!isFeatureRow(row)) {
    throw new TypeError('Invalid feature row returned from database.');
  }

  return row;
}

function buildFeature(row: FeatureRow, dependencyMap: Map<string, Array<string>>): Feature {
  const dependsOn = dependencyMap.get(row.id);

  return mapFeatureRow(row, dependsOn === undefined ? [] : dependsOn);
}

function getFunctionUnitRowsForFeature(featureId: string): Array<FunctionUnitRow> {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT
          id,
          feature_id,
          title,
          description,
          status,
          assigned_agent,
          test_evidence,
          failure_reason
        FROM function_units
        WHERE feature_id = ?
        ORDER BY id ASC
      `
    )
    .all(featureId);
  const functionUnitRows: Array<FunctionUnitRow> = [];

  for (const row of rows) {
    if (!isFunctionUnitRow(row)) {
      throw new TypeError('Invalid function unit row returned from database.');
    }

    functionUnitRows.push(row);
  }

  return functionUnitRows;
}

function getAcceptanceCriteriaMap(functionUnitIds: Array<string>): Map<string, Array<AcceptanceCriteria>> {
  const acceptanceCriteriaMap = new Map<string, Array<AcceptanceCriteria>>();

  for (const functionUnitId of functionUnitIds) {
    acceptanceCriteriaMap.set(functionUnitId, []);
  }

  if (functionUnitIds.length === 0) {
    return acceptanceCriteriaMap;
  }

  const db = getDb();
  const placeholders = createPlaceholderList(functionUnitIds.length);
  const rows = db
    .prepare(
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
        WHERE fu_id IN (${placeholders})
        ORDER BY id ASC
      `
    )
    .all(...functionUnitIds);

  for (const row of rows) {
    if (!isAcceptanceCriteriaRow(row)) {
      throw new TypeError('Invalid acceptance criteria row returned from database.');
    }

    const acceptanceCriteria = acceptanceCriteriaMap.get(row.fu_id);

    if (acceptanceCriteria !== undefined) {
      acceptanceCriteria.push(mapAcceptanceCriteriaRow(row));
    }
  }

  return acceptanceCriteriaMap;
}

export function createFeature(input: CreateFeatureInput): Feature {
  const db = getDb();
  const priority = validateFeaturePriority(input.priority);
  const dependsOn = normalizeDependsOn(input.depends_on);
  const missingDependencies = getMissingFeatureDependencies(dependsOn);

  if (missingDependencies.length > 0) {
    throw new Error(
      `Unknown feature dependencies: ${missingDependencies.join(', ')}`
    );
  }

  const featureId = getNextFeatureId(input.title);
  const insertFeature = db.transaction((): void => {
    db.prepare(
      `
        INSERT INTO features (id, title, scope, out_of_scope, status, priority)
        VALUES (?, ?, ?, ?, ?, ?)
      `
    ).run(
      featureId,
      input.title,
      input.scope,
      input.out_of_scope,
      FEATURE_STATUSES.DRAFT,
      priority
    );

    for (const dependencyId of dependsOn) {
      db.prepare(
        `
          INSERT INTO feature_dependencies (feature_id, depends_on)
          VALUES (?, ?)
        `
      ).run(featureId, dependencyId);
    }

    logStatusChange({
      entity_type: STATUS_AUDIT_LOG_ENTITY_TYPES.FEATURE,
      entity_id: featureId,
      old_status: null,
      new_status: FEATURE_STATUSES.DRAFT,
    });
  });

  insertFeature();

  const feature = getFeatureById(featureId);

  if (feature === null) {
    throw new Error(`Created feature could not be loaded: ${featureId}`);
  }

  return feature;
}

export function listFeatures(input: ListFeaturesInput = {}): Array<Feature> {
  const db = getDb();
  const featureRows =
    input.status === undefined
      ? db.prepare(
          `
            SELECT
              id,
              title,
              scope,
              out_of_scope,
              status,
              priority
            FROM features
            ORDER BY id ASC
          `
        ).all()
      : db.prepare(
          `
            SELECT
              id,
              title,
              scope,
              out_of_scope,
              status,
              priority
            FROM features
            WHERE status = ?
            ORDER BY id ASC
          `
        ).all(validateFeatureStatus(input.status));
  const mappedFeatureRows: Array<FeatureRow> = [];

  for (const row of featureRows) {
    if (!isFeatureRow(row)) {
      throw new TypeError('Invalid feature row returned from database.');
    }

    mappedFeatureRows.push(row);
  }

  const featureIds = mappedFeatureRows.map((row) => row.id);
  const dependencyMap = getFeatureDependencyMap(featureIds);

  return mappedFeatureRows.map((row) => buildFeature(row, dependencyMap));
}

export function getFeatureById(featureId: string): Feature | null {
  const row = getFeatureRowById(featureId);

  if (row === null) {
    return null;
  }

  const dependencyMap = getFeatureDependencyMap([featureId]);

  return buildFeature(row, dependencyMap);
}

export function getFullFeatureById(featureId: string): FullFeature | null {
  const feature = getFeatureById(featureId);

  if (feature === null) {
    return null;
  }

  const functionUnitRows = getFunctionUnitRowsForFeature(featureId);
  const functionUnitIds = functionUnitRows.map((row) => row.id);
  const acceptanceCriteriaMap = getAcceptanceCriteriaMap(functionUnitIds);
  const functionUnits = functionUnitRows.map((row) => {
    const acceptanceCriteria = acceptanceCriteriaMap.get(row.id);

    return mapFunctionUnitRow(row, acceptanceCriteria === undefined ? [] : acceptanceCriteria);
  });

  return {
    ...feature,
    function_units: functionUnits,
  };
}
