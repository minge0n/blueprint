export interface WorkerAssignment {
  readonly agent_id: string;
  readonly fu_id: string;
  readonly lock_id: string;
  readonly build_cycle_id: string;
}

export interface WorkerRunResult {
  readonly agent_id: string;
  readonly success: boolean;
  readonly message: string;
}

export interface SkepticBuildReviewResult {
  readonly approved: boolean;
  readonly message: string;
}

export interface CoordinatorLoopInput {
  readonly coordinator_agent_id: string;
  readonly worker_agent_ids: Array<string>;
  readonly max_iterations?: number;
}

export interface CoordinatorLoopDependencies {
  readonly runWorker: (assignment: WorkerAssignment) => Promise<WorkerRunResult>;
  readonly runSkepticBuildReview: (buildCycleId: string) => Promise<SkepticBuildReviewResult>;
}

export interface CoordinatorLoopResult {
  readonly feature_id: string;
  readonly final_build_cycle_id: string | null;
  readonly approved: boolean;
  readonly worker_results: Array<WorkerRunResult>;
  readonly skeptic_result: SkepticBuildReviewResult | null;
  readonly stalled: boolean;
}
