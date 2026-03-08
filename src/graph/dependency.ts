import type { FunctionUnit } from '../entities/function-unit.js';
import type { FunctionUnitDependencyRecord } from '../entities/fu-dependency.js';
import {
  FUNCTION_UNIT_DEPENDENCY_TYPES,
  FUNCTION_UNIT_STATUSES,
} from '../entities/types.js';
import type {
  AdditionalBlockCheck,
  DependencyAdjacencyList,
  DependencyGraphData,
} from './types.js';

function getFunctionUnitMap(graphData: DependencyGraphData): Map<string, FunctionUnit> {
  const functionUnitMap = new Map<string, FunctionUnit>();

  for (const functionUnit of graphData.function_units) {
    functionUnitMap.set(functionUnit.id, functionUnit);
  }

  return functionUnitMap;
}

function getFunctionUnitOrderMap(graphData: DependencyGraphData): Map<string, number> {
  const orderMap = new Map<string, number>();

  for (let index = 0; index < graphData.function_units.length; index += 1) {
    const functionUnit = graphData.function_units[index];

    if (functionUnit === undefined) {
      throw new TypeError('Missing function unit while building dependency order map.');
    }

    orderMap.set(functionUnit.id, index);
  }

  return orderMap;
}

function getOrderIndex(orderMap: Map<string, number>, fuId: string): number {
  const orderIndex = orderMap.get(fuId);

  if (orderIndex === undefined) {
    throw new Error(`Function unit not found in dependency graph: ${fuId}`);
  }

  return orderIndex;
}

function insertInStableOrder(
  queue: Array<string>,
  fuId: string,
  orderMap: Map<string, number>
): void {
  queue.push(fuId);
  queue.sort((leftFuId: string, rightFuId: string): number => {
    return getOrderIndex(orderMap, leftFuId) - getOrderIndex(orderMap, rightFuId);
  });
}

function getDependencyMap(
  graphData: DependencyGraphData
): Map<string, Array<FunctionUnitDependencyRecord>> {
  const dependencyMap = new Map<string, Array<FunctionUnitDependencyRecord>>();

  for (const functionUnit of graphData.function_units) {
    dependencyMap.set(functionUnit.id, []);
  }

  for (const dependency of graphData.dependencies) {
    const dependencies = dependencyMap.get(dependency.fu_id);

    if (dependencies === undefined) {
      throw new Error(`Dependency references unknown function unit: ${dependency.fu_id}`);
    }

    dependencies.push(dependency);
  }

  return dependencyMap;
}

function getHardDependentsMap(graphData: DependencyGraphData): Map<string, Array<string>> {
  const dependentsMap = new Map<string, Array<string>>();

  for (const functionUnit of graphData.function_units) {
    dependentsMap.set(functionUnit.id, []);
  }

  for (const dependency of graphData.dependencies) {
    if (dependency.type !== FUNCTION_UNIT_DEPENDENCY_TYPES.HARD) {
      continue;
    }

    const dependents = dependentsMap.get(dependency.depends_on_fu_id);

    if (dependents === undefined) {
      throw new Error(
        `Dependency references unknown prerequisite function unit: ${dependency.depends_on_fu_id}`
      );
    }

    dependents.push(dependency.fu_id);
  }

  return dependentsMap;
}

function hasHardPath(
  startFuId: string,
  targetFuId: string,
  dependentsMap: Map<string, Array<string>>
): boolean {
  const stack: Array<string> = [startFuId];
  const visited = new Set<string>();

  while (stack.length > 0) {
    const currentFuId = stack.pop();

    if (currentFuId === undefined) {
      continue;
    }

    if (currentFuId === targetFuId) {
      return true;
    }

    if (visited.has(currentFuId)) {
      continue;
    }

    visited.add(currentFuId);

    const dependents = dependentsMap.get(currentFuId);

    if (dependents === undefined) {
      throw new Error(`Dependency graph is missing function unit: ${currentFuId}`);
    }

    for (const dependentFuId of dependents) {
      if (!visited.has(dependentFuId)) {
        stack.push(dependentFuId);
      }
    }
  }

  return false;
}

export function addDependency(
  graphData: DependencyGraphData,
  dependency: FunctionUnitDependencyRecord
): DependencyGraphData {
  const functionUnitMap = getFunctionUnitMap(graphData);

  if (!functionUnitMap.has(dependency.fu_id)) {
    throw new Error(`Function unit not found in dependency graph: ${dependency.fu_id}`);
  }

  if (!functionUnitMap.has(dependency.depends_on_fu_id)) {
    throw new Error(
      `Dependency target not found in dependency graph: ${dependency.depends_on_fu_id}`
    );
  }

  if (dependency.type === FUNCTION_UNIT_DEPENDENCY_TYPES.HARD) {
    const dependentsMap = getHardDependentsMap(graphData);
    const createsCycle = hasHardPath(
      dependency.fu_id,
      dependency.depends_on_fu_id,
      dependentsMap
    );

    if (createsCycle) {
      throw new Error(
        `Adding hard dependency ${dependency.fu_id} -> ${dependency.depends_on_fu_id} creates a cycle.`
      );
    }
  }

  return {
    feature_id: graphData.feature_id,
    function_units: [...graphData.function_units],
    dependencies: [...graphData.dependencies, dependency],
  };
}

