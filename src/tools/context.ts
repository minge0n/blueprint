import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { blueprintGetContext } from '../db/queries/context.js';
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

function formatToolResult(data: unknown): CallToolResult {
  return createTextToolResult(JSON.stringify(data, null, 2));
}

const getContextTool = defineTool({
  name: 'blueprint_get_context',
  description: 'Return full feature context, history, cycles, and issues.',
  inputSchema: {
    feature_id: z.string().min(1).optional(),
  },
  handler: async (args): Promise<CallToolResult> => {
    try {
      const result = blueprintGetContext({
        feature_id: args.feature_id,
      });

      return formatToolResult(result);
    } catch (error: unknown) {
      return createToolErrorResult(getErrorMessage(error));
    }
  },
});

export const contextToolDefinitions: Array<BlueprintToolDefinition> = [getContextTool];
