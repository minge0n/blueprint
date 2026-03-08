import {
  FUNCTION_UNIT_DEPENDENCY_TYPES,
  type FunctionUnitDependencyType,
} from './types.js';

export interface FunctionUnitDependencyRecord {
  readonly fu_id: string;
  readonly depends_on_fu_id: string;
  readonly type: FunctionUnitDependencyType;
}

export function isFunctionUnitDependencyType(value: string): value is FunctionUnitDependencyType {
  switch (value) {
    case FUNCTION_UNIT_DEPENDENCY_TYPES.HARD:
    case FUNCTION_UNIT_DEPENDENCY_TYPES.SOFT:
      return true;
    default:
      return false;
  }
}
