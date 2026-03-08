import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { availableWorkToolDefinitions } from './available-work.js';
import { acceptanceCriteriaToolDefinitions } from './acceptance-criteria.js';
import { buildGateToolDefinitions } from './build-gate.js';
import { buildCycleToolDefinitions } from './build-cycle.js';
import { buildReviewToolDefinitions } from './build-review.js';
import { checkpointToolDefinitions } from './checkpoint.js';
import { contextToolDefinitions } from './context.js';
import { dependencyToolDefinitions } from './dependency.js';
import { exportToolDefinitions } from './export.js';
import { featureTools } from './feature.js';
import { functionUnitToolDefinitions } from './function-unit.js';
import { historyToolDefinitions } from './history.js';
import { issueToolDefinitions } from './issue.js';
import { integrationIssueToolDefinitions } from './issue-integration.js';
import { lockToolDefinitions } from './lock.js';
import { mergePointToolDefinitions } from './merge-point.js';
import { parallelStatusToolDefinitions } from './parallel-status.js';
import { planGateToolDefinitions } from './plan-gate.js';
import { planCycleToolDefinitions } from './plan-cycle.js';
import { resumeToolDefinitions } from './resume.js';
import type { BlueprintToolDefinition } from './types.js';

const toolDefinitions: Array<BlueprintToolDefinition> = [
  ...featureTools,
  ...availableWorkToolDefinitions,
  ...functionUnitToolDefinitions,
  ...acceptanceCriteriaToolDefinitions,
  ...planCycleToolDefinitions,
  ...buildCycleToolDefinitions,
  ...buildReviewToolDefinitions,
  ...checkpointToolDefinitions,
  ...contextToolDefinitions,
  ...dependencyToolDefinitions,
  ...exportToolDefinitions,
  ...issueToolDefinitions,
  ...historyToolDefinitions,
  ...integrationIssueToolDefinitions,
  ...lockToolDefinitions,
  ...mergePointToolDefinitions,
  ...parallelStatusToolDefinitions,
  ...planGateToolDefinitions,
  ...buildGateToolDefinitions,
  ...resumeToolDefinitions,
];

function registerTool(server: McpServer, tool: BlueprintToolDefinition): void {
  if (tool.inputSchema === undefined) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
      },
      tool.handler
    );

    return;
  }

  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.inputSchema,
    },
    tool.handler
  );
}

export function getToolDefinitions(): Array<BlueprintToolDefinition> {
  return [...toolDefinitions];
}

export function registerTools(
  server: McpServer,
  tools: Array<BlueprintToolDefinition> = toolDefinitions
): Array<string> {
  const registeredToolNames: Array<string> = [];

  for (const tool of tools) {
    try {
      registerTool(server, tool);
      registeredToolNames.push(tool.name);
    } catch (error: unknown) {
      console.error(`Failed to register MCP tool "${tool.name}"`, error);
    }
  }

  return registeredToolNames;
}

export const blueprintTools: Array<BlueprintToolDefinition> = toolDefinitions;
