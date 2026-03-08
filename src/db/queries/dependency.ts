import { getDb } from '../index.js';
import type { FunctionUnit, FunctionUnitDependency } from '../../entities/function-unit.js';
import {
  type FunctionUnitDependencyRecord,
  isFunctionUnitDependencyType,
} from '../../entities/fu-dependency.js';
import type { FunctionUnitDependencyType } from '../../entities/types.js';
import {
  addDependency as addDependencyToGraph,
  getDependencyAdjacencyList,
  getTopologicalOrder as getTopologicalOrderFromGraph,
  getUnblockedFUs as getUnblockedFUsFromGraph,
} from '../../graph/dependency.js';
import type {
  AdditionalBlockCheck,
  DependencyAdjacencyList,
  DependencyGraphData,
} from '../../graph/types.js';
import { getFullFeatureById } from './feature.js';

export interface AddDependencyInput {
  readonly fu_id: string;
  readonly depends_on_fu_id: string;
  readonly type: FunctionUnitDependencyType;
}

interface FunctionUnitIdentityRow {
  readonly id: string;
  readonly feature_id: string;
}

interface FunctionUnitDependencyRow {
  readonly fu_id: string;
  readonly depends_on_fu_id: string;
  readonly type: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return true;
}

function isFunctionUnitIdentityRow(value: unknown): value is FunctionUnitIdentityRow {
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

function isFunctionUnitDependencyRow(value: unknown): value is FunctionUnitDependencyRow {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.fu_id !== 'string') {
    return false;
  }

  if (typeof value.depends_on_fu_id !== 'string') {
    return false;
  }

  if (typeof value.type !== 'string') {
    return false;
  }

  return true;
}

function createPlaceholderList(size: number): string {
  return Array.from({ length: size }, (): string => '?').join(', ');
}

function validateDependencyType(type: string): FunctionUnitDependencyType {
  if (!isFunctionUnitDependencyType(type)) {
    throw new Error(`Invalid dependency type: ${type}`);
  }

  return type;
}

function mapDependencyRow(row: FunctionUnitDependencyRow): FunctionUnitDependencyRecord {
  return {
    fu_id: row.fu_id,
    depends_on_fu_id: row.depends_on_fu_id,
    type: validateDependencyType(row.type),
  };
}

function mapFunctionUnitDependency(row: FunctionUnitDependencyRow): FunctionUnitDependency {
  return {
    fu_id: row.depends_on_fu_id,
    type: validateDependencyType(row.type),
  };
}

function getFunctionUnitIdentityRowById(functionUnitId: string): FunctionUnitIdentityRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT id, feature_id
        FROM function_units
        WHERE id = ?
      `
    )
    .get(functionUnitId);

  if (row === undefined) {
    return null;
  }

  if (!isFunctionUnitIdentityRow(row)) {
    throw new TypeError('Invalid function unit identity row returned from database.');
  }

  return row;
}

function getExistingDependencyRow(
  fuId: string,
  dependsOnFuId: string
): FunctionUnitDependencyRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT fu_id, depends_on_fu_id, type
        FROM fu_dependencies
        WHERE fu_id = ? AND depends_on_fu_id = ?
      `
    )
    .get(fuId, dependsOnFuId);

  if (row === undefined) {
    return null;
  }

  if (!isFunctionUnitDependencyRow(row)) {
    throw new TypeError('Invalid dependency row returned from database.');
  }

  return row;
}

