import type { FeaturePriority, FeatureStatus } from './types.js';

export interface Feature {
  readonly id: string;
  readonly title: string;
  readonly scope: string;
  readonly out_of_scope: string;
  readonly status: FeatureStatus;
  readonly priority: FeaturePriority;
  readonly depends_on: Array<string>;
}
