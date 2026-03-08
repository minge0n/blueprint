import type {
  AcceptanceCriteriaSeverity,
  AcceptanceCriteriaStatus,
  AcceptanceCriteriaType,
} from './types.js';

export interface AcceptanceCriteria {
  readonly id: string;
  readonly fu_id: string;
  readonly description: string;
  readonly type: AcceptanceCriteriaType;
  readonly severity: AcceptanceCriteriaSeverity;
  readonly status: AcceptanceCriteriaStatus;
  readonly verified_in: string | null;
  readonly evidence: string | null;
}
