import type { FunctionUnit } from '../entities/function-unit.js';
import type { FunctionUnitStatus } from '../entities/types.js';
import type { FunctionUnitDependencyRecord } from '../entities/fu-dependency.js';

export type AdditionalBlockCheck = (fuId: string) => boolean;

export interface DependencyGraphData {
  readonly feature_id: string;
  readonly function_units: Array<FunctionUnit>;
  readonly dependencies: Array<FunctionUnitDependencyRecord>;
}

export interface DependencyAdjacencyEdge {
  readonly fu_id: string;
  readonly type: FunctionUnitDependencyRecord['type'];
}

export interface DependencyAdjacencyNode {
  readonly fu_id: string;
  readonly title: string;
  readonly status: FunctionUnitStatus;
  readonly dependencies: Array<DependencyAdjacencyEdge>;
}

export interface DependencyAdjacencyList {
  readonly feature_id: string;
  readonly function_units: Array<DependencyAdjacencyNode>;
}