export function getUnblockedFUs(
  graphData: DependencyGraphData,
  additionalBlockCheck?: AdditionalBlockCheck
): Array<FunctionUnit> {
  const functionUnitMap = getFunctionUnitMap(graphData);
  const dependencyMap = getDependencyMap(graphData);
  const unblockedFunctionUnits: Array<FunctionUnit> = [];

  for (const functionUnit of graphData.function_units) {
    if (additionalBlockCheck !== undefined && additionalBlockCheck(functionUnit.id)) {
      continue;
    }

    const dependencies = dependencyMap.get(functionUnit.id);

    if (dependencies === undefined) {
      throw new Error(`Dependency graph is missing function unit: ${functionUnit.id}`);
    }

    let isBlocked = false;

    for (const dependency of dependencies) {
      if (dependency.type !== FUNCTION_UNIT_DEPENDENCY_TYPES.HARD) {
        continue;
      }

      const prerequisiteFunctionUnit = functionUnitMap.get(dependency.depends_on_fu_id);

      if (prerequisiteFunctionUnit === undefined) {
        throw new Error(
          `Dependency graph is missing prerequisite function unit: ${dependency.depends_on_fu_id}`
        );
      }

      if (prerequisiteFunctionUnit.status !== FUNCTION_UNIT_STATUSES.PASSED) {
        isBlocked = true;
        break;
      }
    }

    if (!isBlocked) {
      unblockedFunctionUnits.push(functionUnit);
    }
  }

  return unblockedFunctionUnits;
}

export function getTopologicalOrder(graphData: DependencyGraphData): Array<FunctionUnit> {
  const functionUnitMap = getFunctionUnitMap(graphData);
  const functionUnitOrderMap = getFunctionUnitOrderMap(graphData);
  const indegreeMap = new Map<string, number>();
  const dependentsMap = new Map<string, Array<string>>();

  for (const functionUnit of graphData.function_units) {
    indegreeMap.set(functionUnit.id, 0);
    dependentsMap.set(functionUnit.id, []);
  }

  for (const dependency of graphData.dependencies) {
    if (dependency.type !== FUNCTION_UNIT_DEPENDENCY_TYPES.HARD) {
      continue;
    }

    const dependentCount = indegreeMap.get(dependency.fu_id);

    if (dependentCount === undefined) {
      throw new Error(`Dependency references unknown function unit: ${dependency.fu_id}`);
    }

    indegreeMap.set(dependency.fu_id, dependentCount + 1);

    const dependents = dependentsMap.get(dependency.depends_on_fu_id);

    if (dependents === undefined) {
      throw new Error(
        `Dependency references unknown prerequisite function unit: ${dependency.depends_on_fu_id}`
      );
    }

    dependents.push(dependency.fu_id);
  }

  const readyQueue: Array<string> = [];

  for (const functionUnit of graphData.function_units) {
    const indegree = indegreeMap.get(functionUnit.id);

    if (indegree === undefined) {
      throw new Error(`Dependency graph is missing function unit: ${functionUnit.id}`);
    }

    if (indegree === 0) {
      insertInStableOrder(readyQueue, functionUnit.id, functionUnitOrderMap);
    }
  }

  const orderedFunctionUnits: Array<FunctionUnit> = [];

  while (readyQueue.length > 0) {
    const nextFuId = readyQueue.shift();

    if (nextFuId === undefined) {
      continue;
    }

    const functionUnit = functionUnitMap.get(nextFuId);

    if (functionUnit === undefined) {
      throw new Error(`Dependency graph is missing function unit: ${nextFuId}`);
    }

    orderedFunctionUnits.push(functionUnit);

    const dependents = dependentsMap.get(nextFuId);

    if (dependents === undefined) {
      throw new Error(`Dependency graph is missing function unit: ${nextFuId}`);
    }

    for (const dependentFuId of dependents) {
      const currentIndegree = indegreeMap.get(dependentFuId);

      if (currentIndegree === undefined) {
        throw new Error(`Dependency graph is missing function unit: ${dependentFuId}`);
      }

      const nextIndegree = currentIndegree - 1;
      indegreeMap.set(dependentFuId, nextIndegree);

      if (nextIndegree === 0) {
        insertInStableOrder(readyQueue, dependentFuId, functionUnitOrderMap);
      }
    }
  }

  if (orderedFunctionUnits.length !== graphData.function_units.length) {
    throw new Error('Dependency graph contains a hard dependency cycle.');
  }

  return orderedFunctionUnits;
}

export function getDependencyAdjacencyList(
  graphData: DependencyGraphData
): DependencyAdjacencyList {
  const dependencyMap = getDependencyMap(graphData);

  return {
    feature_id: graphData.feature_id,
    function_units: graphData.function_units.map((functionUnit) => {
      const dependencies = dependencyMap.get(functionUnit.id);

      if (dependencies === undefined) {
        throw new Error(`Dependency graph is missing function unit: ${functionUnit.id}`);
      }

      return {
        fu_id: functionUnit.id,
        title: functionUnit.title,
        status: functionUnit.status,
        dependencies: dependencies.map((dependency) => {
          return {
            fu_id: dependency.depends_on_fu_id,
            type: dependency.type,
          };
        }),
      };
    }),
  };
}
