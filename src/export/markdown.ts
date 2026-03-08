import fs from 'node:fs';
import path from 'node:path';

import type { AcceptanceCriteria } from '../entities/acceptance-criteria.js';
import type { FunctionUnit } from '../entities/function-unit.js';
import type { Issue } from '../entities/issue.js';
import type {
  BlueprintGetContextResult,
  ContextBuildCycle,
  ContextPlanCycle,
} from '../db/queries/context.js';
import { getBlueprintDirectory } from '../db/index.js';

export interface BlueprintExportResult {
  readonly feature_id: string;
  readonly output_path: string;
  readonly markdown: string;
}

function formatList(values: Array<string>): string {
  if (values.length === 0) {
    return 'none';
  }

  return values.join(', ');
}

function formatAcceptanceCriteria(acceptanceCriteria: Array<AcceptanceCriteria>): Array<string> {
  if (acceptanceCriteria.length === 0) {
    return ['- No acceptance criteria recorded'];
  }

  return acceptanceCriteria.map((criterion) => {
    return `- ${criterion.id} [${criterion.type}/${criterion.severity}] ${criterion.description} - status: ${criterion.status}`;
  });
}

function formatFunctionUnits(functionUnits: Array<FunctionUnit>): Array<string> {
  const lines: Array<string> = [];

  for (const functionUnit of functionUnits) {
    lines.push(`### ${functionUnit.id} - ${functionUnit.title}`);
    lines.push(`- Status: ${functionUnit.status}`);
    lines.push(`- Description: ${functionUnit.description}`);
    lines.push(`- Depends on: ${formatList(functionUnit.depends_on.map((dependency) => `${dependency.fu_id} (${dependency.type})`))}`);
    lines.push(`- Assigned agent: ${functionUnit.assigned_agent ?? 'unassigned'}`);
    lines.push(`- Test evidence: ${functionUnit.test_evidence ?? 'none'}`);
    lines.push(`- Failure reason: ${functionUnit.failure_reason ?? 'none'}`);
    lines.push(...formatAcceptanceCriteria(functionUnit.acceptance_criteria));
    lines.push('');
  }

  return lines;
}

function formatIssues(issues: Array<Issue>): Array<string> {
  if (issues.length === 0) {
    return ['- No issues'];
  }

  return issues.map((issue) => {
    return `- ${issue.id} [${issue.severity}/${issue.category}/${issue.status}] ${issue.title} (fu: ${issue.fu_id}, resolved_in: ${issue.resolved_in ?? 'open'})`;
  });
}

function formatPlanCycles(planCycles: Array<ContextPlanCycle>): Array<string> {
  const lines: Array<string> = [];

  for (const planCycle of planCycles) {
    lines.push(`### ${planCycle.id}`);
    lines.push(`- Iteration: ${planCycle.iteration}`);
    lines.push(`- Outcome: ${planCycle.status}`);
    lines.push(`- Function units in snapshot: ${planCycle.plan_snapshot.function_units.length}`);
    lines.push(...formatIssues(planCycle.issues));
    lines.push('');
  }

  return lines;
}

function formatBuildCycles(buildCycles: Array<ContextBuildCycle>): Array<string> {
  const lines: Array<string> = [];

  for (const buildCycle of buildCycles) {
    const sessionCounts = new Map<string, number>();

    for (const sessionLog of buildCycle.session_logs) {
      sessionCounts.set(sessionLog.agent_id, (sessionCounts.get(sessionLog.agent_id) ?? 0) + 1);
    }

    lines.push(`### ${buildCycle.id}`);
    lines.push(`- Iteration: ${buildCycle.iteration}`);
    lines.push(`- Initiating agent: ${buildCycle.agent_id}`);
    lines.push(`- Outcome: ${buildCycle.status}`);
    lines.push(`- Per-agent session count: ${formatList(Array.from(sessionCounts.entries()).map(([agentId, count]) => `${agentId}=${count}`))}`);
    lines.push(`- Checkpoints: ${buildCycle.checkpoints.length}`);
    lines.push(...formatIssues(buildCycle.issues));
    lines.push('');
  }

  return lines;
}

function buildIssueStats(issues: Array<Issue>): Array<string> {
  const byCategory = new Map<string, number>();
  const bySeverity = new Map<string, number>();

  for (const issue of issues) {
    byCategory.set(issue.category, (byCategory.get(issue.category) ?? 0) + 1);
    bySeverity.set(issue.severity, (bySeverity.get(issue.severity) ?? 0) + 1);
  }

  return [
    `- Total issues: ${issues.length}`,
    `- Issues by category: ${formatList(Array.from(byCategory.entries()).map(([category, count]) => `${category}=${count}`))}`,
    `- Issues by severity: ${formatList(Array.from(bySeverity.entries()).map(([severity, count]) => `${severity}=${count}`))}`,
  ];
}

export function createBlueprintExport(context: BlueprintGetContextResult): BlueprintExportResult {
  if (context.feature === null) {
    throw new Error('Cannot export lifecycle report without an active feature.');
  }

  const lines: Array<string> = [
    `# Blueprint Export - ${context.feature.title}`,
    '',
    '## Feature Metadata',
    `- Feature ID: ${context.feature.id}`,
    `- Scope: ${context.feature.scope}`,
    `- Out of scope: ${context.feature.out_of_scope}`,
    `- Priority: ${context.feature.priority}`,
    `- Status: ${context.feature.status}`,
    '',
    '## Plan Cycles',
    ...formatPlanCycles(context.plan_cycles),
    '## Build Cycles',
    ...formatBuildCycles(context.build_cycles),
    '## Function Units',
    ...formatFunctionUnits(context.function_units),
    '## Issues',
    ...formatIssues(context.issues),
    '',
    '## Summary Statistics',
    `- Total plan cycles: ${context.plan_cycles.length}`,
    `- Total build cycles: ${context.build_cycles.length}`,
    ...buildIssueStats(context.issues),
    '',
  ];
  const markdown = lines.join('\n');
  const exportDirectory = path.join(getBlueprintDirectory(), 'exports');
  const outputPath = path.join(exportDirectory, `${context.feature.id}.md`);

  fs.mkdirSync(exportDirectory, { recursive: true });
  fs.writeFileSync(outputPath, markdown, 'utf8');

  return {
    feature_id: context.feature.id,
    output_path: outputPath,
    markdown,
  };
}
