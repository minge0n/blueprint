import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { startBuild } from '../db/queries/build-cycle.js';
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

const startBuildTool = defineTool({
  name: 'blueprint_start_build',
  description: 'Start a build cycle for a feature already in building status.',
  inputSchema: {
    feature_id: z.string().min(1),
    agent_id: z.string().min(1),
  },
  handler: async (args): Promise<CallToolResult> => {
    try {
      const result = startBuild({
        feature_id: args.feature_id,
        agent_id: args.agent_id,
      });

      return formatToolResult(result);
    } catch (error: unknown) {
      return createToolErrorResult(getErrorMessage(error));
    }
  },
});

export const buildCycleToolDefinitions: Array<BlueprintToolDefinition> = [startBuildTool];
