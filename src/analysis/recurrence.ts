import type { AcceptanceCriteria } from '../entities/acceptance-criteria.js';
import { ACCEPTANCE_CRITERIA_TYPES } from '../entities/types.js';
import type { Issue, IssueCategory } from '../entities/issue.js';
import type { StatusAuditLog } from '../entities/status-audit-log.js';
import { BUILD_CYCLE_STATUSES } from '../entities/build-cycle.js';
import { PLAN_CYCLE_STATUSES } from '../entities/plan-cycle.js';
import type {
  BlueprintGetContextResult,
  ContextStatusAuditHistoryEntry,
} from '../db/queries/context.js';

export interface HistoryIssueRecurrence {
  readonly fu_id: string;
  readonly category: IssueCategory;
  readonly occurrences: number;
  readonly cycle_ids: Array<string>;
}

export interface HistoryAcFailureRate {
  readonly type: AcceptanceCriteria['type'];
  readonly total: number;
  readonly failed_before_passing: number;
  readonly percentage: number;
}

export interface HistoryFuRework {
  readonly fu_id: string;
  readonly rework_count: number;
}

export interface BlueprintHistoryResult {
  readonly feature_id: string;
  readonly plan_cycle_count: number;
  readonly build_cycle_count: number;
  readonly issue_recurrence: Array<HistoryIssueRecurrence>;
  readonly ac_failure_rates: Array<HistoryAcFailureRate>;
  readonly fu_rework: Array<HistoryFuRework>;
  readonly issue_category_distribution: Record<string, number>;
  readonly average_cycles_to_approval: {
    readonly plan: number | null;
    readonly build: number | null;
  };
}

function roundPercentage(value: number): number {
  return Math.round(value * 100) / 100;
}

function getAcceptanceCriteriaMap(
  context: BlueprintGetContextResult
): Map<string, AcceptanceCriteria> {
  const acceptanceCriteriaMap = new Map<string, AcceptanceCriteria>();

  for (const functionUnit of context.function_units) {
    for (const acceptanceCriteria of functionUnit.acceptance_criteria) {
      acceptanceCriteriaMap.set(acceptanceCriteria.id, acceptanceCriteria);
    }
  }

  return acceptanceCriteriaMap;
}

function hasFailureBeforePass(history: Array<StatusAuditLog>): boolean {
  let failed = false;

  for (const entry of history) {
    if (entry.new_status === 'failed') {
      failed = true;
    }

    if (failed && entry.new_status === 'passed') {
      return true;
    }
  }

  return false;
}

function buildAcFailureRates(context: BlueprintGetContextResult): Array<HistoryAcFailureRate> {
  const acceptanceCriteriaMap = getAcceptanceCriteriaMap(context);
  const acceptanceCriteriaHistoryMap = new Map<string, Array<StatusAuditLog>>();
  const totals = new Map<AcceptanceCriteria['type'], number>();
  const failures = new Map<AcceptanceCriteria['type'], number>();
  const acceptanceCriteriaTypes: Array<AcceptanceCriteria['type']> = [
    ACCEPTANCE_CRITERIA_TYPES.FUNCTIONAL,
    ACCEPTANCE_CRITERIA_TYPES.PERFORMANCE,
    ACCEPTANCE_CRITERIA_TYPES.SECURITY,
    ACCEPTANCE_CRITERIA_TYPES.EDGE_CASE,
  ];

  for (const acceptanceCriteriaType of acceptanceCriteriaTypes) {
    totals.set(acceptanceCriteriaType, 0);
    failures.set(acceptanceCriteriaType, 0);
  }

  for (const entry of context.status_audit_history.acceptance_criteria) {
    acceptanceCriteriaHistoryMap.set(entry.entity_id, entry.history);
  }

  for (const acceptanceCriteria of acceptanceCriteriaMap.values()) {
    const acceptanceCriteriaHistory = acceptanceCriteriaHistoryMap.get(acceptanceCriteria.id) ?? [];

    totals.set(acceptanceCriteria.type, (totals.get(acceptanceCriteria.type) ?? 0) + 1);

    if (hasFailureBeforePass(acceptanceCriteriaHistory)) {
      failures.set(acceptanceCriteria.type, (failures.get(acceptanceCriteria.type) ?? 0) + 1);
    }
  }

  return acceptanceCriteriaTypes.map((acceptanceCriteriaType) => {
    const total = totals.get(acceptanceCriteriaType) ?? 0;
    const failedBeforePassing = failures.get(acceptanceCriteriaType) ?? 0;
    const percentage = total === 0 ? 0 : roundPercentage((failedBeforePassing / total) * 100);

    return {
      type: acceptanceCriteriaType,
      total,
      failed_before_passing: failedBeforePassing,
      percentage,
    };
  });
}

