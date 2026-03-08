import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { blueprintGetAvailableWork } from '../db/queries/available-work.js';
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

const getAvailableWorkTool = defineTool({
  name: 'blueprint_get_available_work',
  description: 'Atomically acquire the highest-priority available function unit for an agent.',
  inputSchema: {
    agent_id: z.string().min(1),
  },
  handler: async ({ agent_id }): Promise<CallToolResult> => {
    try {
      return createTextToolResult(
        JSON.stringify(
          blueprintGetAvailableWork({
            agent_id,
          }),
          null,
          2
        )
      );
    } catch (error: unknown) {
      return createToolErrorResult(getErrorMessage(error));
    }
  },
});

export const availableWorkToolDefinitions: Array<BlueprintToolDefinition> = [
  getAvailableWorkTool,
];
