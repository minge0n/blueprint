import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import {
  addDependency,
  getDependencyGraph,
} from '../db/queries/dependency.js';
import { FUNCTION_UNIT_DEPENDENCY_TYPES } from '../entities/types.js';
import {
  createTextToolResult,
  createToolErrorResult,
  defineTool,
  type BlueprintToolDefinition,
} from './types.js';

const addDependencyInputSchema = {
  fu_id: z.string().min(1),
  depends_on_fu_id: z.string().min(1),
  type: z.enum([
    FUNCTION_UNIT_DEPENDENCY_TYPES.HARD,
    FUNCTION_UNIT_DEPENDENCY_TYPES.SOFT,
  ]),
};

const getDependencyGraphInputSchema = {
  feature_id: z.string().min(1),
};

function formatToolResult(data: unknown): CallToolResult {
  return createTextToolResult(JSON.stringify(data, null, 2));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

export const dependencyToolDefinitions: Array<BlueprintToolDefinition> = [
  defineTool({
    name: 'blueprint_add_dependency',
    description: 'Add a hard or soft dependency between function units.',
    inputSchema: addDependencyInputSchema,
    handler: ({ fu_id, depends_on_fu_id, type }): CallToolResult => {
      try {
        return formatToolResult(
          addDependency({
            fu_id,
            depends_on_fu_id,
            type,
          })
        );
      } catch (error: unknown) {
        return createToolErrorResult(getErrorMessage(error));
      }
    },
  }),
  defineTool({
    name: 'blueprint_get_dependency_graph',
    description: 'Return a feature dependency graph as a function-unit adjacency list.',
    inputSchema: getDependencyGraphInputSchema,
    handler: ({ feature_id }): CallToolResult => {
      try {
        return formatToolResult(getDependencyGraph(feature_id));
      } catch (error: unknown) {
        return createToolErrorResult(getErrorMessage(error));
      }
    },
  }),
];
