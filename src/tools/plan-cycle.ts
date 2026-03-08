import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { startPlanReview } from '../db/queries/plan-cycle.js';
import {
  createTextToolResult,
  createToolErrorResult,
  defineTool,
  type BlueprintToolDefinition,
} from './types.js';

function formatToolResult(data: unknown): CallToolResult {
  return createTextToolResult(JSON.stringify(data, null, 2));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

export const planCycleToolDefinitions: Array<BlueprintToolDefinition> = [
  defineTool({
    name: 'blueprint_start_plan_review',
    description: 'Create a plan review cycle and snapshot the current plan.',
    inputSchema: {
      feature_id: z.string().min(1),
    },
    handler: async ({ feature_id }): Promise<CallToolResult> => {
      try {
        const planCycle = startPlanReview({ feature_id });

        return formatToolResult(planCycle);
      } catch (error: unknown) {
        return createToolErrorResult(getErrorMessage(error));
      }
    },
  }),
];
