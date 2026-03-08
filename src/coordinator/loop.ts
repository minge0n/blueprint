import { blueprintGetAvailableWork } from '../db/queries/available-work.js';
import { getParallelStatus } from '../db/queries/parallel-status.js';
import { listMergePoints, checkMergeReady } from '../db/queries/merge-point.js';
import { blueprintResume } from '../db/queries/resume.js';
import { startBuild, getActiveBuildCycleForFeature } from '../db/queries/build-cycle.js';
import { submitBuildForReview } from '../db/queries/build-review.js';
import { getFullFeatureById } from '../db/queries/feature.js';
import { approveBuild, rejectBuild } from '../tools/build-gate.js';
import { FEATURE_STATUSES, FUNCTION_UNIT_STATUSES } from '../entities/types.js';
import type {
  CoordinatorLoopDependencies,
  CoordinatorLoopInput,
  CoordinatorLoopResult,
  SkepticBuildReviewResult,
  WorkerAssignment,
  WorkerRunResult,
} from './types.js';

function getBuildCycleIdForFeature(featureId: string, coordinatorAgentId: string): string {
  const activeBuildCycle = getActiveBuildCycleForFeature(featureId);

  if (activeBuildCycle !== null) {
    return activeBuildCycle.id;
  }

  return startBuild({
    feature_id: featureId,
    agent_id: coordinatorAgentId,
  }).build_cycle.id;
}

function getIdleAgentIds(
  workerAgentIds: Array<string>,
  activeAgentIds: Array<string>
): Array<string> {
  const activeAgentIdSet = new Set<string>(activeAgentIds);

  return workerAgentIds.filter((agentId) => {
    return !activeAgentIdSet.has(agentId);
  });
}

function areAllFunctionUnitsPassed(featureId: string): boolean {
  const fullFeature = getFullFeatureById(featureId);

  if (fullFeature === null) {
    throw new Error(`Feature not found: ${featureId}`);
  }

  for (const functionUnit of fullFeature.function_units) {
    if (functionUnit.status !== FUNCTION_UNIT_STATUSES.PASSED) {
      return false;
    }
  }

  return true;
}

async function dispatchWorkers(
  featureId: string,
  buildCycleId: string,
  workerAgentIds: Array<string>,
  dependencies: CoordinatorLoopDependencies
): Promise<Array<WorkerRunResult>> {
  const parallelStatus = getParallelStatus(featureId);
  const idleAgentIds = getIdleAgentIds(
    workerAgentIds,
    parallelStatus.agents.map((agent) => agent.agent_id)
  );
  const assignments: Array<WorkerAssignment> = [];

  for (const agentId of idleAgentIds) {
    const availableWork = blueprintGetAvailableWork({ agent_id: agentId });

    if (availableWork === null) {
      continue;
    }

    assignments.push({
      agent_id: agentId,
      fu_id: availableWork.fu.id,
      lock_id: availableWork.lock_id,
      build_cycle_id: buildCycleId,
    });
  }

  const settledResults = await Promise.allSettled(
    assignments.map((assignment) => dependencies.runWorker(assignment))
  );
  const workerResults: Array<WorkerRunResult> = [];

  for (let index = 0; index < settledResults.length; index += 1) {
    const settledResult = settledResults[index];
    const assignment = assignments[index];

    if (assignment === undefined) {
      continue;
    }

    if (settledResult === undefined) {
      workerResults.push({
        agent_id: assignment.agent_id,
        success: false,
        message: 'Worker result missing.',
      });
      continue;
    }

    if (settledResult.status === 'fulfilled') {
      workerResults.push(settledResult.value);
      continue;
    }

    const reason = settledResult.reason;
    const message = reason instanceof Error ? reason.message : 'Worker crashed.';

    workerResults.push({
      agent_id: assignment.agent_id,
      success: false,
      message,
    });
  }

  return workerResults;
}

function refreshMergePoints(featureId: string): void {
  const mergePoints = listMergePoints(featureId);

  for (const mergePoint of mergePoints) {
    if (mergePoint.status === 'waiting') {
      checkMergeReady(mergePoint.id);
    }
  }
}

async function runBuildReview(
  buildCycleId: string,
  dependencies: CoordinatorLoopDependencies
): Promise<SkepticBuildReviewResult> {
  submitBuildForReview({ build_cycle_id: buildCycleId });

  return dependencies.runSkepticBuildReview(buildCycleId);
}

export async function runCoordinatorLoop(
  input: CoordinatorLoopInput,
  dependencies: CoordinatorLoopDependencies
): Promise<CoordinatorLoopResult> {
  const resume = blueprintResume();

  if (resume.active_feature === null) {
    throw new Error('Coordinator could not find an active feature to manage.');
  }

  const featureId = resume.active_feature.id;
  const fullFeature = getFullFeatureById(featureId);

  if (fullFeature === null) {
    throw new Error(`Feature not found: ${featureId}`);
  }

  if (fullFeature.status !== FEATURE_STATUSES.BUILDING) {
    throw new Error(`Coordinator requires feature ${featureId} to be in building status.`);
  }

  const maxIterations = input.max_iterations ?? 20;
  const workerResults: Array<WorkerRunResult> = [];
  let skepticResult: SkepticBuildReviewResult | null = null;
  let buildCycleId = getBuildCycleIdForFeature(featureId, input.coordinator_agent_id);
  let stalled = false;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const statusBeforeDispatch = getParallelStatus(featureId);
    const dispatchedResults = await dispatchWorkers(
      featureId,
      buildCycleId,
      input.worker_agent_ids,
      dependencies
    );

    workerResults.push(...dispatchedResults);
    refreshMergePoints(featureId);

    if (!areAllFunctionUnitsPassed(featureId)) {
      if (dispatchedResults.length === 0 && statusBeforeDispatch.agents.length === 0) {
        stalled = true;
        break;
      }

      continue;
    }

    skepticResult = await runBuildReview(buildCycleId, dependencies);

    if (skepticResult.approved) {
      approveBuild({ build_cycle_id: buildCycleId });

      return {
        feature_id: featureId,
        final_build_cycle_id: buildCycleId,
        approved: true,
        worker_results: workerResults,
        skeptic_result: skepticResult,
        stalled: false,
      };
    }

    rejectBuild({ build_cycle_id: buildCycleId });
    buildCycleId = startBuild({
      feature_id: featureId,
      agent_id: input.coordinator_agent_id,
    }).build_cycle.id;
  }

  return {
    feature_id: featureId,
    final_build_cycle_id: buildCycleId,
    approved: false,
    worker_results: workerResults,
    skeptic_result: skepticResult,
    stalled,
  };
}
