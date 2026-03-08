import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { addMergePoint, checkMergeReady } from '../db/queries/merge-point.js';
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

export const mergePointToolDefinitions: Array<BlueprintToolDefinition> = [
  defineTool({
    name: 'blueprint_add_merge_point',
    description: 'Create a merge point that blocks a merged function unit until trigger units pass.',
    inputSchema: {
      feature_id: z.string().min(1),
      trigger_fus: z.array(z.string().min(1)).min(1),
      merged_fu: z.string().min(1),
    },
    handler: ({ feature_id, trigger_fus, merged_fu }): CallToolResult => {
      try {
        return formatToolResult(
          addMergePoint({
            feature_id,
            trigger_fus,
            merged_fu,
          })
        );
      } catch (error: unknown) {
        return createToolErrorResult(getErrorMessage(error));
      }
    },
  }),
  defineTool({
    name: 'blueprint_check_merge_ready',
    description: 'Check whether a merge point is ready and transition it to ready when triggers pass.',
    inputSchema: {
      merge_point_id: z.string().min(1),
    },
    handler: ({ merge_point_id }): CallToolResult => {
      try {
        return formatToolResult(checkMergeReady(merge_point_id));
      } catch (error: unknown) {
        return createToolErrorResult(getErrorMessage(error));
      }
    },
  }),
];
