import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { analyzeBlueprintHistory } from '../analysis/recurrence.js';
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

export const historyToolDefinitions: Array<BlueprintToolDefinition> = [
  defineTool({
    name: 'blueprint_get_history',
    description: 'Return recurrence and rework analysis for a feature across plan and build cycles.',
    inputSchema: {
      feature_id: z.string().min(1),
    },
    handler: async ({ feature_id }): Promise<CallToolResult> => {
      try {
        const context = blueprintGetContext({ feature_id });
        const history = analyzeBlueprintHistory(context);

        return createTextToolResult(JSON.stringify(history, null, 2));
      } catch (error: unknown) {
        return createToolErrorResult(getErrorMessage(error));
      }
    },
  }),
];
