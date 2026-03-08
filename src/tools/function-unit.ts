import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { addFunctionUnit } from '../db/queries/function-unit.js';
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

export const functionUnitToolDefinitions: Array<BlueprintToolDefinition> = [
  defineTool({
    name: 'blueprint_add_function_unit',
    description: 'Add a function unit to a feature.',
    inputSchema: {
      feature_id: z.string().min(1),
      title: z.string().min(1),
      description: z.string().min(1),
    },
    handler: (
      { feature_id, title, description },
      _extra
    ): CallToolResult => {
      try {
        const functionUnit = addFunctionUnit({
          feature_id,
          title,
          description,
        });

        return createTextToolResult(JSON.stringify(functionUnit, null, 2));
      } catch (error: unknown) {
        return createToolErrorResult(getErrorMessage(error));
      }
    },
  }),
];