function getDependencyRecordsForFeature(featureId: string): Array<FunctionUnitDependencyRecord> {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT fd.fu_id, fd.depends_on_fu_id, fd.type
        FROM fu_dependencies AS fd
        INNER JOIN function_units AS fu ON fu.id = fd.fu_id
        WHERE fu.feature_id = ?
        ORDER BY fd.fu_id ASC, fd.depends_on_fu_id ASC
      `
    )
    .all(featureId);
  const dependencies: Array<FunctionUnitDependencyRecord> = [];

  for (const row of rows) {
    if (!isFunctionUnitDependencyRow(row)) {
      throw new TypeError('Invalid dependency row returned from database.');
    }

    dependencies.push(mapDependencyRow(row));
  }

  return dependencies;
}

export function getFunctionUnitDependencyMap(
  functionUnitIds: Array<string>
): Map<string, Array<FunctionUnitDependency>> {
  const dependencyMap = new Map<string, Array<FunctionUnitDependency>>();

  for (const functionUnitId of functionUnitIds) {
    dependencyMap.set(functionUnitId, []);
  }

  if (functionUnitIds.length === 0) {
    return dependencyMap;
  }

  const db = getDb();
  const placeholders = createPlaceholderList(functionUnitIds.length);
  const rows = db
    .prepare(
      `
        SELECT fu_id, depends_on_fu_id, type
        FROM fu_dependencies
        WHERE fu_id IN (${placeholders})
        ORDER BY fu_id ASC, depends_on_fu_id ASC
      `
    )
    .all(...functionUnitIds);

  for (const row of rows) {
    if (!isFunctionUnitDependencyRow(row)) {
      throw new TypeError('Invalid dependency row returned from database.');
    }

    const dependencies = dependencyMap.get(row.fu_id);

    if (dependencies === undefined) {
      throw new Error(`Dependency references unknown function unit: ${row.fu_id}`);
    }

    dependencies.push(mapFunctionUnitDependency(row));
  }

  return dependencyMap;
}

function hydrateFunctionUnitsWithDependencies(functionUnits: Array<FunctionUnit>): Array<FunctionUnit> {
  const dependencyMap = getFunctionUnitDependencyMap(
    functionUnits.map((functionUnit) => functionUnit.id)
  );

  return functionUnits.map((functionUnit) => {
    const dependencies = dependencyMap.get(functionUnit.id);

    return {
      ...functionUnit,
      depends_on: dependencies === undefined ? [] : dependencies,
    };
  });
}

function loadDependencyGraphData(featureId: string): DependencyGraphData {
  const feature = getFullFeatureById(featureId);

  if (feature === null) {
    throw new Error(`Feature not found: ${featureId}`);
  }

  return {
    feature_id: feature.id,
    function_units: hydrateFunctionUnitsWithDependencies(feature.function_units),
    dependencies: getDependencyRecordsForFeature(feature.id),
  };
}

export function loadFunctionUnitsWithDependencies(featureId: string): Array<FunctionUnit> {
  const graphData = loadDependencyGraphData(featureId);

  return graphData.function_units;
}

export function addDependency(input: AddDependencyInput): FunctionUnitDependencyRecord {
  const db = getDb();
  const dependencyType = validateDependencyType(input.type);
  const insertDependency = db.transaction(
    (currentInput: AddDependencyInput): FunctionUnitDependencyRecord => {
      const functionUnit = getFunctionUnitIdentityRowById(currentInput.fu_id);

      if (functionUnit === null) {
        throw new Error(`Function unit not found: ${currentInput.fu_id}`);
      }

      const prerequisiteFunctionUnit = getFunctionUnitIdentityRowById(
        currentInput.depends_on_fu_id
      );

      if (prerequisiteFunctionUnit === null) {
        throw new Error(`Function unit not found: ${currentInput.depends_on_fu_id}`);
      }

      if (functionUnit.feature_id !== prerequisiteFunctionUnit.feature_id) {
        throw new Error(
          `Cannot add dependency across features: ${currentInput.fu_id} belongs to ${functionUnit.feature_id}, ${currentInput.depends_on_fu_id} belongs to ${prerequisiteFunctionUnit.feature_id}.`
        );
      }

      const existingDependency = getExistingDependencyRow(
        currentInput.fu_id,
        currentInput.depends_on_fu_id
      );

      if (existingDependency !== null) {
        const existingRecord = mapDependencyRow(existingDependency);

        if (existingRecord.type === dependencyType) {
          throw new Error(
            `Dependency already exists: ${currentInput.fu_id} depends on ${currentInput.depends_on_fu_id}.`
          );
        }

        throw new Error(
          `Dependency already exists with type ${existingRecord.type}: ${currentInput.fu_id} depends on ${currentInput.depends_on_fu_id}.`
        );
      }

      addDependencyToGraph(loadDependencyGraphData(functionUnit.feature_id), {
        fu_id: currentInput.fu_id,
        depends_on_fu_id: currentInput.depends_on_fu_id,
        type: dependencyType,
      });

      db.prepare(
        `
          INSERT INTO fu_dependencies (fu_id, depends_on_fu_id, type)
          VALUES (?, ?, ?)
        `
      ).run(currentInput.fu_id, currentInput.depends_on_fu_id, dependencyType);

      return {
        fu_id: currentInput.fu_id,
        depends_on_fu_id: currentInput.depends_on_fu_id,
        type: dependencyType,
      };
    }
  );

  return insertDependency(input);
}

export function getUnblockedFUs(
  featureId: string,
  additionalBlockCheck?: AdditionalBlockCheck
): Array<FunctionUnit> {
  return getUnblockedFUsFromGraph(loadDependencyGraphData(featureId), additionalBlockCheck);
}

export function getTopologicalOrder(featureId: string): Array<FunctionUnit> {
  return getTopologicalOrderFromGraph(loadDependencyGraphData(featureId));
}

export function getDependencyGraph(featureId: string): DependencyAdjacencyList {
  return getDependencyAdjacencyList(loadDependencyGraphData(featureId));
}