function buildFuRework(
  historyEntries: Array<ContextStatusAuditHistoryEntry>
): Array<HistoryFuRework> {
  const reworkEntries: Array<HistoryFuRework> = [];

  for (const entry of historyEntries) {
    let reworkCount = 0;

    for (const statusChange of entry.history) {
      if (
        statusChange.old_status === 'passed' &&
        (statusChange.new_status === 'in_progress' || statusChange.new_status === 'failed')
      ) {
        reworkCount += 1;
      }
    }

    reworkEntries.push({
      fu_id: entry.entity_id,
      rework_count: reworkCount,
    });
  }

  return reworkEntries;
}

function buildIssueCategoryDistribution(issues: Array<Issue>): Record<string, number> {
  const distribution: Record<string, number> = {};

  for (const issue of issues) {
    distribution[issue.category] = (distribution[issue.category] ?? 0) + 1;
  }

  return distribution;
}

function getCycleSortRank(issue: Issue, cycleOrder: Map<string, number>): number {
  const cycleRank = cycleOrder.get(issue.parent_id);

  if (cycleRank === undefined) {
    return Number.MAX_SAFE_INTEGER;
  }

  return cycleRank;
}

function buildCycleOrder(context: BlueprintGetContextResult): Map<string, number> {
  const cycleOrder = new Map<string, number>();

  for (const planCycle of context.plan_cycles) {
    cycleOrder.set(planCycle.id, planCycle.iteration);
  }

  for (const buildCycle of context.build_cycles) {
    cycleOrder.set(buildCycle.id, buildCycle.iteration + 1000);
  }

  return cycleOrder;
}

function buildIssueRecurrence(context: BlueprintGetContextResult): Array<HistoryIssueRecurrence> {
  const groupedIssues = new Map<string, Array<Issue>>();
  const cycleOrder = buildCycleOrder(context);

  for (const issue of context.issues) {
    const key = `${issue.fu_id}:${issue.category}`;
    const existingIssues = groupedIssues.get(key);

    if (existingIssues === undefined) {
      groupedIssues.set(key, [issue]);
      continue;
    }

    existingIssues.push(issue);
  }

  const recurringIssues: Array<HistoryIssueRecurrence> = [];

  for (const issues of groupedIssues.values()) {
    const orderedIssues = issues.slice().sort((leftIssue, rightIssue) => {
      return getCycleSortRank(leftIssue, cycleOrder) - getCycleSortRank(rightIssue, cycleOrder);
    });
    let sawResolvedIssue = false;

    for (const issue of orderedIssues) {
      if (sawResolvedIssue) {
        recurringIssues.push({
          fu_id: issue.fu_id,
          category: issue.category,
          occurrences: orderedIssues.length,
          cycle_ids: orderedIssues.map((entry) => entry.parent_id),
        });

        break;
      }

      if (issue.status === 'resolved' || issue.status === 'wont_fix') {
        sawResolvedIssue = true;
      }
    }
  }

  return recurringIssues;
}

function getApprovedIteration<TCycle extends { readonly iteration: number; readonly status: string }>(
  cycles: Array<TCycle>,
  approvedStatus: string
): number | null {
  for (const cycle of cycles) {
    if (cycle.status === approvedStatus) {
      return cycle.iteration;
    }
  }

  return null;
}

export function analyzeBlueprintHistory(
  context: BlueprintGetContextResult
): BlueprintHistoryResult {
  if (context.feature === null) {
    throw new Error('Cannot analyze history without an active feature.');
  }

  return {
    feature_id: context.feature.id,
    plan_cycle_count: context.plan_cycles.length,
    build_cycle_count: context.build_cycles.length,
    issue_recurrence: buildIssueRecurrence(context),
    ac_failure_rates: buildAcFailureRates(context),
    fu_rework: buildFuRework(context.status_audit_history.function_units),
    issue_category_distribution: buildIssueCategoryDistribution(context.issues),
    average_cycles_to_approval: {
      plan: getApprovedIteration(context.plan_cycles, PLAN_CYCLE_STATUSES.APPROVED),
      build: getApprovedIteration(context.build_cycles, BUILD_CYCLE_STATUSES.APPROVED),
    },
  };
}
