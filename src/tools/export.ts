import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { blueprintGetContext } from '../db/queries/context.js';
import { createBlueprintExport } from '../export/markdown.js';
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

export const exportToolDefinitions: Array<BlueprintToolDefinition> = [
  defineTool({
    name: 'blueprint_export',
    description: 'Generate a markdown lifecycle report for a feature and write it under ~/.blueprint/exports.',
    inputSchema: {
      feature_id: z.string().min(1),
    },
    handler: async ({ feature_id }): Promise<CallToolResult> => {
      try {
        const context = blueprintGetContext({ feature_id });
        const result = createBlueprintExport(context);

        return createTextToolResult(result.markdown);
      } catch (error: unknown) {
        return createToolErrorResult(getErrorMessage(error));
      }
    },
  }),
];
