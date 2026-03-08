import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { getParallelStatus } from '../db/queries/parallel-status.js';
import {
  createTextToolResult,
  createToolErrorResult,
  defineTool,
  type BlueprintToolDefinition,
} from './types.js';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

export const parallelStatusToolDefinitions: Array<BlueprintToolDefinition> = [
  defineTool({
    name: 'blueprint_get_parallel_status',
    description: 'Return active agent assignments, merge point readiness, blocked work, and available work.',
    inputSchema: {
      feature_id: z.string().min(1),
    },
    handler: async ({ feature_id }): Promise<CallToolResult> => {
      try {
        return createTextToolResult(JSON.stringify(getParallelStatus(feature_id), null, 2));
      } catch (error: unknown) {
        return createToolErrorResult(getErrorMessage(error));
      }
    },
  }),
];
