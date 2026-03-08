import type { AcceptanceCriteria } from './acceptance-criteria.js';
import type {
  FunctionUnitDependencyType,
  FunctionUnitStatus,
} from './types.js';

export interface FunctionUnitDependency {
  readonly fu_id: string;
  readonly type: FunctionUnitDependencyType;
}

export interface FunctionUnit {
  readonly id: string;
  readonly feature_id: string;
  readonly title: string;
  readonly description: string;
  readonly acceptance_criteria: Array<AcceptanceCriteria>;
  readonly depends_on: Array<FunctionUnitDependency>;
  readonly status: FunctionUnitStatus;
  readonly assigned_agent: string | null;
  readonly test_evidence: string | null;
  readonly failure_reason: string | null;
}
